/**
 * Read-only diagnostics over the saved analyses.
 *
 *   npx ts-node test/manual/diagnose.ts
 *   npx ts-node test/manual/diagnose.ts --md report.md
 *   npx ts-node test/manual/diagnose.ts --self-check
 *
 * Answers questions the CSVs cannot: max favourable/adverse excursion, and
 * what the breakeven stop actually cost, by re-scoring every filled plan a
 * SECOND time with the rule switched off and diffing the two.
 *
 * ─── What this is not ────────────────────────────────────────────────────
 * Not a decision tool and not wired to anything. It changes no strategy code,
 * writes nothing back, and its counterfactual is a lower bound on regret, not
 * a proposal — see `counterfactual` below for why the two are different.
 *
 * ─── One deliberate difference from forward-test.ts ──────────────────────
 * NO ZONE DEDUP. forward-test collapses the three-times-a-day re-analysis of
 * the same zone into one opportunity, because counting all three triples n and
 * makes one good zone look like three wins. That is right for measuring edge
 * and wrong here: this asks "does the plan GEOMETRY work", and a repeated zone
 * is an independent observation of the same geometry. It also means every n
 * below is larger than the forward test's, and win rates are NOT comparable to
 * it. Stated because a silently different denominator is how two honest
 * reports end up disagreeing.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

// Same default as forward-test: the schedule writes to Neon, and .env.local
// points at an empty localhost Postgres that would print a clean zero.
dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'production'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { AnalysisRecord } from '../../src/analysis-coordinator/analyze.service';
import { Candle } from '../../src/common/types/candle.types';
import { findFirstFill } from '../../src/common/replay/replay';
import { scoreLadder } from '../../src/common/replay/plan-replay';
import { costR, FILL_WINDOW_HOURS } from '../../src/analysis-coordinator/outcome';
import { TradePlan } from '../../src/analysis/services/trade-plan.service';

Logger.overrideLogger(false);

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MAX_HOLD_H = Number(flag('max-hold', '72'));
const MD = flag('md', '');
const CSV = flag('csv', '');

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── excursions ──────────────────────────────────────────────────────────

export interface Excursion {
  /** Furthest the trade ever went IN our favour, in R, before it closed. */
  mfeR: number;
  /** Furthest it ever went AGAINST us, in R. Positive = adverse. */
  maeR: number;
}

/**
 * MFE and MAE over the bars the trade was actually alive for.
 *
 * Measured from `averageEntry` and divided by the ORIGINAL `riskPerUnit`, so
 * 1R always means the distance to the stop as first printed — moving the stop
 * to breakeven must not silently rescale the ruler.
 *
 * Bounded by `bars`, not by the whole candle array: excursion after the
 * position closed is not excursion, it is hindsight.
 */
export function excursions(
  post: Candle[],
  input: { direction: 'long' | 'short'; averageEntry: number; riskPerUnit: number },
  bars: number,
): Excursion {
  const long = input.direction === 'long';
  let mfe = 0;
  let mae = 0;
  for (const c of post.slice(0, Math.max(bars, 0))) {
    const fav = long ? c.high - input.averageEntry : input.averageEntry - c.low;
    const adv = long ? input.averageEntry - c.low : c.high - input.averageEntry;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
  }
  if (input.riskPerUnit === 0) return { mfeR: 0, maeR: 0 };
  return { mfeR: mfe / input.riskPerUnit, maeR: mae / input.riskPerUnit };
}

/**
 * How close price came to the entry, as a percentage, for a plan that never
 * filled. Zero or negative means it reached the entry.
 *
 * A long fills when a low touches the entry, so the gap is measured from the
 * LOWEST low; a short from the highest high. Using the close would report a
 * miss on a bar that wicked straight through the entry.
 */
export function gapToEntry(
  window: Candle[],
  direction: 'long' | 'short',
  entry: number,
): number | null {
  if (window.length === 0 || entry === 0) return null;
  const best =
    direction === 'long'
      ? Math.min(...window.map((c) => c.low))
      : Math.max(...window.map((c) => c.high));
  const gap = direction === 'long' ? best - entry : entry - best;
  return (gap / entry) * 100;
}

// ── stats helpers ───────────────────────────────────────────────────────

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pearson r. Null rather than NaN when either series is constant. */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

const f = (x: number, d = 3): string => x.toFixed(d);
const pct = (a: number, b: number): string =>
  b === 0 ? '—' : `${((a / b) * 100).toFixed(0)}%`;

// ── the row ─────────────────────────────────────────────────────────────

