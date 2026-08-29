import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { AnalysisRecord } from './analyze.service';
import {
  isTerminalOutcome,
  OUTCOME_WINDOW_HOURS,
  PlanResult,
  scorePlans,
} from './outcome';
import { leadPlan } from './verdict';

/**
 * Scores saved analyses once and writes the result to the row.
 *
 * The whole point is WHERE the work happens, not what it computes: this calls
 * exactly the same `scorePlans` the read paths used to call, with the same
 * candles and the same windows. Nothing about a verdict changes — only that it
 * is derived once, here, instead of on every page load.
 *
 * Two rules keep it cheap and keep it honest:
 *
 *   1. A terminal outcome is never re-scored. STOPPED, PARTIAL, ALL_TARGETS,
 *      MISSED and EXPIRED are decided by candles that are already in the past.
 *   2. `scoredAt` is the settled marker. Null means "score me" — including for
 *      a row whose candles could not be fetched, so a network failure is
 *      retried rather than frozen into the record as a verdict.
 */

/** Hourly bars from the analysis, plus two for the part-formed hour at each end. */
const OUTCOME_TIMEFRAME: TimeInterval = '1h';
const OUTCOME_CANDLES = OUTCOME_WINDOW_HOURS + 2;

/**
 * How many rows to fetch candles for at once. The same 8 the read path used,
 * which stayed comfortably inside Binance's weight budget for months.
 */
const FETCH_CONCURRENCY = 8;

/** What one row needs before it can be scored. */
type Scorable = {
  id: string;
  symbol: string;
  createdAt: Date;
  coordinatorPayload: unknown;
  outcome: string | null;
  scoredAt: Date | null;
};

export interface ScoreRunResult {
  /** Rows the query handed us. */
  considered: number;
  /** Rows written with a real outcome. */
  scored: number;
  /** Rows settled without fetching anything, because they build no plan. */
  noPlan: number;
  /** Rows whose candles could not be loaded. Left unsettled, so retried. */
  unscoreable: number;
  /** Candle windows actually fetched. */
  candleFetches: number;
  ms: number;
}

/**
 * The columns written for one row, derived in ONE place from ONE PlanResult[].
 *
 * The scalars are a projection of `outcomePayload`, not a second computation.
 * A second definition of netR is exactly the drift that cost a checkpoint the
 * last time it happened, so there is no second definition — just a lift of the
 * lead plan's fields out of the array the detail page reads.
 */
export function outcomeColumns(
  plans: AnalysisRecord['plans'],
  results: PlanResult[],
  scoredAt: Date | null,
): Prisma.CoordinatorRunUpdateInput {
  const lead = leadPlan(plans);
  const result = lead ? results[plans.indexOf(lead)] : undefined;

  return {
    // Dates inside become ISO strings on the way into JSONB. Read paths only
    // pass them back out, so nothing ever calls getTime() on one.
    outcomePayload: results as unknown as Prisma.InputJsonValue,
    scoredAt,
    outcome: result?.outcome ?? null,
    outcomeDirection: result?.direction ?? null,
    grossR: result?.r ?? null,
    netR: result?.netR ?? null,
    targetsHit: result?.targetsHit ?? null,
    entryFilledAt: result?.filledAt ?? null,
  };
}

@Injectable()
export class OutcomeScorerService {
  private readonly logger = new Logger(OutcomeScorerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
  ) {}

  /**
   * Score every row that can still move, and every row never scored.
   *
   * `ids` restricts it to specific rows — used right after an analysis is
   * saved, so a fresh row shows PENDING immediately instead of waiting for the
   * next scheduled run.
   */
  async scoreUnresolved(options: { ids?: string[]; now?: number } = {}): Promise<ScoreRunResult> {
    const started = Date.now();
    const now = options.now ?? started;

    const rows = (await this.prisma.coordinatorRun.findMany({
      where: {
        ...(options.ids ? { id: { in: options.ids } } : {}),
        // Unsettled, or settled at an outcome that is still moving. A terminal
        // row matches neither arm, which is what makes this cheap: 29 rows of
        // 603 rather than all of them.
        OR: [{ scoredAt: null }, { outcome: { in: ['PENDING', 'OPEN'] } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        symbol: true,
        createdAt: true,
        coordinatorPayload: true,
        outcome: true,
        scoredAt: true,
      },
    })) as Scorable[];

    return this.score(rows, now, started);
  }

  /**
   * Score EVERY row, terminal ones included. The one-off backfill, and nothing
   * else — it is the only caller allowed past the terminal guard.
   */
  async scoreAll(options: { now?: number } = {}): Promise<ScoreRunResult> {
    const started = Date.now();
    const rows = (await this.prisma.coordinatorRun.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        symbol: true,
        createdAt: true,
        coordinatorPayload: true,
        outcome: true,
        scoredAt: true,
      },
    })) as Scorable[];

