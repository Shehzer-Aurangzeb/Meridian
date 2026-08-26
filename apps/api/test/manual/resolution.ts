/**
 * Does scoring on 1h bars tell the truth?
 *
 *   npx ts-node --transpile-only test/manual/resolution.ts
 *   npx ts-node --transpile-only test/manual/resolution.ts 2026-08-16 --fine 5m
 *
 * ─── The question ────────────────────────────────────────────────────────
 * Every result this project quotes was scored on ONE-HOUR bars. A one-hour
 * bar records only four prices: open, high, low, close. It does not record the
 * ORDER they happened in.
 *
 * So when a bar's low reaches the stop and its high reaches a target, the
 * scorer cannot know which came first. It has to guess, and it guesses the bad
 * one — stop first — because assuming the good one would flatter every result.
 *
 * That guess is safe over a three-day hold and load-bearing over a two-hour
 * one. Before anything is rebuilt for shorter holds, it is worth knowing how
 * often the guess was wrong.
 *
 * ─── How ─────────────────────────────────────────────────────────────────
 * Score every live plan twice, identical in every respect except the bar size,
 * and compare. Same plans, same anchor, same cost, same wall-clock windows —
 * 24h to fill and 72h to hold are converted into the finer bar count, or the
 * two runs would not be measuring the same trade.
 *
 * Finer bars can only ever REVEAL the order; they cannot invent it. So where
 * the two disagree, the finer one is right and the 1h number was the guess.
 *
 * Read-only. Nothing is written anywhere.
 */
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config({ path: '.env.production' });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { scoreTrade, TradeScore } from '../../src/common/replay/trade-scoring';
import {
  FILL_WINDOW_HOURS,
  MAX_HOLD_HOURS,
  OUTCOME_WINDOW_HOURS,
  DEFAULT_ROUND_TRIP_PCT,
} from '../../src/analysis-coordinator/outcome';
import type { TimeInterval } from '../../src/common/types/candle.types';
import type { AnalysisRecord } from '../../src/analysis-coordinator/analyze.service';
import type { TradePlan } from '../../src/analysis/services/trade-plan.service';

Logger.overrideLogger(false);
const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SINCE = new Date(argv[0]?.startsWith('--') ? '2026-08-16' : (argv[0] ?? '2026-08-16'));
const FINE = flag('fine', '5m') as TimeInterval;

/** Bars per hour, so both runs cover the same wall-clock window. */
const PER_HOUR: Record<string, number> = { '1m': 60, '5m': 12, '15m': 4, '1h': 1 };
const MULT = PER_HOUR[FINE];
if (!MULT) throw new Error(`--fine must be one of ${Object.keys(PER_HOUR).join(', ')}`);

const cfg = (mult: number) => ({
  fillBars: FILL_WINDOW_HOURS * mult,
  maxBars: MAX_HOLD_HOURS * mult,
  breakevenAfterTarget: 1,
  roundTripPct: DEFAULT_ROUND_TRIP_PCT,
});

const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const mean = (x: number[]) => (x.length ? sum(x) / x.length : NaN);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—');

interface Pair {
  coin: string;
  dir: 'long' | 'short';
  coarse: TradeScore;
  fine: TradeScore;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const binance = new BinanceService(cache, new CacheTelemetryService());

  const rows = await prisma.coordinatorRun.findMany({
    where: { createdAt: { gte: SINCE } },
    orderBy: { createdAt: 'asc' },
    select: { symbol: true, createdAt: true, coordinatorPayload: true, errorMessage: true },
  });

  console.log(
    `\nscoring ${rows.length} analyses twice — 1h vs ${FINE} — since ${SINCE.toISOString().slice(0, 10)}\n`,
  );