type Outcome = 'PENDING' | 'MISSED' | 'OPEN' | 'STOPPED' | 'PARTIAL' | 'ALL_TARGETS';

/** The five checklist conditions, keyed as they are stored on the analysis. */
const CONDITION_KEYS = [
  'rsi',
  'qqe',
  'bollingerBand',
  'marketStructure',
  'supportResistance',
] as const;
type ConditionKey = (typeof CONDITION_KEYS)[number];

interface Row {
  coin: string;
  time: Date;
  direction: 'long' | 'short';
  regime: string;
  route: string;
  sources: number;
  conditionsMet: number | null;
  /** Per-condition pass/fail, null on the squeeze route which runs no checklist. */
  conditions: Record<ConditionKey, boolean | null>;
  /**
   * The direction the checklist was EVALUATED for, which is not necessarily
   * this plan's direction — one checklist is attached to both plans.
   */
  checklistFor: 'long' | 'short' | null;
  /** Raw indicator readings at the moment the analysis was produced. */
  rsi: number | null;
  adx: number | null;
  pdi: number | null;
  mdi: number | null;
  /** Where price sat between the Bollinger bands: 0 = lower, 1 = upper. */
  percentB: number | null;
  bandWidth: number | null;
  qqe: string | null;
  structure: string | null;
  /** The zone the entry was built on. */
  zoneType: 'support' | 'resistance';
  zoneLow: number;
  zoneHigh: number;
  /** Signed: negative = the zone sits BELOW spot, i.e. price was above it. */
  zoneDistancePercent: number;
  /** 'long' at a support zone, 'short' at a resistance zone. */
  impliedDirection: 'long' | 'short';
  riskPercent: number;
  plannedR: number;
  outcome: Outcome;
  targetsHit: number;
  grossR: number | null;
  costR: number;
  netR: number | null;
  mfeR: number | null;
  maeR: number | null;
  barsHeld: number | null;
  /** Gross R the same bars would have produced with the breakeven rule OFF. */
  counterfactualR: number | null;
  counterfactualStatus: string | null;
  /** Percent price still had to travel to fill. Only for PENDING / MISSED. */
  gapPercent: number | null;
}

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };
  const bar = (high: number, low: number): Candle =>
    ({ high, low, open: low, close: high, time: new Date(0), volume: 0 }) as Candle;

  // Long from 100 with 1R = 10. Bar 1 runs to 108 (+0.8R) and dips to 96
  // (-0.4R); bar 2 is inside it and must not move either extreme.
  const e = excursions(
    [bar(108, 96), bar(102, 99)],
    { direction: 'long', averageEntry: 100, riskPerUnit: 10 },
    2,
  );
  assert(Math.abs(e.mfeR - 0.8) < 1e-9, 'MFE is the best high, in R');
  assert(Math.abs(e.maeR - 0.4) < 1e-9, 'MAE is the worst low, in R, sign-flipped');

  // The bar cap is the whole point: a bar after the close must be invisible.
  const capped = excursions(
    [bar(101, 100), bar(200, 100)],
    { direction: 'long', averageEntry: 100, riskPerUnit: 10 },
    1,
  );
  assert(Math.abs(capped.mfeR - 0.1) < 1e-9, 'excursion stops at the close bar');

  // Short is the mirror: favourable is DOWN.
  const short = excursions(
    [bar(104, 90)],
    { direction: 'short', averageEntry: 100, riskPerUnit: 10 },
    1,
  );
  assert(Math.abs(short.mfeR - 1.0) < 1e-9, 'a short profits when price falls');
  assert(Math.abs(short.maeR - 0.4) < 1e-9, 'a short suffers when price rises');

  // Gap: a long entry at 100 whose lowest low was 102 is still 2% away.
  assert(
    Math.abs((gapToEntry([bar(105, 102)], 'long', 100) as number) - 2) < 1e-9,
    'gap uses the lowest low for a long',
  );
  assert(
    (gapToEntry([bar(101, 95)], 'long', 100) as number) < 0,
    'a low through the entry is not a gap',
  );

  assert(correlation([1, 2, 3], [2, 4, 6]) === 1, 'perfect positive correlation');
  assert(correlation([1, 1, 1], [1, 2, 3]) === null, 'no correlation without variance');
  assert(
    Math.abs((correlation([1, 2, 3], [3, 2, 1]) as number) + 1) < 1e-9,
    'perfect negative correlation',
  );

  console.log('self-check passed (excursions, entry gap, correlation)');
}

if (args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  console.log(s);
};

