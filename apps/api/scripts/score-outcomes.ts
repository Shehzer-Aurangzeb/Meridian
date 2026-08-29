/**
 * Score saved analyses and write the result to the row.
 *
 *   pnpm score                  # only what can still move (the job's own query)
 *   pnpm score -- --all         # the backfill: every row, terminal ones too
 *   pnpm score -- --verify      # change nothing; prove the stored values are right
 *
 * Read paths do no scoring and fetch no candles. Everything a card or the
 * scoreboard shows was computed here, once.
 *
 * `--verify` is the load-bearing check. It re-fetches every row's candle window
 * live, re-runs the SAME `scorePlans` the stored value came from, pinned to the
 * SAME instant (`scoredAt`), and diffs every field. A stored outcome that
 * quietly disagrees with the scorer is worse than a slow page — that is the
 * failure the marking convention already caused once.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { BinanceService } from '../src/market-data/market-data.service';
import { CacheTelemetryService } from '../src/market-data/cache-telemetry.service';
import { OutcomeScorerService } from '../src/analysis-coordinator/outcome-scorer.service';
import { OUTCOME_WINDOW_HOURS, PlanResult, scorePlans } from '../src/analysis-coordinator/outcome';
import { AnalysisRecord } from '../src/analysis-coordinator/analyze.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { Candle } from '../src/common/types/candle.types';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const VERIFY = args.includes('--verify');

/** A Map with a TTL-shaped interface, which is all BinanceService asks for. */
function memoryCache() {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => void store.set(k, v),
  };
}

function client(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

/** Every field of a PlanResult, compared the way each one deserves. */
const FIELDS: Array<keyof PlanResult> = [
  'direction',
  'outcome',
  'r',
  'netR',
  'filledAt',
  'targetsHit',
  'legsFilled',
  'filledFraction',
  'barsHeld',
];

function differs(field: keyof PlanResult, stored: unknown, fresh: unknown): boolean {
  if (stored === null || fresh === null) return stored !== fresh;
  if (field === 'filledAt') {
    return new Date(stored as string).getTime() !== new Date(fresh as Date).getTime();
  }
  if (typeof fresh === 'number') {
    // Floats survive a JSON round trip exactly, but compare on a tolerance
    // anyway so a real disagreement is never hidden behind a formatting one.
    return Math.abs((stored as number) - fresh) > 1e-9;
  }
  return stored !== fresh;
}

async function verify(prisma: PrismaClient, binance: BinanceService): Promise<void> {
  const rows = await prisma.coordinatorRun.findMany({
    where: { scoredAt: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      symbol: true,
      createdAt: true,
      coordinatorPayload: true,
      outcomePayload: true,
      scoredAt: true,
      outcome: true,
      netR: true,
    },
  });

  let checked = 0;
  let noPlan = 0;
  let skipped = 0;
  let closedPlans = 0;
  let openPlans = 0;
  /** Disagreements on a plan that is finished. These must be zero. */
  const hard: string[] = [];
  /**
   * Disagreements on a plan that is still OPEN. An open trade is valued at the
   * last close the scorer saw, so its R moves whenever the live hour does —
   * comparing a stored mark against a fresh one is comparing two clocks, not
   * two computations. Reported separately, never counted as agreement.
   */
  const marks: string[] = [];
  const byField: Record<string, number> = {};

  const CONCURRENCY = 8;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const withCandles = await Promise.all(
      batch.map(async (row) => {
        const analysis = row.coordinatorPayload as unknown as AnalysisRecord | null;
        if (!analysis?.plans?.length) return [row, null] as const;
        const candles = await binance
          .getCandlesFrom(row.symbol, '1h', row.createdAt.getTime(), OUTCOME_WINDOW_HOURS + 2)
          .catch(() => [] as Candle[]);
        return [row, candles] as const;
      }),
    );

    for (const [row, candles] of withCandles) {
      const analysis = row.coordinatorPayload as unknown as AnalysisRecord | null;
      const stored = row.outcomePayload as unknown as PlanResult[] | null;

      if (candles === null) {
        // No plans, so no results. Both sides must agree it is empty.
        if (Array.isArray(stored) && stored.length > 0) {
          mismatches.push(`${row.id} has ${stored.length} stored result(s) but builds no plan`);
        }
        noPlan += 1;
        continue;
      }
      if (!stored) {
        mismatches.push(`${row.id} is marked scored but has no stored results`);
        continue;
      }

      // The same instant the stored value was computed at. Without this, a row
      // that was OPEN when scored and is EXPIRED now reads as a mismatch when
      // it is only the clock that moved.
      const fresh = scorePlans(
        analysis!.plans,
        candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
        row.createdAt,
        (row.scoredAt as Date).getTime(),
      );

      // A window that will not load cannot refute anything. Say so rather than
      // counting it as agreement.
      if (fresh.every((f) => f.outcome === 'UNSCOREABLE') && stored.some((sv) => sv.outcome !== 'UNSCOREABLE')) {
        skipped += 1;
        continue;
      }

      if (fresh.length !== stored.length) {
        mismatches.push(`${row.id} stored ${stored.length} results, scorer produced ${fresh.length}`);
        continue;
      }

      checked += 1;
      for (let k = 0; k < fresh.length; k += 1) {
        const open = stored[k].outcome === 'OPEN' || fresh[k].outcome === 'OPEN';
        if (open) openPlans += 1;
        else closedPlans += 1;

        for (const f of FIELDS) {
          if (differs(f, stored[k][f], fresh[k][f])) {
            const line =
              `${row.id} plan[${k}].${f} (${stored[k].outcome}): ` +
              `stored ${JSON.stringify(stored[k][f])} != scorer ${JSON.stringify(fresh[k][f])}`;
            // An open trade may legitimately move on r/netR alone. Anything
            // else about it — its status, its fill, its target count — is as
            // fixed as a closed trade's and belongs in `hard`.
            if (open && (f === 'r' || f === 'netR')) {
              marks.push(line);
            } else {
              byField[f] = (byField[f] ?? 0) + 1;
              hard.push(line);
            }
          }
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        rowsSettled: rows.length,
        rowsCompared: checked,
        rowsWithNoPlan: noPlan,
        rowsSkippedBecauseBinanceWouldNotServe: skipped,
        fieldsPerRow: FIELDS.length,
        comparisons: checked * FIELDS.length,
        closedPlansCompared: closedPlans,
        openPlansCompared: openPlans,
        /** The number that decides whether the stored values are trustworthy. */
        mismatchesOnClosedPlans: hard.length,
        mismatchesByField: byField,
        /** Expected to be non-zero: an open trade's mark moves with the price. */
        markMovementOnOpenPlans: marks.length,
      },
      null,
      2,
    ),
  );
  for (const m of hard.slice(0, 50)) console.log(`  HARD  ${m}`);
  if (hard.length > 50) console.log(`  … ${hard.length - 50} more`);
  for (const m of marks.slice(0, 10)) console.log(`  mark  ${m}`);
  if (marks.length > 10) console.log(`  … ${marks.length - 10} more marks`);

  // An exit code, so this is a check and not a log. A moving mark on an open
  // trade is not a failure; a disagreement about a finished one is.
  if (hard.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const prisma = client();
  const binance = new BinanceService(
    memoryCache() as never,
    new CacheTelemetryService(),
  );

  if (VERIFY) {
    await verify(prisma, binance);
  } else {
    const scorer = new OutcomeScorerService(prisma as unknown as PrismaService, binance);
    const result = ALL ? await scorer.scoreAll() : await scorer.scoreUnresolved();
    console.log(JSON.stringify(result, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