  const pairs: Pair[] = [];
  let skipped = 0;
  const CONC = 4; // finer bars mean more requests per analysis; be politer
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(
      rows.slice(i, i + CONC).map(async (row) => {
        const a = row.coordinatorPayload as AnalysisRecord | null;
        if (row.errorMessage || !a?.plans?.length) return;
        const at = row.createdAt.getTime();

        const [kCoarse, kFine] = await Promise.all([
          binance
            .getCandlesFrom(row.symbol, '1h', at, OUTCOME_WINDOW_HOURS + 2)
            .catch(() => []),
          binance
            .getCandlesFrom(row.symbol, FINE, at, (OUTCOME_WINDOW_HOURS + 2) * MULT)
            .catch(() => []),
        ]);

        const fwdCoarse = kCoarse.filter((c) => c.time.getTime() > at);
        const fwdFine = kFine.filter((c) => c.time.getTime() > at);
        // Both runs must actually reach the end of the hold, or a difference
        // would just be one of them running out of data.
        if (fwdCoarse.length < OUTCOME_WINDOW_HOURS || fwdFine.length < OUTCOME_WINDOW_HOURS * MULT) {
          skipped += 1;
          return;
        }

        for (const p of a.plans as TradePlan[]) {
          const coarse = scoreTrade(fwdCoarse, p, cfg(1));
          const fine = scoreTrade(fwdFine, p, cfg(MULT));
          // A plan that never opened on either clock has nothing to compare.
          if (!coarse.filled && !fine.filled) continue;
          pairs.push({ coin: row.symbol, dir: p.direction, coarse, fine });
        }
      }),
    );
    process.stdout.write(`\r  ${Math.min(i + CONC, rows.length)}/${rows.length}`);
  }

  console.log(`\n\n${pairs.length} plans scored on both clocks (${skipped} skipped: not enough history yet)\n`);
  if (pairs.length === 0) return;

  // ── 1. did the verdict change ──
  const changed = pairs.filter((p) => p.coarse.status !== p.fine.status);
  const fillFlip = pairs.filter((p) => p.coarse.filled !== p.fine.filled);

  console.log('1. THE VERDICT');
  console.log(`   status changed        ${changed.length}/${pairs.length}  ${pct(changed.length, pairs.length)}`);
  console.log(`   opened on one clock only  ${fillFlip.length}  ${pct(fillFlip.length, pairs.length)}`);

  const moves = new Map<string, number>();
  for (const p of changed) {
    const k = `${p.coarse.status} → ${p.fine.status}`;
    moves.set(k, (moves.get(k) ?? 0) + 1);
  }
  if (moves.size) {
    console.log('\n   what changed into what');
    console.table(
      [...moves.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([move, n]) => ({ move, n })),
    );
  }

  // ── 2. did the number change ──
  //
  // Only trades that OPENED on both clocks can be compared like for like. An
  // unfilled trade scores NaN on purpose — the scorer refuses to let a trade
  // that never happened be averaged in as a zero — so the flips are counted
  // separately below rather than folded into a mean that would then be a lie.
  const both = pairs.filter((p) => p.coarse.filled && p.fine.filled);
  const rc = both.map((p) => p.coarse.netR);
  const rf = both.map((p) => p.fine.netR);
  const diffs = both.map((p) => p.fine.netR - p.coarse.netR);
  const worse = diffs.filter((d) => d < -1e-9).length;
  const better = diffs.filter((d) => d > 1e-9).length;

  console.log(`\n2. THE NUMBER  (${both.length} trades that opened on both clocks)`);
  console.table([
    { clock: '1h (what we quote)', n: both.length, 'mean netR': f(mean(rc)), 'total R': f(sum(rc), 1) },
    { clock: `${FINE} (the truth)`, n: both.length, 'mean netR': f(mean(rf)), 'total R': f(sum(rf), 1) },
  ]);
  console.log(
    `   the 1h approximation is off by ${f(mean(diffs))}R per trade ` +
      `(${f(sum(diffs), 1)}R in total)`,
  );
  console.log(`   it flattered ${worse} trades and understated ${better}`);

  // Trades the coarse clock missed entirely are not a rounding error — they
  // are trades that did or did not happen, so they get their own line.
  const onlyFine = pairs.filter((p) => !p.coarse.filled && p.fine.filled);
  const onlyCoarse = pairs.filter((p) => p.coarse.filled && !p.fine.filled);
  if (onlyFine.length || onlyCoarse.length) {
    console.log(`\n   opened on ${FINE} but not on 1h: ${onlyFine.length}` +
      (onlyFine.length ? ` · worth ${f(sum(onlyFine.map((p) => p.fine.netR)), 2)}R the 1h clock never saw` : ''));
    console.log(`   opened on 1h but not on ${FINE}: ${onlyCoarse.length}` +
      (onlyCoarse.length ? ` · the 1h clock booked ${f(sum(onlyCoarse.map((p) => p.coarse.netR)), 2)}R that never happened` : ''));
  }

  // ── 3. the specific guess this was written to test ──
  // A bar that reaches BOTH the stop and a target is the ambiguous one. The
  // 1h scorer resolves it as a stop-out. Where the finer clock says the target
  // came first, that guess cost real R.
  const coarseStopped = both.filter((p) => p.coarse.status === 'STOPPED' || p.coarse.status === 'PARTIAL');
  const rescued = coarseStopped.filter((p) => p.fine.netR > p.coarse.netR + 1e-9);
  console.log('\n3. THE STOP-FIRST GUESS');
  console.log(
    `   ${coarseStopped.length} trades the 1h clock called stopped or partial · ` +
      `${rescued.length} did better on ${FINE} (${pct(rescued.length, coarseStopped.length)})`,
  );
  if (rescued.length) {
    console.log(`   worth ${f(sum(rescued.map((p) => p.fine.netR - p.coarse.netR)), 2)}R between them`);
  }

  // ── 4. does it matter more for short holds? ──
  // The whole reason for asking. If the error concentrates in the trades that
  // finished fastest, then scoring 1-3h holds on 1h bars is measuring the
  // assumption rather than the strategy.
  console.log('\n4. BY HOW LONG THE TRADE LASTED  (hours, on the fine clock)');
  const bucket = (h: number) => (h <= 3 ? '0-3h' : h <= 12 ? '3-12h' : h <= 24 ? '12-24h' : '24h+');
  const byHold = new Map<string, number[]>();
  for (const p of both) {
    const hours = p.fine.barsHeld / MULT;
    const k = bucket(hours);
    byHold.set(k, [...(byHold.get(k) ?? []), p.fine.netR - p.coarse.netR]);
  }
  console.table(
    ['0-3h', '3-12h', '12-24h', '24h+']
      .filter((k) => byHold.has(k))
      .map((k) => {
        const d = byHold.get(k)!;
        return {
          held: k,
          n: d.length,
          'mean error (R)': f(mean(d)),
          'largest single': f(Math.max(...d.map(Math.abs))),
        };
      }),
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