    return this.score(rows, options.now ?? started, started, { allowTerminal: true });
  }

  private async score(
    rows: Scorable[],
    now: number,
    started: number,
    options: { allowTerminal?: boolean } = {},
  ): Promise<ScoreRunResult> {
    const out: ScoreRunResult = {
      considered: rows.length,
      scored: 0,
      noPlan: 0,
      unscoreable: 0,
      candleFetches: 0,
      ms: 0,
    };

    // The guard. A settled terminal row reaching this loop means the query lost
    // its filter, and the symptom of that bug is silent: everything still works,
    // it is just slow again and burning Binance quota. Fail instead.
    if (!options.allowTerminal) {
      const frozen = rows.filter((r) => r.scoredAt !== null && isTerminalOutcome(r.outcome));
      if (frozen.length > 0) {
        throw new Error(
          `Refusing to re-score ${frozen.length} terminal row(s) — ` +
            `e.g. ${frozen[0].id} is ${frozen[0].outcome}, settled ${frozen[0].scoredAt?.toISOString()}. ` +
            `A terminal outcome cannot change; something dropped the query filter.`,
        );
      }
    }

    // Rows that build no plan are settled without touching the network. This is
    // 145 of 603 in production — a quarter of the fetching the read path used to
    // do was for windows thrown away fifteen lines later.
    const needCandles: Scorable[] = [];
    const noPlan: string[] = [];
    for (const row of rows) {
      const analysis = row.coordinatorPayload as AnalysisRecord | null;
      if (!analysis?.plans || analysis.plans.length === 0 || !leadPlan(analysis.plans)) {
        noPlan.push(row.id);
        continue;
      }
      needCandles.push(row);
    }
    if (noPlan.length > 0) {
      // Every one of these writes the same values, so it is one statement.
      await this.prisma.coordinatorRun.updateMany({
        where: { id: { in: noPlan } },
        data: outcomeColumns([], [], new Date(now)) as Prisma.CoordinatorRunUpdateManyMutationInput,
      });
      out.noPlan = noPlan.length;
    }

    for (let i = 0; i < needCandles.length; i += FETCH_CONCURRENCY) {
      const batch = needCandles.slice(i, i + FETCH_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (row) => {
          const candles = await this.binance
            .getCandlesFrom(row.symbol, OUTCOME_TIMEFRAME, row.createdAt.getTime(), OUTCOME_CANDLES)
            .catch(() => [] as Candle[]);
          return [row, candles] as const;
        }),
      );
      out.candleFetches += fetched.length;

      for (const [row, candles] of fetched) {
        const analysis = row.coordinatorPayload as AnalysisRecord;
        // Strictly after the analysis: the hour already in progress when it was
        // taken must not be allowed to open the trade after the fact.
        const results = scorePlans(
          analysis.plans,
          candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
          row.createdAt,
          now,
        );

        // A window that could not be loaded is a transport failure, not a
        // verdict. Record what it looks like today so the badge is unchanged,
        // but leave `scoredAt` null so the next run tries again.
        const failed = results.every((r) => r.outcome === 'UNSCOREABLE');
        if (failed) out.unscoreable += 1;
        else out.scored += 1;

        await this.prisma.coordinatorRun.update({
          where: { id: row.id },
          data: outcomeColumns(analysis.plans, results, failed ? null : new Date(now)),
        });
      }
    }

    out.ms = Date.now() - started;
    this.logger.log(JSON.stringify(out));
    return out;
  }
}