function table(headers: string[], rows: Array<Array<string | number>>): void {
  say(`| ${headers.join(' | ')} |`);
  say(`|${headers.map(() => '---').join('|')}|`);
  for (const r of rows) say(`| ${r.join(' | ')} |`);
  say();
}

/** Win rate / winner / loser / expectancy for one bucket. Used by §1, §4, §5. */
function profile(rows: Row[]): {
  n: number;
  winRate: string;
  avgWin: string;
  avgLose: string;
  medWin: string;
  medLose: string;
  expectancy: string;
} {
  const net = rows.map((r) => r.netR as number).filter((x) => Number.isFinite(x));
  const w = net.filter((x) => x > 0);
  const l = net.filter((x) => x <= 0);
  return {
    n: net.length,
    winRate: pct(w.length, net.length),
    avgWin: w.length ? f(mean(w)) : '—',
    avgLose: l.length ? f(mean(l)) : '—',
    medWin: w.length ? f(median(w)) : '—',
    medLose: l.length ? f(median(l)) : '—',
    expectancy: net.length ? f(mean(net)) : '—',
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const raw = (await prisma.coordinatorRun.findMany({
    where: { errorMessage: null },
    select: { id: true, symbol: true, createdAt: true, coordinatorPayload: true },
    orderBy: { createdAt: 'asc' },
  })) as unknown as Array<{
    id: string;
    symbol: string;
    createdAt: Date;
    coordinatorPayload: AnalysisRecord;
  }>;

  if (raw.length === 0) {
    console.log('No saved analyses. Is DATABASE_URL pointing at the deployed database?');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const coins = [...new Set(raw.map((r) => r.symbol))].sort();
  const now = Date.now();
  const hours =
    Math.ceil((now - raw[0].createdAt.getTime()) / 3_600_000) + MAX_HOLD_H + 24;

  const binance = new BinanceService(cache, new CacheTelemetryService());
  const candles = new Map<string, Candle[]>();
  for (const coin of coins) {
    candles.set(
      coin,
      await binance.getCandlesPaged(coin, '1h', Math.min(hours, 8760)).catch(() => []),
    );
  }

  const rows: Row[] = [];

  for (const run of raw) {
    const a = run.coordinatorPayload;
    const series = (candles.get(run.symbol) ?? []).filter(
      (c) => c.time.getTime() > run.createdAt.getTime(),
    );
    const elapsedH = (now - run.createdAt.getTime()) / 3_600_000;

    for (const plan of a.plans as TradePlan[]) {
      const m = a.regime?.metrics;
      const bb = m?.bollingerBands;
      const cl = a.checklists?.[plan.direction] as
        | (Record<ConditionKey, { passed: boolean; value?: number | string }> & {
            conditionsMet: number;
            tradeType: 'long' | 'short';
          })
        | null
        | undefined;
      // Kept so a re-run against rows saved BEFORE the per-direction fix still
      // reports the mismatch instead of silently reading null.
      const legacy = (a as unknown as { checklist?: { tradeType?: 'long' | 'short' } })
        .checklist;

      // The checklist is evaluated per direction, and the squeeze route runs
      // none at all — so `null` here means "not asked", which §8 must exclude
      // rather than score as a failed condition.
      const conditions = Object.fromEntries(
        CONDITION_KEYS.map((k) => [k, cl?.[k]?.passed ?? null]),
      ) as Record<ConditionKey, boolean | null>;

      const zone = plan.zone;
      const base = {
        coin: run.symbol,
        time: run.createdAt,
        direction: plan.direction,
        regime: a.regime?.regime ?? 'UNKNOWN',
        route: a.route ?? 'UNKNOWN',
        sources: zone?.sources?.length ?? 0,
        conditionsMet: cl?.conditionsMet ?? null,
        conditions,
        checklistFor: cl?.tradeType ?? legacy?.tradeType ?? null,
        rsi: m?.rsi ?? null,
        adx: m?.adx ?? null,
        pdi: m?.pdi ?? null,
        mdi: m?.mdi ?? null,
        // %B places price on the band scale, which is what the checklist's
        // "band extreme" condition is really asking about. Undefined when the
        // bands are degenerate rather than silently 0.
        percentB:
          bb && bb.upper !== bb.lower
            ? (a.map.spot - bb.lower) / (bb.upper - bb.lower)
            : null,
        bandWidth: m?.bandWidth ?? null,
        qqe: (cl?.qqe?.value as string) ?? null,
        structure: (cl?.marketStructure?.value as string) ?? null,
        zoneType: zone.type,
        zoneLow: zone.low,
        zoneHigh: zone.high,
        zoneDistancePercent: zone.distancePercent,
        // A support zone is a place to buy and a resistance zone a place to
        // sell. This is the zone's OWN label, assigned relative to spot when
        // the level map was built — not re-derived here.
        impliedDirection: (zone.type === 'support' ? 'long' : 'short') as
          | 'long'
          | 'short',
        riskPercent: plan.riskPercent,
        plannedR: plan.blendedR,
        costR: costR(plan.riskPercent),
      };

      const action = plan.direction === 'long' ? 'LONG' : 'SHORT';
      const fill = findFirstFill(series, action, plan.averageEntry);

      if (!fill) {
        // The fill scan and the gap must see the SAME bars, or a plan can be
        // reported as 3% away using a window the filler never looked at.
        const cutoff = run.createdAt.getTime() + FILL_WINDOW_HOURS * 3_600_000;
        const window = series.filter((c) => c.time.getTime() <= cutoff);
        rows.push({
          ...base,
          outcome: elapsedH >= FILL_WINDOW_HOURS ? 'MISSED' : 'PENDING',
          targetsHit: 0,
          grossR: null,
          netR: null,
          mfeR: null,
          maeR: null,
          barsHeld: null,
          counterfactualR: null,
          counterfactualStatus: null,
          gapPercent: gapToEntry(window, plan.direction, plan.averageEntry),
        });
        continue;
      }

      // Both scorings see an IDENTICAL candle array, capped at the hold limit.
      // Giving the counterfactual more bars than the real trade got would
      // credit the rule change with time, not with the rule.
      const closeAt = fill.time.getTime() + MAX_HOLD_H * 3_600_000;
      const post = series.filter(
        (c) => c.time.getTime() > fill.time.getTime() && c.time.getTime() <= closeAt,
      );
      const ladder = {
        direction: plan.direction,
        averageEntry: plan.averageEntry,
        stop: plan.stop,
        riskPerUnit: plan.riskPerUnit,
        targets: plan.targets,
      };

      const actual = scoreLadder(post, ladder);
      const noBreakeven = scoreLadder(post, { ...ladder, breakevenAfterTarget: 0 });
      const ex = excursions(post, ladder, actual.barsHeld);

      rows.push({
        ...base,
        outcome: actual.status === 'TIMEOUT' ? 'OPEN' : actual.status,
        targetsHit: actual.targetsHit,
        grossR: actual.realizedR,
        netR: actual.realizedR - base.costR,
        mfeR: ex.mfeR,
        maeR: ex.maeR,
        barsHeld: actual.barsHeld,
        counterfactualR: noBreakeven.realizedR,
        counterfactualStatus: noBreakeven.status,
        gapPercent: null,
      });
    }
  }

  const filled = rows.filter((r) => r.netR !== null);
  const closed = filled.filter((r) => r.outcome !== 'OPEN');
  const open = filled.filter((r) => r.outcome === 'OPEN');
  const spanDays = (now - raw[0].createdAt.getTime()) / 86_400_000;

  // ── header ───────────────────────────────────────────────────────────
  say('# Meridian trade diagnostics');
  say();
  say(`Read-only. No strategy logic touched, nothing written back.`);
  say();
  table(
    ['field', 'value'],
    [
      ['analyses in DB', raw.length],
      ['plans emitted', rows.length],
      ['filled', filled.length],
      ['closed', closed.length],
      ['still open', open.length],
      ['coins', coins.length],
      ['window', `${spanDays.toFixed(1)} days`],
      ['hold cap', `${MAX_HOLD_H}h`],
    ],
  );
  say(
    `> **No zone dedup.** The same zone re-analysed three times a day appears ` +
      `three times, so every \`n\` here is larger than \`pnpm forward-test\`'s and ` +
      `win rates are not comparable to it.`,
  );
  say();
  say(
    `> **${spanDays.toFixed(1)} days of data.** Losers close in a median of 8 bars ` +
      `and winners take 13-21, so a young sample over-collects losers. Read ` +
      `closed-only numbers as a floor, not an estimate.`,
  );
  say();

  // ── 1. R distribution ────────────────────────────────────────────────
  say('## 1. R distribution (closed trades only)');
  say();
  const p = profile(closed);
  const netClosed = closed.map((r) => r.netR as number);
  table(
    ['metric', 'value'],
    [
      ['closed trades', p.n],
      ['win rate', p.winRate],
      ['avg winner', p.avgWin],
      ['median winner', p.medWin],
      ['avg loser', p.avgLose],
      ['median loser', p.medLose],
      ['**expectancy / trade**', `**${p.expectancy}**`],
      ['total net R', f(netClosed.reduce((a, b) => a + b, 0), 1)],
      [
        'reconciles',
        `${f(mean(netClosed))} x ${p.n} = ${f(mean(netClosed) * p.n, 1)}`,
      ],
    ],
  );

  say('### Histogram, 0.5R buckets (net R)');
  say();
  const lo = Math.floor(Math.min(...netClosed) * 2) / 2;
  const hi = Math.ceil(Math.max(...netClosed) * 2) / 2;
  const hist: Array<[string, number]> = [];
  for (let b = lo; b < hi; b += 0.5) {
    const c = netClosed.filter((x) => x >= b && x < b + 0.5).length;
    hist.push([`${b.toFixed(1)} to ${(b + 0.5).toFixed(1)}`, c]);
  }
  table(
    ['bucket', 'n', 'share', 'bar'],
    hist.map(([label, c]) => [
      label,
      c,
      pct(c, netClosed.length),
      '#'.repeat(c),
    ]),
  );

  // ── 2. breakeven audit ───────────────────────────────────────────────
  say('## 2. Breakeven-stop audit');
  say();
  const scratched = closed.filter((r) => r.outcome === 'PARTIAL');
  const ranOn = closed.filter((r) => r.outcome === 'ALL_TARGETS');
  table(
    ['case', 'n', 'share of wins', 'avg net R', 'avg targets hit'],
    [
      [
        '(a) TP1 hit, remainder stopped',
        scratched.length,
        pct(scratched.length, scratched.length + ranOn.length),
        scratched.length ? f(mean(scratched.map((r) => r.netR as number))) : '—',
        scratched.length ? f(mean(scratched.map((r) => r.targetsHit)), 2) : '—',
      ],
      [
        '(b) reached every target',
        ranOn.length,
        pct(ranOn.length, scratched.length + ranOn.length),
        ranOn.length ? f(mean(ranOn.map((r) => r.netR as number))) : '—',
        ranOn.length ? f(mean(ranOn.map((r) => r.targetsHit)), 2) : '—',
      ],
    ],
  );

  // Only trades that actually banked a target can have been scratched BY the
  // breakeven rule; a plain STOPPED never moved the stop, so its counterfactual
  // is itself and including it would dilute the regret toward zero.
  const movedStop = closed.filter((r) => r.targetsHit > 0);
  const deltas = movedStop.map(
    (r) => (r.counterfactualR as number) - (r.grossR as number),
  );
  const helped = deltas.filter((d) => d > 1e-9).length;
  const hurt = deltas.filter((d) => d < -1e-9).length;
  say('### Counterfactual: the same bars with the breakeven rule OFF');
  say();
  table(
    ['metric', 'value'],
    [
      ['trades where the stop moved', movedStop.length],
      ['would have done better', helped],
      ['would have done worse', hurt],
      ['unchanged', movedStop.length - helped - hurt],
      ['**net R left on the table**', `**${f(deltas.reduce((a, b) => a + b, 0), 2)}**`],
      ['per affected trade', movedStop.length ? f(mean(deltas)) : '—'],
    ],
  );
  say(
    `> This is a **lower bound on regret, not a proposal.** Turning the rule off ` +
      `changes when positions free up, so the next trade would differ too — the ` +
      `\`--breakeven 0\` sweep in \`backtest:plans\` is the version that accounts ` +
      `for that.`,
  );
  say();

  // ── 3. MFE / MAE ─────────────────────────────────────────────────────
  say('## 3. MFE / MAE (closed trades, in R)');
  say();
  const mfe = closed.map((r) => r.mfeR as number);
  const mae = closed.map((r) => r.maeR as number);
  table(
    ['metric', 'mean', 'median', 'max'],
    [
      ['max favourable excursion', f(mean(mfe)), f(median(mfe)), f(Math.max(...mfe))],
      ['max adverse excursion', f(mean(mae)), f(median(mae)), f(Math.max(...mae))],
    ],
  );

  const cor = correlation(mfe, netClosed);
  const ran1R = closed.filter((r) => (r.mfeR as number) >= 1);
  const ran1RLost = ran1R.filter((r) => (r.netR as number) <= 0);
  table(
    ['question', 'answer'],
    [
      ['correlation(MFE, net R)', cor === null ? '—' : f(cor)],
      ['trades that ran >= 1R in our favour', ran1R.length],
      ['...of those, closed at a LOSS', `${ran1RLost.length} (${pct(ran1RLost.length, ran1R.length)})`],
      [
        '...their average net R',
        ran1R.length ? f(mean(ran1R.map((r) => r.netR as number))) : '—',
      ],
      [
        'avg MFE of trades that closed red',
        f(mean(closed.filter((r) => (r.netR as number) <= 0).map((r) => r.mfeR as number))),
      ],
    ],
  );

  say('### MFE bucket vs what we actually captured');
  say();
  const mfeBuckets: Array<[string, (r: Row) => boolean]> = [
    ['0 to 0.5R', (r) => (r.mfeR as number) < 0.5],
    ['0.5 to 1R', (r) => (r.mfeR as number) >= 0.5 && (r.mfeR as number) < 1],
    ['1 to 2R', (r) => (r.mfeR as number) >= 1 && (r.mfeR as number) < 2],
    ['2R+', (r) => (r.mfeR as number) >= 2],
  ];
  table(
    ['MFE bucket', 'n', 'win rate', 'avg net R', 'avg MFE', 'captured'],
    mfeBuckets.map(([label, fn]) => {
      const b = closed.filter(fn);
      const pr = profile(b);
      const m = b.length ? mean(b.map((r) => r.mfeR as number)) : 0;
      const g = b.length ? mean(b.map((r) => r.grossR as number)) : 0;
      return [
        label,
        b.length,
        pr.winRate,
        pr.expectancy,
        b.length ? f(m, 2) : '—',
        b.length && m !== 0 ? pct(Math.max(g, 0), m) : '—',
      ];
    }),
  );

  // ── 4. by regime / strategy ──────────────────────────────────────────
  say('## 4. By strategy type');
  say();
  const segs: Array<[string, Row[]]> = [
    ['COMPRESSION / breakout', closed.filter((r) => r.route === 'SQUEEZE_BREAKOUT')],
    ['confluence (TREND + MR)', closed.filter((r) => r.route !== 'SQUEEZE_BREAKOUT')],
    ['  ...TRENDING', closed.filter((r) => r.regime === 'TRENDING')],
    ['  ...MEAN_REVERSION', closed.filter((r) => r.regime === 'MEAN_REVERSION')],
  ];
  table(
    ['segment', 'n', 'win rate', 'avg winner', 'avg loser', 'expectancy'],
    segs.map(([label, b]) => {
      const pr = profile(b);
      return [label, pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
    }),
  );

  // ── 5. by coin and checklist ─────────────────────────────────────────
  say('## 5. By coin');
  say();
  table(
    ['coin', 'n', 'win rate', 'avg winner', 'avg loser', 'expectancy'],
    coins.map((c) => {
      const pr = profile(closed.filter((r) => r.coin === c));
      return [c, pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
    }),
  );

  say('### By checklist conditions met (confluence route only)');
  say();
  const withChecklist = closed.filter((r) => r.conditionsMet !== null);
  const metValues = [...new Set(withChecklist.map((r) => r.conditionsMet as number))].sort();
  table(
    ['conditions met', 'n', 'win rate', 'avg winner', 'avg loser', 'expectancy'],
    metValues.map((m) => {
      const pr = profile(withChecklist.filter((r) => r.conditionsMet === m));
      return [`${m} / 5`, pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
    }),
  );

  say('### By confluence sources');
  say();
  const srcValues = [...new Set(closed.map((r) => r.sources))].sort((a, b) => a - b);
  table(
    ['sources', 'n', 'win rate', 'avg winner', 'avg loser', 'expectancy'],
    srcValues.map((s) => {
      const pr = profile(closed.filter((r) => r.sources === s));
      return [s, pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
    }),
  );

  // ── 6. fill / expiry ─────────────────────────────────────────────────
  say('## 6. Fill and expiry — are the entries reachable?');
  say();
  const missed = rows.filter((r) => r.outcome === 'MISSED');
  const pending = rows.filter((r) => r.outcome === 'PENDING');
  table(
    ['bucket', 'n', 'share of all plans', 'median gap to entry', 'mean gap'],
    [
      [
        'MISSED (window expired)',
        missed.length,
        pct(missed.length, rows.length),
        missed.length ? `${f(median(missed.map((r) => r.gapPercent ?? 0)), 2)}%` : '—',
        missed.length ? `${f(mean(missed.map((r) => r.gapPercent ?? 0)), 2)}%` : '—',
      ],
      [
        'PENDING (still waiting)',
        pending.length,
        pct(pending.length, rows.length),
        pending.length ? `${f(median(pending.map((r) => r.gapPercent ?? 0)), 2)}%` : '—',
        pending.length ? `${f(mean(pending.map((r) => r.gapPercent ?? 0)), 2)}%` : '—',
      ],
      ['FILLED', filled.length, pct(filled.length, rows.length), '—', '—'],
    ],
  );

  say('### How far the unfilled plans actually got');
  say();
  const unfilled = [...missed, ...pending].filter((r) => r.gapPercent !== null);
  const gapBuckets: Array<[string, (g: number) => boolean]> = [
    // Tripwire, not a bucket. `findFirstFill` and `gapToEntry` read the same
    // rule off the same bars, so a plan that reached its entry cannot also be
    // unfilled. Any count here means the two have drifted apart — without the
    // row it would hide inside "within 0.25%" and read as a near miss.
    ['reached entry (must be 0)', (g) => g <= 0],
    ['within 0.25%', (g) => g > 0 && g < 0.25],
    ['0.25 - 0.5%', (g) => g >= 0.25 && g < 0.5],
    ['0.5 - 1%', (g) => g >= 0.5 && g < 1],
    ['1 - 2%', (g) => g >= 1 && g < 2],
    ['2%+', (g) => g >= 2],
  ];
  table(
    ['distance still needed', 'n', 'share'],
    gapBuckets.map(([label, fn]) => {
      const b = unfilled.filter((r) => fn(r.gapPercent as number));
      return [label, b.length, pct(b.length, unfilled.length)];
    }),
  );
  say(
    `> A long fills when a LOW touches the entry, so the gap is measured from ` +
      `the lowest low inside the ${FILL_WINDOW_HOURS}h window — the same bars ` +
      `the filler saw.`,
  );
  say();

  // ── 7. was the direction right? ──────────────────────────────────────
  say('## 7. Direction vs the zone the entry was built on');
  say();

  const n2 = (x: number | null, d = 1): string => (x === null ? '—' : x.toFixed(d));
  const side = (r: Row): string =>
    r.zoneDistancePercent < 0 ? 'above' : 'below';
  const wrongSide = (r: Row): boolean => r.direction !== r.impliedDirection;

  const dump = (label: string, rows: Row[]): void => {
    say(`### ${label} (n=${rows.length})`);
    say();
    table(
      [
        'coin',
        'route',
        'dir',
        'zone',
        'price vs zone',
        'implied',
        'match?',
        'RSI',
        'ADX',
        '+DI/-DI',
        '%B',
        'QQE',
        'HTF structure',
        'net R',
      ],
      rows.map((r) => [
        r.coin,
        r.route === 'SQUEEZE_BREAKOUT' ? 'squeeze' : 'confluence',
        r.direction,
        r.zoneType,
        side(r),
        r.impliedDirection,
        wrongSide(r) ? '**NO**' : 'yes',
        n2(r.rsi),
        n2(r.adx),
        `${n2(r.pdi)}/${n2(r.mdi)}`,
        n2(r.percentB, 2),
        r.qqe ?? '—',
        r.structure ?? '—',
        r.netR === null ? '—' : f(r.netR, 2),
      ]),
    );
  };

  const doa = closed.filter((r) => (r.mfeR as number) < 0.5);
  const zeroCondWins = closed.filter(
    (r) => r.conditionsMet === 0 && (r.netR as number) > 0,
  );

  dump('Dead on arrival — closed trades with MFE < 0.5R', doa);
  dump('Winners that met 0 of 5 checklist conditions', zeroCondWins);

  const longIntoRes = (rs: Row[]): Row[] =>
    rs.filter((r) => r.direction === 'long' && r.zoneType === 'resistance');
  const shortIntoSup = (rs: Row[]): Row[] =>
    rs.filter((r) => r.direction === 'short' && r.zoneType === 'support');

  say('### Direct answer — wrong side of the nearest zone');
  say();
  table(
    ['set', 'n', 'long into resistance', 'short into support', 'total wrong side', 'share'],
    [
      ['DOA (MFE < 0.5R)', doa.length, longIntoRes(doa).length, shortIntoSup(doa).length,
        longIntoRes(doa).length + shortIntoSup(doa).length,
        pct(longIntoRes(doa).length + shortIntoSup(doa).length, doa.length)],
      ['all closed', closed.length, longIntoRes(closed).length, shortIntoSup(closed).length,
        longIntoRes(closed).length + shortIntoSup(closed).length,
        pct(longIntoRes(closed).length + shortIntoSup(closed).length, closed.length)],
      ['0-condition winners', zeroCondWins.length, longIntoRes(zeroCondWins).length,
        shortIntoSup(zeroCondWins).length,
        longIntoRes(zeroCondWins).length + shortIntoSup(zeroCondWins).length,
        pct(longIntoRes(zeroCondWins).length + shortIntoSup(zeroCondWins).length,
          zeroCondWins.length)],
    ],
  );

  say('### Expectancy by whether the direction matched the zone');
  say();
  table(
    ['direction vs zone', 'n', 'win rate', 'avg winner', 'avg loser', 'expectancy'],
    [
      ['matched (long@support / short@resistance)', ...(() => {
        const pr = profile(closed.filter((r) => !wrongSide(r)));
        return [pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
      })()],
      ['opposed (long@resistance / short@support)', ...(() => {
        const pr = profile(closed.filter(wrongSide));
        return [pr.n, pr.winRate, pr.avgWin, pr.avgLose, pr.expectancy];
      })()],
    ],
  );

  // ── 8. per-condition correlation ─────────────────────────────────────
  say('## 8. Each checklist condition vs net R');
  say();
  say(
    `Point-biserial correlation of \`passed\` (1/0) against net R, over the ` +
      `closed trades that ran a checklist. A condition that helps should be ` +
      `**positive**; a negative one is firing backwards.`,
  );
  say();
  const scored = closed.filter((r) => r.conditionsMet !== null);

  // Before reading any correlation: is the checklist even about this plan?
  // `buildPlans` emits a long AND a short from the same level map, while
  // `routeFromRegime` is called with no direction and runs ONE checklist for a
  // direction it derives from trend. Whatever that direction is, the other
  // plan carries a checklist scored for the opposite trade.
  const aligned = scored.filter((r) => r.checklistFor === r.direction);
  const crossed = scored.filter(
    (r) => r.checklistFor !== null && r.checklistFor !== r.direction,
  );
  say('### First: was the checklist even evaluated for this plan?');
  say();
  table(
    ['checklist tradeType vs plan direction', 'n', 'share', 'expectancy'],
    [
      [
        'same direction',
        aligned.length,
        pct(aligned.length, scored.length),
        aligned.length ? f(mean(aligned.map((r) => r.netR as number))) : '—',
      ],
      [
        '**opposite direction**',
        crossed.length,
        pct(crossed.length, scored.length),
        crossed.length ? f(mean(crossed.map((r) => r.netR as number))) : '—',
      ],
    ],
  );
  say();

  table(
    ['condition', 'n scored', 'n passed', 'pass rate', 'expectancy WHEN PASSED', 'WHEN FAILED', 'correlation with net R'],
    CONDITION_KEYS.map((k) => {
      // Aligned rows only. Scoring a long plan against a short's checklist
      // measures the wiring, not the condition.
      const usable = aligned.filter((r) => r.conditions[k] !== null);
      const passedRows = usable.filter((r) => r.conditions[k] === true);
      const failedRows = usable.filter((r) => r.conditions[k] === false);
      const cr = correlation(
        usable.map((r) => (r.conditions[k] ? 1 : 0)),
        usable.map((r) => r.netR as number),
      );
      return [
        k,
        usable.length,
        passedRows.length,
        pct(passedRows.length, usable.length),
        passedRows.length ? f(mean(passedRows.map((r) => r.netR as number))) : '—',
        failedRows.length ? f(mean(failedRows.map((r) => r.netR as number))) : '—',
        cr === null ? '— (no variance)' : f(cr),
      ];
    }),
  );

  if (CSV) {
    const cols: Array<keyof Row> = [
      'coin', 'time', 'direction', 'regime', 'route', 'sources', 'conditionsMet',
      'checklistFor', 'rsi', 'adx', 'pdi', 'mdi', 'percentB', 'bandWidth', 'qqe',
      'structure', 'zoneType', 'zoneLow', 'zoneHigh', 'zoneDistancePercent',
      'impliedDirection', 'riskPercent', 'plannedR', 'outcome', 'targetsHit',
      'grossR', 'costR', 'netR', 'mfeR', 'maeR', 'barsHeld', 'counterfactualR',
      'gapPercent',
    ];
    const cell = (v: unknown): string =>
      v === null || v === undefined
        ? ''
        : v instanceof Date
          ? v.toISOString()
          : String(v);
    fs.writeFileSync(
      CSV,
      [
        `# ${rows.length} plans from ${raw.length} analyses, ${spanDays.toFixed(1)}d, hold ${MAX_HOLD_H}h, no zone dedup`,
        cols.join(','),
        ...rows.map((r) => cols.map((c) => cell(r[c])).join(',')),
      ].join('\n'),
    );
    console.log(`wrote ${rows.length} plans to ${CSV}`);
  }

  if (MD) {
    fs.writeFileSync(MD, out.join('\n'));
    console.log(`\nwrote ${MD}`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
