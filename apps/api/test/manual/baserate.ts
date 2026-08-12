/**
 * Base-rate signal research — P0 (feature table) and P1 (configs).
 *
 *   npx ts-node test/manual/baserate.ts --self-check
 *   npx ts-node test/manual/baserate.ts --years 3     # P0: build features.csv
 *   npx ts-node test/manual/baserate.ts --p1          # P1: read it, no refetch
 *
 * P0 builds one row per coin per 4h bar: four normalised, multi-timeframe
 * features plus the realised forward return, cached to
 * `results/features.csv` so no later phase refetches.
 *
 * P1 buckets those four features into an 81-value config key and asks the
 * one question that can end the project: do the configs separate forward
 * returns at all, or is their spread indistinguishable from chance?
 *
 * See MERIDIAN_BASERATE_PLAN.md. Neither phase builds a base rate, a signal
 * or a trade.
 *
 * ─── The two look-ahead leaks, and where each is stopped ─────────────────
 * LEAK 1, features. Every feature at bar i is read from candles that had
 * CLOSED by bar i's own close. `completedAsOf` enforces open + duration <=
 * asOf and is already spec'd in plan-replay.spec.ts, so it is reused rather
 * than re-derived. A forming 12h candle already contains the next ten hours.
 *
 * LEAK 2, resolution, is NOT this phase's problem — it belongs to the base
 * rate in P2. Recorded here only so the boundary is explicit: this file
 * writes the forward return of a bar, which is by definition future
 * information ABOUT that bar. That is the label. It becomes a leak only if a
 * later phase lets one row's label inform another row's decision before it
 * had resolved.
 *
 * LEAK 3, bucket boundaries, is designed out in P1 by using fixed constants
 * rather than sample percentiles. Nothing here computes a percentile.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { atrLatest } from '../../src/indicators/series';
import { ANALYSIS_CANDLE_LIMIT } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { DEFAULT_ROUND_TRIP_PCT } from '../../src/analysis-coordinator/outcome';
import { blockBootstrap } from './holdout';
import { makeRng } from './rng';

Logger.overrideLogger(false);

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,DOT,LINK,LTC')
  .split(',')
  .map((c) => c.trim().toUpperCase());
const YEARS = num('years', 3);
const OUT = str('out', 'test/manual/results/features.csv');

/** Sampling cadence. 4h, not 1h: see the overlap note in the plan. */
const SPINE: TimeInterval = '4h';
/** Feature timeframes. Both strictly slower than the spine. */
const MID: TimeInterval = '12h';
const SLOW: TimeInterval = '1d';

/**
 * Forward horizon, in spine bars. 12 x 4h = 48h.
 *
 * Sits between the backtest's 21-bar median hold and its 24h fill window.
 * DECLARED, not tuned — changing it is a new experiment, not an adjustment,
 * because every base rate downstream is conditioned on it.
 */
const HORIZON = num('horizon', 12);

/** Trailing window for the spine ATR. Bounded so the scan stays linear. */
const ATR_WINDOW = 100;
/** 1d bars behind the slow-timeframe average. */
const SLOW_SMA = 20;

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── features ────────────────────────────────────────────────────────────

export interface FeatureRow {
  coin: string;
  time: Date;
  close: number;
  atr: number;
  /** 12h RSI(14). Already 0-100, so pooled across coins without scaling. */
  rsi: number;
  /** 12h position in the Bollinger band: 0 = lower, 1 = upper. */
  percentB: number;
  /** 12h ADX(14) and its directional components. */
  adx: number;
  pdi: number;
  mdi: number;
  /** Distance from the 1d SMA20, as a percentage of that average. */
  slowBiasPercent: number;
  /**
   * Realised forward return over HORIZON spine bars, in ATR units.
   *
   * ATR-normalised rather than percent because BTC and AVAX differ ~3x in
   * volatility and percent would let the volatile coins dominate a pooled
   * base rate. This is the LABEL — future information about this bar, which
   * is what makes it a label rather than a leak.
   */
  forwardAtr: number;
}

/**
 * Where price sits between the Bollinger bands.
 *
 * Null rather than 0.5 when the bands are degenerate: a fabricated midpoint
 * would land every such bar in the middle bucket and quietly invent a mode.
 */
export function percentB(
  close: number,
  bands: { upper: number; lower: number },
): number | null {
  const span = bands.upper - bands.lower;
  return span === 0 ? null : (close - bands.lower) / span;
}

/** Percentage distance from a slow moving average. Null if it has no window yet. */
export function slowBias(close: number, closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const sma = window.reduce((a, b) => a + b, 0) / period;
  return sma === 0 ? null : ((close - sma) / sma) * 100;
}

/**
 * Forward return in ATR units, or null when the horizon runs off the end.
 *
 * Null is load-bearing: the last HORIZON bars of every coin have no label,
 * and defaulting them to 0 would plant a fake cluster of neutral outcomes at
 * the most recent — and therefore most tempting — end of the sample.
 */
export function forwardAtr(
  closes: number[],
  i: number,
  horizon: number,
  atr: number,
): number | null {
  const j = i + horizon;
  if (j >= closes.length || atr === 0) return null;
  return (closes[j] - closes[i]) / atr;
}

// ── P1: config encoding ─────────────────────────────────────────────────

/**
 * Bucket boundaries are FIXED CONSTANTS, never sample percentiles.
 *
 * LEAK 3, designed out by construction: a percentile computed over the whole
 * history would leak the future into every bar's bucket assignment. These
 * thresholds are the same ones P0 printed its distributions against, and are
 * immune. That immunity is worth more than the adaptivity.
 */
export type Bucket = 0 | 1 | 2;

export const bucketRsi = (rsi: number): Bucket => (rsi < 40 ? 0 : rsi > 60 ? 2 : 1);
export const bucketPercentB = (b: number): Bucket => (b < 0.2 ? 0 : b > 0.8 ? 2 : 1);
export const bucketTrend = (adx: number, pdi: number, mdi: number): Bucket =>
  adx < 20 ? 1 : pdi >= mdi ? 2 : 0;
export const bucketSlowBias = (bias: number): Bucket => (bias < -1 ? 0 : bias > 1 ? 2 : 1);

/** 4 features x 3 buckets = 81 configs. The hard cap from the plan. */
export const CONFIG_COUNT = 81;

export const configKey = (r: FeatureRow): number =>
  bucketRsi(r.rsi) * 27 +
  bucketPercentB(r.percentB) * 9 +
  bucketTrend(r.adx, r.pdi, r.mdi) * 3 +
  bucketSlowBias(r.slowBiasPercent);

const NAMES = {
  rsi: ['rsi<40', 'rsi40-60', 'rsi>60'],
  pb: ['%B<.2', '%B.2-.8', '%B>.8'],
  trend: ['down', 'flat', 'up'],
  bias: ['1d-below', '1d-near', '1d-above'],
};

export const configName = (key: number): string =>
  [
    NAMES.rsi[Math.floor(key / 27) % 3],
    NAMES.pb[Math.floor(key / 9) % 3],
    NAMES.trend[Math.floor(key / 3) % 3],
    NAMES.bias[key % 3],
  ].join(' · ');

/**
 * OPTION A — subtract the unconditional mean of the row's own era.
 *
 * P0 found the unconditional 48h drift is +0.0398 ATR and NOT stable: per
 * year it runs +0.32, +0.12, -0.02, -0.18, and per coin -0.10 (DOT) to +0.17
 * (BNB). Left alone, every config that happens to concentrate in 2023 looks
 * bullish and every one that concentrates in 2026 looks bearish — drift
 * masquerading as information, and it straddles the TUNE/HOLDOUT boundary
 * exactly.
 *
 * Era = (coin, calendar month). Coin as well as month because the per-coin
 * drift spread is the same trap on another axis.
 *
 * This is in-sample demeaning — the month's own mean, which includes bars
 * AFTER the row. That is lookahead, and it is why the demeaned number is a
 * diagnostic and never a signal. P2's point-in-time base rate must use a
 * TRAILING unconditional mean; anything else leaks.
 *
 * It does NOT bias in a known direction. An earlier version of this comment
 * claimed in-sample demeaning could only weaken a config, on the reasoning
 * that it strips more drift than a trailing mean. The P1 run refuted that:
 * separation went from 1.34x the null to 2.88x, because the drift was
 * MASKING the within-era relationship rather than inflating it. Removing a
 * suppressor amplifies. Read the raw column beside the demeaned one, always.
 */
export const eraKey = (r: FeatureRow): string =>
  `${r.coin}:${r.time.toISOString().slice(0, 7)}`;

export function demean(rows: FeatureRow[]): number[] {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const e = sums.get(eraKey(r)) ?? { sum: 0, n: 0 };
    e.sum += r.forwardAtr;
    e.n += 1;
    sums.set(eraKey(r), e);
  }
  return rows.map((r) => {
    const e = sums.get(eraKey(r))!;
    return r.forwardAtr - e.sum / e.n;
  });
}

/**
 * Occurrence-weighted SD of per-config mean label — the separation statistic.
 *
 * Weighted so a 40-row config cannot out-shout an 8,000-row one, and
 * restricted to configs above `minObs` so the tail of near-empty configs
 * does not drown the signal in its own sampling noise.
 *
 * Counts are derived here rather than passed in. They are invariant across
 * rotations so caching them would be faster, but a counts array that fell
 * out of step with `keys` yields NaN, NaN reports as p=1.00, and p=1.00
 * reads as "no signal" — a bug that looks exactly like the result we expect.
 * Not worth the microseconds.
 */
export function spread(keys: number[], labels: number[], minObs: number): number {
  const sums = new Array<number>(CONFIG_COUNT).fill(0);
  const counts = new Array<number>(CONFIG_COUNT).fill(0);
  for (let i = 0; i < keys.length; i += 1) {
    sums[keys[i]] += labels[i];
    counts[keys[i]] += 1;
  }

  let totalN = 0;
  let totalSum = 0;
  for (let c = 0; c < CONFIG_COUNT; c += 1) {
    if (counts[c] < minObs) continue;
    totalN += counts[c];
    totalSum += sums[c];
  }
  if (totalN === 0) return 0;

  const grand = totalSum / totalN;
  let ss = 0;
  for (let c = 0; c < CONFIG_COUNT; c += 1) {
    if (counts[c] < minObs) continue;
    ss += counts[c] * (sums[c] / counts[c] - grand) ** 2;
  }
  return Math.sqrt(ss / totalN);
}

/**
 * The null: rotate each coin's label series by a random offset, circularly.
 *
 * Rotation rather than shuffling because consecutive 4h rows share 11/12 of
 * their 48h window — element-wise shuffling would destroy that
 * autocorrelation, shrink the null spread, and manufacture significance.
 * A circular shift preserves the label series' correlation structure exactly
 * while severing its link to the features. Per coin, so each coin's own
 * drift and volatility stay attached to that coin in the null too.
 */
export function rotate(labels: number[], offset: number): number[] {
  const n = labels.length;
  const k = ((offset % n) + n) % n;
  return labels.slice(k).concat(labels.slice(0, k));
}

/** Seeded, so a reported p-value can be reproduced exactly. */
export const lcg = (seed: number) => (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/**
 * The permutation pre-test. Segments are per coin — rotation never crosses
 * a coin boundary.
 *
 * `p` is the share of rotations whose spread matched or beat the real one,
 * with the +1/+1 correction so a p of exactly 0 is never reported.
 */
export function permTest(
  segments: Array<{ keys: number[]; labels: number[] }>,
  minObs: number,
  iters: number,
  rand: () => number,
): { real: number; nullMean: number; nullP95: number; p: number; eligible: number } {
  const keys = segments.flatMap((s) => s.keys);
  const counts = new Array<number>(CONFIG_COUNT).fill(0);
  for (const k of keys) counts[k] += 1;

  const real = spread(
    keys,
    segments.flatMap((s) => s.labels),
    minObs,
  );

  const nulls: number[] = [];
  for (let it = 0; it < iters; it += 1) {
    const shifted = segments.flatMap((s) =>
      rotate(s.labels, Math.floor(rand() * s.labels.length)),
    );
    nulls.push(spread(keys, shifted, minObs));
  }
  nulls.sort((a, b) => a - b);

  return {
    real,
    nullMean: nulls.reduce((a, b) => a + b, 0) / nulls.length,
    nullP95: nulls[Math.floor(0.95 * (nulls.length - 1))],
    p: (nulls.filter((x) => x >= real).length + 1) / (nulls.length + 1),
    eligible: counts.filter((c) => c >= minObs).length,
  };
}

// ── P2: point-in-time base rate ─────────────────────────────────────────

/**
 * What a bar knows at the moment it would be traded.
 *
 * `edge` is OPTION A made causal: the config's mean over resolved history
 * minus the unconditional mean over that same history. Both expand as time
 * passes, so both lag drift equally and the difference does not inherit it.
 * `rawMean` is the undemeaned view, carried alongside because P1 showed the
 * two can point opposite ways on the same config.
 */
export interface BaseRateRow {
  edge: number | null;
  rawMean: number | null;
  /** Resolved occurrences of this config behind the estimate. */
  n: number;
  /**
   * Where this config's edge sat among ALL resolved configs at this instant,
   * in [0,1). Null until enough configs have resolved to rank against.
   *
   * This is the honest way to grade a row, and it beats ranking a row against
   * its calendar neighbours on both counts at once. Point-in-time: the whole
   * cross-section is known at T, so no future row sets the boundary. And
   * drift-immune for free: every config at instant T is measured against the
   * SAME unconditional mean, so that term cancels in the comparison and the
   * expanding baseline's lag cannot tilt the ranking.
   */
  rank: number | null;
}

/**
 * LEAK 2 — the resolution leak, and the arithmetic that pins it down.
 *
 * An occurrence at bar U does not know its own outcome the moment U passes.
 * Its label reads `close[U+HORIZON]`, which is not known until that bar
 * closes, at `time[U] + (HORIZON+1) * spine`. A decision at bar T is taken at
 * T's own close, `time[T] + spine`. So U may inform T only when
 *
 *     time[U] + (HORIZON+1) * spine  <=  time[T] + spine
 *     time[U] + HORIZON * spine      <=  time[T]
 *     time[U] + horizonMs            <=  time[T]
 *
 * which is the invariant from the plan, and `<=` is genuinely inclusive: at
 * equality the label resolves on the same tick the decision is taken, off a
 * close that has already happened.
 *
 * Writing `time[U] < time[T]` instead — "it already happened, so I can use
 * it" — is the natural thing to write and is the bug that has produced every
 * too-good base-rate backtest ever published. Setting horizonMs to 0
 * reproduces exactly that bug, which is how the self-check attacks it.
 */
export function baseRatesFast(
  rows: FeatureRow[],
  keys: number[],
  horizonMs: number,
  minObs: number,
): BaseRateRow[] {
  const configSum = new Array<number>(CONFIG_COUNT).fill(0);
  const configN = new Array<number>(CONFIG_COUNT).fill(0);
  let totalSum = 0;
  let totalN = 0;
  let j = 0;

  return rows.map((row, i) => {
    const t = row.time.getTime();
    // Monotone: rows are time-sorted, so `t` never goes backwards and this
    // pointer only ever advances. That is what makes the whole pass linear.
    while (j < rows.length && rows[j].time.getTime() + horizonMs <= t) {
      configSum[keys[j]] += rows[j].forwardAtr;
      configN[keys[j]] += 1;
      totalSum += rows[j].forwardAtr;
      totalN += 1;
      j += 1;
    }
    const k = keys[i];
    const n = configN[k];
    const rawMean = n > 0 ? configSum[k] / n : null;

    // Cross-sectional rank among configs resolved AT THIS INSTANT. Compares
    // raw config means rather than edges because the unconditional term is
    // identical for every config at T and cancels — same ranking, less work.
    let below = 0;
    let ranked = 0;
    if (n >= minObs) {
      for (let c = 0; c < CONFIG_COUNT; c += 1) {
        if (configN[c] < minObs) continue;
        ranked += 1;
        if (configSum[c] / configN[c] < rawMean!) below += 1;
      }
    }

    return {
      edge: n >= minObs && totalN > 0 ? configSum[k] / n - totalSum / totalN : null,
      rawMean,
      n,
      rank: ranked > 1 ? below / ranked : null,
    };
  });
}

/**
 * The same thing in O(n^2), scanning every row and filtering by the
 * invariant directly.
 *
 * Deliberately assumes nothing about ordering, so it cannot share the fast
 * version's bug if the fast version has one. Used to prove the pointer, then
 * never used again — it is 4x10^9 operations on the full table.
 */
export function baseRatesSlow(
  rows: FeatureRow[],
  keys: number[],
  horizonMs: number,
  minObs: number,
): BaseRateRow[] {
  return rows.map((row, i) => {
    const t = row.time.getTime();
    let cs = 0;
    let cn = 0;
    let ts = 0;
    let tn = 0;
    for (let u = 0; u < rows.length; u += 1) {
      if (rows[u].time.getTime() + horizonMs > t) continue;
      ts += rows[u].forwardAtr;
      tn += 1;
      if (keys[u] === keys[i]) {
        cs += rows[u].forwardAtr;
        cn += 1;
      }
    }
    // Same cross-sectional rank, recomputed from scratch per row.
    const means = new Array<number>(CONFIG_COUNT).fill(NaN);
    for (let c = 0; c < CONFIG_COUNT; c += 1) {
      let s = 0;
      let m = 0;
      for (let u = 0; u < rows.length; u += 1) {
        if (keys[u] !== c || rows[u].time.getTime() + horizonMs > t) continue;
        s += rows[u].forwardAtr;
        m += 1;
      }
      if (m >= minObs) means[c] = s / m;
    }
    const pool = means.filter((x) => Number.isFinite(x));

    return {
      edge: cn >= minObs && tn > 0 ? cs / cn - ts / tn : null,
      rawMean: cn > 0 ? cs / cn : null,
      n: cn,
      rank:
        cn >= minObs && pool.length > 1
          ? pool.filter((x) => x < cs / cn).length / pool.length
          : null,
    };
  });
}

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };
  const bar = (t: number, close: number): Candle =>
    ({
      time: new Date(t),
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
    }) as Candle;

  // ── %B ──
  assert(percentB(110, { upper: 120, lower: 100 }) === 0.5, 'mid-band is 0.5');
  assert(percentB(100, { upper: 120, lower: 100 }) === 0, 'lower band is 0');
  assert(percentB(130, { upper: 120, lower: 100 })! > 1, '%B is not clamped');
  assert(percentB(110, { upper: 100, lower: 100 }) === null, 'flat bands have no %B');

  // ── slow bias ──
  const flat = Array.from({ length: 20 }, () => 100);
  assert(slowBias(100, flat, 20) === 0, 'price at its own average is 0%');
  assert(Math.abs(slowBias(110, flat, 20)! - 10) < 1e-9, '10% above reads +10');
  assert(slowBias(100, flat.slice(0, 19), 20) === null, 'no verdict without the window');

  // ── forward return ──
  const closes = [100, 101, 102, 103, 104];
  assert(forwardAtr(closes, 0, 2, 1) === 2, 'two bars ahead at ATR 1 is +2');
  assert(forwardAtr(closes, 0, 2, 2) === 1, 'the same move at ATR 2 is +1');
  // Off the end must be null, never 0 — the tail of every coin is unlabelled.
  assert(forwardAtr(closes, 4, 2, 1) === null, 'the horizon may not run off the end');
  assert(forwardAtr(closes, 3, 2, 1) === null, 'nor land exactly on the end');
  assert(forwardAtr(closes, 2, 2, 1) === 2, 'the last labelled bar is horizon from the end');

  // ── LEAK 1: completedAsOf must hide a candle that has not closed ──
  // A 12h candle that opened 2h ago closes 10h from now; its high already
  // contains those ten hours. Visible at its close, invisible before.
  const twelveH = TIMEFRAME_MS['12h'];
  const opened = 1_000_000_000_000;
  const series = [bar(opened - twelveH, 1), bar(opened, 2)];
  const asOfDuring = opened + 2 * 3_600_000;
  const during = completedAsOf(series, twelveH, asOfDuring, 10);
  assert(during.length === 1, 'a forming 12h candle is not visible mid-bar');
  assert(during[0].close === 1, 'only the closed one survives');
  const after = completedAsOf(series, twelveH, opened + twelveH, 10);
  assert(after.length === 2, 'it becomes visible exactly at its close');

  // The spine bar's own asOf is its CLOSE, not its open — using the open
  // would hide a slow candle that closed inside the spine bar.
  const spineMs = TIMEFRAME_MS['4h'];
  assert(spineMs === 4 * 3_600_000, 'spine is 4h');
  const closedInside = completedAsOf(series, twelveH, opened + twelveH, 10);
  assert(closedInside.length === 2, 'a slow candle closing at the spine close is visible');

  // ── P1: bucket boundaries are exact, and on the documented side ──
  assert(bucketRsi(39.99) === 0 && bucketRsi(40) === 1, 'RSI 40 is the middle bucket');
  assert(bucketRsi(60) === 1 && bucketRsi(60.01) === 2, 'RSI 60 is still the middle');
  assert(bucketPercentB(0.19) === 0 && bucketPercentB(0.2) === 1, '%B 0.2 is the middle');
  assert(bucketPercentB(0.8) === 1 && bucketPercentB(0.81) === 2, '%B 0.8 is the middle');
  assert(bucketTrend(19.9, 5, 30) === 1, 'weak ADX is flat whatever the DIs say');
  assert(bucketTrend(25, 30, 5) === 2 && bucketTrend(25, 5, 30) === 0, 'DI picks the side');
  assert(bucketSlowBias(-1) === 1 && bucketSlowBias(-1.01) === 0, '-1% is still near');
  assert(bucketSlowBias(1) === 1 && bucketSlowBias(1.01) === 2, '+1% is still near');

  // ── the key encodes all four features and nothing else ──
  const row = (o: Partial<FeatureRow>): FeatureRow =>
    ({
      coin: 'X', time: new Date(0), close: 1, atr: 1, rsi: 50, percentB: 0.5,
      adx: 10, pdi: 1, mdi: 1, slowBiasPercent: 0, forwardAtr: 0, ...o,
    }) as FeatureRow;
  assert(configKey(row({})) === 1 * 27 + 1 * 9 + 1 * 3 + 1, 'all-middle is key 40');
  const seen = new Set<number>();
  for (const rsi of [30, 50, 70])
    for (const pb of [0.1, 0.5, 0.9])
      for (const [adx, pdi, mdi] of [[10, 1, 1], [30, 9, 1], [30, 1, 9]])
        for (const bias of [-5, 0, 5])
          seen.add(configKey(row({ rsi, percentB: pb, adx, pdi, mdi, slowBiasPercent: bias })));
  assert(seen.size === CONFIG_COUNT, `all ${CONFIG_COUNT} configs are reachable and distinct`);
  assert(configName(40) === 'rsi40-60 · %B.2-.8 · flat · 1d-near', 'the name decodes the key');

  // ── era demeaning removes the era mean, and only that ──
  const era = (coin: string, month: number, fwd: number): FeatureRow =>
    row({ coin, time: new Date(Date.UTC(2024, month, 1)), forwardAtr: fwd });
  const demeaned = demean([
    era('BTC', 0, 10), era('BTC', 0, 20),   // Jan BTC mean 15
    era('BTC', 1, 0), era('BTC', 1, 4),     // Feb BTC mean 2
    era('DOT', 0, 100), era('DOT', 0, 102), // Jan DOT mean 101 — a different coin
  ]);
  assert(
    JSON.stringify(demeaned) === JSON.stringify([-5, 5, -2, 2, -1, 1]),
    'each row is measured against its own coin-month, not the pooled mean',
  );

  // ── spread: weighted SD of config means, tail excluded ──
  // Two configs of 4 rows each, means +1 and -1 → weighted SD is exactly 1.
  const sKeys = [0, 0, 0, 0, 1, 1, 1, 1];
  const sLabels = [1, 1, 1, 1, -1, -1, -1, -1];
  assert(Math.abs(spread(sKeys, sLabels, 4) - 1) < 1e-9, 'means +1/-1 spread 1');
  assert(spread(sKeys, sLabels, 5) === 0, 'no config clears minObs, so no spread');
  assert(spread(sKeys, [1, 1, 1, 1, 1, 1, 1, 1], 4) === 0, 'identical means, no spread');
  // The tail is excluded, not merged: a 3-row outlier config must not shift it.
  assert(
    Math.abs(spread([...sKeys, 2, 2, 2], [...sLabels, 99, 99, 99], 4) - 1) < 1e-9,
    'a config under minObs is dropped, not folded into the grand mean',
  );

  // ── rotate preserves the series, only its phase ──
  assert(JSON.stringify(rotate([1, 2, 3], 0)) === JSON.stringify([1, 2, 3]), 'zero is identity');
  assert(JSON.stringify(rotate([1, 2, 3], 1)) === JSON.stringify([2, 3, 1]), 'one step forward');
  assert(JSON.stringify(rotate([1, 2, 3], 3)) === JSON.stringify([1, 2, 3]), 'a full turn is identity');
  assert(JSON.stringify(rotate([1, 2, 3], -1)) === JSON.stringify([3, 1, 2]), 'negatives wrap');

  // ── the two tests that decide whether the permutation test can be trusted ──
  // Pseudo-random config keys, so rotation genuinely breaks the alignment —
  // a periodic key sequence would be rotation-invariant and prove nothing.
  const rk = lcg(7);
  const keys = Array.from({ length: 4000 }, () => (rk() < 0.5 ? 0 : 1));
  const segs = (labels: number[]): Array<{ keys: number[]; labels: number[] }> => [
    { keys: keys.slice(0, 2000), labels: labels.slice(0, 2000) },
    { keys: keys.slice(2000), labels: labels.slice(2000) },
  ];

  // POSITIVE: label is the config. The real spread must tower over the null.
  const signal = permTest(segs(keys.map((k) => (k === 0 ? 1 : -1))), 200, 200, lcg(11));
  assert(signal.p < 0.01, 'a config that fully determines the label must be detected');
  assert(signal.real > 10 * signal.nullP95, 'and by a wide margin, not a whisker');

  // NEGATIVE — the one that matters. Labels independent of the configs: the
  // real spread must sit INSIDE the null. If this fails the test manufactures
  // significance and every p-value it reports downstream is fiction.
  const rl = lcg(23);
  const noise = permTest(segs(Array.from({ length: 4000 }, () => rl() * 2 - 1)), 200, 200, lcg(31));
  assert(noise.p > 0.05, `noise must not look like signal (p=${noise.p.toFixed(3)})`);

  // ── P2: THE FAILING-ON-LEAK TEST ──
  // A config whose past is uniformly negative and whose future is uniformly
  // positive. A correct base rate consulted at the crossover can only have
  // seen the past, so it must read NEGATIVE. A leaking one reads positive.
  const horizonMs = 12 * spineMs; // 48h, i.e. 12 spine bars
  const t0 = Date.UTC(2024, 0, 1);
  // 30 mildly negative bars, then 30 violently positive ones. Consulted at
  // bar 41: everything RESOLVED by then is negative, everything positive is
  // still inside its own forward window and must stay invisible.
  const leakRows: FeatureRow[] = Array.from({ length: 60 }, (_, i) =>
    row({ time: new Date(t0 + i * spineMs), forwardAtr: i < 30 ? -1 : +100 }),
  );
  const leakKeys = leakRows.map(configKey);
  const at = 41; // honest sees bars <= 29; leaking sees bars <= 41

  const honest = baseRatesFast(leakRows, leakKeys, horizonMs, 10)[at];
  assert(honest.n === 30, `only the 30 resolved bars are visible (got ${honest.n})`);
  assert(
    honest.rawMean === -1,
    `resolved history is uniformly -1, so the estimate must be -1 (got ${honest.rawMean})`,
  );

  // horizonMs = 0 IS the bug: "it already happened, so I can use it". It
  // drags in twelve bars of +100 that had not resolved, and the sign flips.
  const leaking = baseRatesFast(leakRows, leakKeys, 0, 10)[at];
  assert(
    leaking.rawMean! > 0,
    `dropping the horizon must flip the sign to positive (got ${leaking.rawMean}) — ` +
      'if it does not, this test proves nothing about the invariant',
  );

  // The boundary itself, in isolation: a row exactly horizonMs old counts,
  // one millisecond younger does not.
  const edgeRows: FeatureRow[] = [
    row({ time: new Date(t0), forwardAtr: 5 }),
    row({ time: new Date(t0 + horizonMs - 1), forwardAtr: 100 }),
    row({ time: new Date(t0 + horizonMs), forwardAtr: 0 }),
  ];
  const edgeKeys = edgeRows.map(configKey);
  const atBoundary = baseRatesFast(edgeRows, edgeKeys, horizonMs, 1)[2];
  assert(atBoundary.n === 1, 'exactly one occurrence has resolved by the boundary');
  assert(atBoundary.rawMean === 5, 'the one exactly horizonMs old counts; the younger one does not');

  // Fast pointer == slow reference, including the nulls.
  const slow = baseRatesSlow(leakRows, leakKeys, horizonMs, 10);
  const fast = baseRatesFast(leakRows, leakKeys, horizonMs, 10);
  assert(
    JSON.stringify(slow) === JSON.stringify(fast),
    'the O(n) pointer must agree with the O(n^2) reference exactly',
  );

  // Nothing is known before the first horizon has elapsed.
  assert(fast[0].n === 0 && fast[0].edge === null, 'the first bar knows nothing');
  assert(fast[0].rank === null, 'and cannot be ranked either');

  // ── the cross-sectional rank orders configs by their resolved history ──
  // Two configs, one uniformly better. Interleaved so both resolve together.
  const rankRows: FeatureRow[] = Array.from({ length: 120 }, (_, i) =>
    row({
      time: new Date(t0 + i * spineMs),
      rsi: i % 2 === 0 ? 30 : 70, // two distinct configs
      forwardAtr: i % 2 === 0 ? -3 : +3, // the odd one is uniformly better
    }),
  );
  const rankKeys = rankRows.map(configKey);
  const ranked = baseRatesFast(rankRows, rankKeys, horizonMs, 10);
  const loser = ranked[100]; // an even row: the -3 config
  const winner = ranked[101]; // an odd row: the +3 config
  assert(loser.rank === 0 && winner.rank === 0.5, 'the better config ranks above the worse');
  assert(
    JSON.stringify(baseRatesSlow(rankRows, rankKeys, horizonMs, 10)) === JSON.stringify(ranked),
    'the reference must agree on rank too, not just on the mean',
  );

  console.log(
    'self-check passed (%B, slow bias, forward label, completedAsOf boundary, ' +
      'buckets, config key, era demeaning, spread, rotation, permutation +/-, ' +
      'resolution leak, boundary, fast==slow)',
  );
}

if (args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── build ───────────────────────────────────────────────────────────────

async function buildCoin(
  coin: string,
  binance: BinanceService,
  indicators: IndicatorsService,
): Promise<{ rows: FeatureRow[]; dropped: Record<string, number> }> {
  const spineBars = Math.ceil((YEARS * 365 * 24) / 4);

  // Warm-up beyond the reporting window so the FIRST sampled bar already has
  // a full 250-candle 12h context — otherwise the oldest months would carry
  // quietly worse features than the rest.
  const midWarm = ANALYSIS_CANDLE_LIMIT + 5;
  const slowWarm = SLOW_SMA + 5;
  const midBars = Math.ceil((spineBars * TIMEFRAME_MS[SPINE]) / TIMEFRAME_MS[MID]) + midWarm;
  const slowBarsNeeded =
    Math.ceil((spineBars * TIMEFRAME_MS[SPINE]) / TIMEFRAME_MS[SLOW]) + slowWarm;

  const [spine, mid, slow] = await Promise.all([
    binance.getCandlesPaged(coin, SPINE, spineBars + ATR_WINDOW + HORIZON + 5),
    binance.getCandlesPaged(coin, MID, midBars),
    binance.getCandlesPaged(coin, SLOW, slowBarsNeeded),
  ]);

  const closes = spine.map((c) => c.close);
  const highs = spine.map((c) => c.high);
  const lows = spine.map((c) => c.low);

  const rows: FeatureRow[] = [];
  const dropped = { context: 0, percentB: 0, slowBias: 0, label: 0, atr: 0 };

  // Start once the ATR window is full; stop where the label runs out.
  for (let i = ATR_WINDOW; i < spine.length - HORIZON; i += 1) {
    // asOf is the spine bar's CLOSE. Everything read below had closed by then.
    const asOf = spine[i].time.getTime() + TIMEFRAME_MS[SPINE];

    const midCandles = completedAsOf(mid, TIMEFRAME_MS[MID], asOf, ANALYSIS_CANDLE_LIMIT);
    if (midCandles.length < ANALYSIS_CANDLE_LIMIT) {
      dropped.context += 1;
      continue;
    }
    const ctx = indicators.buildContext(coin, MID, midCandles);

    const pb = percentB(ctx.closes[ctx.closes.length - 1], ctx.bollingerBands);
    if (pb === null) {
      dropped.percentB += 1;
      continue;
    }

    const slowCandles = completedAsOf(slow, TIMEFRAME_MS[SLOW], asOf, SLOW_SMA + 1);
    const bias = slowBias(
      slowCandles[slowCandles.length - 1]?.close ?? NaN,
      slowCandles.map((c) => c.close),
      SLOW_SMA,
    );
    if (bias === null || !Number.isFinite(bias)) {
      dropped.slowBias += 1;
      continue;
    }

    // Bounded trailing slice: ATR is causal, so a fixed window keeps the scan
    // linear without ever reading past bar i.
    const lo = i - ATR_WINDOW;
    const atr = atrLatest(
      highs.slice(lo, i + 1),
      lows.slice(lo, i + 1),
      closes.slice(lo, i + 1),
    );
    if (!Number.isFinite(atr) || atr === 0) {
      dropped.atr += 1;
      continue;
    }

    const label = forwardAtr(closes, i, HORIZON, atr);
    if (label === null) {
      dropped.label += 1;
      continue;
    }

    rows.push({
      coin,
      time: spine[i].time,
      close: closes[i],
      atr,
      rsi: ctx.rsi,
      percentB: pb,
      adx: ctx.adx.adx,
      pdi: ctx.adx.pdi,
      mdi: ctx.adx.mdi,
      slowBiasPercent: bias,
      forwardAtr: label,
    });
  }

  return { rows, dropped };
}

const pct = (a: number, b: number): string =>
  b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`;

const quantile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
};

// ── P1 report ───────────────────────────────────────────────────────────

function loadRows(path: string): FeatureRow[] {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  return lines.slice(head + 1).map((line) => {
    const cells = line.split(',');
    const o = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    return {
      coin: o.coin,
      time: new Date(o.time),
      close: +o.close,
      atr: +o.atr,
      rsi: +o.rsi,
      percentB: +o.percentB,
      adx: +o.adx,
      pdi: +o.pdi,
      mdi: +o.mdi,
      slowBiasPercent: +o.slowBiasPercent,
      forwardAtr: +o.forwardAtr,
    };
  });
}

function p1(): void {
  const MIN_OBS = num('min-obs', 200);
  const ITERS = num('iters', 1000);
  const rows = loadRows(OUT);

  console.log(`\nP1 — CONFIG ENCODING + OCCURRENCE HISTOGRAM + PERMUTATION`);
  console.log(
    `${rows.length} rows from ${OUT} · 4 features x 3 buckets = ${CONFIG_COUNT} configs ` +
      `· min-obs ${MIN_OBS} · ${ITERS} rotations\n`,
  );

  const keys = rows.map(configKey);
  const counts = new Array<number>(CONFIG_COUNT).fill(0);
  for (const k of keys) counts[k] += 1;
  const observed = counts.filter((c) => c > 0);
  const thin = counts.reduce((acc, c) => acc + (c > 0 && c < MIN_OBS ? c : 0), 0);

  console.log('occurrence histogram');
  console.table([
    {
      'configs possible': CONFIG_COUNT,
      'configs observed': observed.length,
      [`observed >= ${MIN_OBS}`]: counts.filter((c) => c >= MIN_OBS).length,
      min: Math.min(...observed),
      median: quantile(observed, 0.5),
      max: Math.max(...observed),
      [`rows in configs < ${MIN_OBS}`]: `${thin} (${pct(thin, rows.length)})`,
    },
  ]);

  // ── the permutation pre-test, raw and demeaned ────────────────────────
  // Both are reported: the gap between them IS the drift contribution, and
  // reporting only the demeaned number would hide how much of the raw
  // separation was calendar rather than configuration.
  const byCoin = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const list = byCoin.get(r.coin) ?? [];
    list.push(i);
    byCoin.set(r.coin, list);
  });
  const segsOf = (labels: number[]): Array<{ keys: number[]; labels: number[] }> =>
    [...byCoin.values()].map((idx) => ({
      keys: idx.map((i) => keys[i]),
      labels: idx.map((i) => labels[i]),
    }));

  const raw = rows.map((r) => r.forwardAtr);
  const adj = demean(rows);

  const results = [
    { label: 'raw forward return', t: permTest(segsOf(raw), MIN_OBS, ITERS, lcg(1)) },
    { label: 'era-demeaned (option A)', t: permTest(segsOf(adj), MIN_OBS, ITERS, lcg(1)) },
  ];

  console.log('\npermutation pre-test — between-config spread vs rotated null');
  console.table(
    results.map(({ label, t }) => ({
      labels: label,
      'configs scored': t.eligible,
      'real spread': t.real.toFixed(4),
      'null mean': t.nullMean.toFixed(4),
      'null p95': t.nullP95.toFixed(4),
      'real / null mean': (t.real / t.nullMean).toFixed(2) + 'x',
      p: t.p.toFixed(4),
    })),
  );

  // Descriptive only — 81 configs means ~4 look significant by chance, so
  // these are listed to size the raw material, never to be traded.
  const sums = new Array<number>(CONFIG_COUNT).fill(0);
  const rawSums = new Array<number>(CONFIG_COUNT).fill(0);
  keys.forEach((k, i) => {
    sums[k] += adj[i];
    rawSums[k] += raw[i];
  });
  const ranked = counts
    .map((n, key) => ({ key, n, mean: n ? sums[key] / n : 0, rawMean: n ? rawSums[key] / n : 0 }))
    .filter((c) => c.n >= MIN_OBS)
    .sort((a, b) => b.mean - a.mean);

  console.log(`\nextremes (DESCRIPTIVE — not a result; ${ranked.length} configs, ~4 clear p<.05 by chance)`);
  console.table(
    [...ranked.slice(0, 5), ...ranked.slice(-5)].map((c) => ({
      config: configName(c.key),
      n: c.n,
      demeaned: c.mean.toFixed(4),
      // The tradeable column. Where this is ~0 while `demeaned` is large, the
      // config beat its own era but the era cancelled the win.
      raw: c.rawMean.toFixed(4),
      'era drift': (c.rawMean - c.mean).toFixed(4),
    })),
  );
}

if (args.includes('--p1')) {
  p1();
  process.exit(0);
}

// ── P2 report ───────────────────────────────────────────────────────────

/** Time-sorted across coins — the two-pointer pass depends on it. */
const sortedByTime = (rows: FeatureRow[]): FeatureRow[] =>
  [...rows].sort(
    (a, b) => a.time.getTime() - b.time.getTime() || a.coin.localeCompare(b.coin),
  );

function p2(): void {
  const MIN_OBS = num('min-obs', 200);
  const rows = sortedByTime(loadRows(OUT));
  const keys = rows.map(configKey);
  const horizonMs = HORIZON * TIMEFRAME_MS[SPINE];

  console.log(`\nP2 — POINT-IN-TIME BASE RATE`);
  console.log(
    `${rows.length} rows · horizon ${horizonMs / 3_600_000}h · min-obs ${MIN_OBS} · ` +
      `expanding window, pooled across ${new Set(rows.map((r) => r.coin)).size} coins\n`,
  );

  // ── the O(n^2) cross-check, on a real slice rather than a synthetic ──
  const slice = rows.slice(0, 2000);
  const sliceKeys = slice.map(configKey);
  const a = baseRatesFast(slice, sliceKeys, horizonMs, 20);
  const b = baseRatesSlow(slice, sliceKeys, horizonMs, 20);
  const mismatches = a.filter((x, i) => JSON.stringify(x) !== JSON.stringify(b[i])).length;
  console.log(
    `pointer vs O(n^2) reference on the first ${slice.length} real rows: ` +
      `${mismatches} mismatches${mismatches ? ' — STOP' : ''}`,
  );
  if (mismatches) process.exit(1);

  const br = baseRatesFast(rows, keys, horizonMs, MIN_OBS);

  // ── how much of the table is usable ──
  const resolved = br.filter((x) => x.edge !== null);
  const firstUsable = br.findIndex((x) => x.edge !== null);
  console.log('\ncoverage');
  console.table([
    {
      rows: br.length,
      'edge resolved': `${resolved.length} (${pct(resolved.length, br.length)})`,
      [`null (< ${MIN_OBS} obs)`]: `${br.length - resolved.length} (${pct(br.length - resolved.length, br.length)})`,
      'first usable row': firstUsable < 0 ? '—' : rows[firstUsable].time.toISOString().slice(0, 10),
      'warm-up cost': firstUsable < 0 ? '—' : `${firstUsable} rows`,
    },
  ]);

  // ── does an estimate settle down, or wander forever? ──
  // The largest config, sampled across the whole span. Early rows should read
  // null for want of samples, then the estimate should stop moving much.
  const counts = new Array<number>(CONFIG_COUNT).fill(0);
  for (const k of keys) counts[k] += 1;
  const biggest = counts.indexOf(Math.max(...counts));
  const track = rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => keys[i] === biggest);
  const step = Math.floor(track.length / 11) || 1;

  console.log(`\nstabilisation — "${configName(biggest)}" (${counts[biggest]} occurrences)`);
  console.table(
    track
      .filter((_, n) => n % step === 0)
      .slice(0, 12)
      .map(({ r, i }) => ({
        date: r.time.toISOString().slice(0, 10),
        'resolved obs': br[i].n,
        'raw mean': br[i].rawMean === null ? 'null' : br[i].rawMean!.toFixed(4),
        'edge (option A)': br[i].edge === null ? 'null' : br[i].edge!.toFixed(4),
      })),
  );

  // ── the edge series itself ──
  const edges = resolved.map((x) => x.edge!);
  const raws = resolved.map((x) => x.rawMean!);
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log('\nthe signal, as it would have been seen (resolved rows only)');
  console.table([
    { series: 'edge (option A)', mean: mean(edges).toFixed(4), p05: quantile(edges, 0.05).toFixed(4), median: quantile(edges, 0.5).toFixed(4), p95: quantile(edges, 0.95).toFixed(4), 'share > 0': pct(edges.filter((x) => x > 0).length, edges.length) },
    { series: 'raw config mean', mean: mean(raws).toFixed(4), p05: quantile(raws, 0.05).toFixed(4), median: quantile(raws, 0.5).toFixed(4), p95: quantile(raws, 0.95).toFixed(4), 'share > 0': pct(raws.filter((x) => x > 0).length, raws.length) },
  ]);

  // ── the plan's holdout assertion, made explicit rather than assumed ──
  // Point-in-time + expanding window means a TUNE bar can only ever learn
  // from earlier bars, which are also TUNE. Asserted, not trusted.
  const cut = rows[Math.floor(rows.length * 0.7)].time.getTime();
  const lastTuneIdx = rows.findIndex((r) => r.time.getTime() >= cut) - 1;
  const newestContributor = rows[lastTuneIdx].time.getTime() - horizonMs;
  console.log(
    `\nholdout gate: TUNE ends ${new Date(cut).toISOString().slice(0, 10)}; the newest bar any ` +
      `TUNE row can learn from closed ${new Date(newestContributor).toISOString().slice(0, 10)} ` +
      `— ${newestContributor < cut ? 'inside TUNE, as required' : 'PAST THE CUT, STOP'}`,
  );
  if (newestContributor >= cut) process.exit(1);
}

if (args.includes('--p2')) {
  p2();
  process.exit(0);
}

// ── P3 report ───────────────────────────────────────────────────────────

/**
 * Paired block bootstrap on the top-minus-bottom decile gap.
 *
 * Paired because the two deciles must be resampled under the SAME market
 * conditions: drawing block 42 for the top decile and block 7 for the bottom
 * would compare a decile in one week against a decile in another and call
 * the difference signal. Same block indices, both sides, every draw.
 */
export function blockSpread(
  top: Array<{ time: number; value: number }>,
  bottom: Array<{ time: number; value: number }>,
  blockDays: number,
  b: number,
  seed: number,
): { lo: number; hi: number; blocks: number; pPositive: number } {
  const rng = makeRng(seed);
  const t0 = Math.min(...top.map((p) => p.time), ...bottom.map((p) => p.time));
  const ms = blockDays * 86_400_000;
  const bucket = (pts: Array<{ time: number; value: number }>): Map<number, number[]> => {
    const m = new Map<number, number[]>();
    for (const p of pts) {
      const k = Math.floor((p.time - t0) / ms);
      (m.get(k) ?? m.set(k, []).get(k)!).push(p.value);
    }
    return m;
  };
  const tb = bucket(top);
  const bb = bucket(bottom);
  // Only blocks where BOTH deciles are represented can inform a difference.
  const keys = [...tb.keys()].filter((k) => bb.has(k));

  const draws: number[] = [];
  for (let i = 0; i < b; i += 1) {
    let ts = 0, tn = 0, bs = 0, bn = 0;
    for (let j = 0; j < keys.length; j += 1) {
      const k = keys[Math.floor(rng() * keys.length)];
      for (const v of tb.get(k)!) { ts += v; tn += 1; }
      for (const v of bb.get(k)!) { bs += v; bn += 1; }
    }
    if (tn > 0 && bn > 0) draws.push(ts / tn - bs / bn);
  }
  draws.sort((a, b2) => a - b2);
  return {
    lo: draws[Math.floor(0.025 * (draws.length - 1))],
    hi: draws[Math.floor(0.975 * (draws.length - 1))],
    blocks: keys.length,
    pPositive: draws.filter((x) => x > 0).length / draws.length,
  };
}

/** Rank-based decile, 0 = lowest. Equal-sized by construction. */
const decileOf = (rank: number, n: number): number => Math.min(9, Math.floor((rank * 10) / n));

function p3(): void {
  const MIN_OBS = num('min-obs', 200);
  const BLOCK_DAYS = num('block-days', 14);
  const B = num('b', 2000);
  const SEED = num('seed', 12345);

  const rows = sortedByTime(loadRows(OUT));
  const keys = rows.map(configKey);
  const horizonMs = HORIZON * TIMEFRAME_MS[SPINE];
  const br = baseRatesFast(rows, keys, horizonMs, MIN_OBS);

  // TUNE ONLY. P3 is a pre-holdout phase; letting a decile table see holdout
  // rows spends the evidence P5 exists to provide, and there is no second one.
  const t0 = rows[0].time.getTime();
  const t1 = rows[rows.length - 1].time.getTime();
  const cut = t0 + (t1 - t0) * 0.7;

  const set = rows
    .map((r, i) => ({ r, b: br[i] }))
    .filter((x) => x.b.edge !== null && x.b.rank !== null && x.r.time.getTime() < cut)
    .map((x) => ({
      time: x.r.time.getTime(),
      era: x.r.time.toISOString().slice(0, 7),
      edge: x.b.edge!,
      rank: x.b.rank!,
      realised: x.r.forwardAtr,
      costAtr: (DEFAULT_ROUND_TRIP_PCT / 100) * (x.r.close / x.r.atr),
    }));

  console.log(`\nP3 — DOES THE SIGNAL CARRY INFORMATION?`);
  console.log(
    `TUNE only: ${new Date(t0).toISOString().slice(0, 10)} → ` +
      `${new Date(cut).toISOString().slice(0, 10)} · ${set.length} resolved rows · ` +
      `no trading rule, no stops, no targets\n`,
  );

  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const toll = mean(set.map((x) => x.costAtr));

  // ── three decile assignments, only one of which is honest ──
  // PIT-RANK grades a row by where its config sat among all configs AT THAT
  // INSTANT: point-in-time, and the drift offset cancels because every config
  // shares the same unconditional mean at T. This is the primary read.
  //
  // WITHIN-ERA also defeats the drift, but sets its decile boundaries from the
  // month's other rows — including rows AFTER this one. Kept only to show what
  // that lookahead is worth. POOLED is point-in-time but ranks a 2023 row
  // against a 2025 one, so it inherits the expanding baseline's lag.
  const pit = set.map((x) => Math.min(9, Math.floor(x.rank * 10)));

  const pooled = new Array<number>(set.length);
  [...set.keys()]
    .sort((a, b) => set[a].edge - set[b].edge)
    .forEach((idx, rank) => (pooled[idx] = decileOf(rank, set.length)));

  const byEra = new Map<string, number[]>();
  set.forEach((x, i) => byEra.set(x.era, [...(byEra.get(x.era) ?? []), i]));
  const within = new Array<number>(set.length);
  for (const idx of byEra.values()) {
    [...idx]
      .sort((a, b) => set[a].edge - set[b].edge)
      .forEach((i, rank) => (within[i] = decileOf(rank, idx.length)));
  }

  for (const [name, assign] of [
    ['PIT CROSS-SECTIONAL RANK (primary — point-in-time, drift-immune)', pit],
    ['WITHIN-ERA (boundaries peek at later rows in the month)', within],
    ['POOLED (point-in-time, but drift-contaminated)', pooled],
  ] as Array<[string, number[]]>) {
    const table = Array.from({ length: 10 }, (_, d) => {
      const rowsIn = set.filter((_, i) => assign[i] === d);
      const ci = blockBootstrap(
        rowsIn.map((x) => ({ time: x.time, value: x.realised })),
        BLOCK_DAYS,
        B,
        SEED,
      );
      return {
        decile: d === 0 ? '0 (worst predicted)' : d === 9 ? '9 (best predicted)' : `${d}`,
        n: rowsIn.length,
        'predicted edge': mean(rowsIn.map((x) => x.edge)).toFixed(4),
        'REALISED ATR/48h': mean(rowsIn.map((x) => x.realised)).toFixed(4),
        '95% CI': `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
      };
    });
    console.log(`\ndeciles — ${name}`);
    console.table(table);

    const top = set.filter((_, i) => assign[i] === 9);
    const bot = set.filter((_, i) => assign[i] === 0);
    const gap = mean(top.map((x) => x.realised)) - mean(bot.map((x) => x.realised));
    const s = blockSpread(
      top.map((x) => ({ time: x.time, value: x.realised })),
      bot.map((x) => ({ time: x.time, value: x.realised })),
      BLOCK_DAYS,
      B,
      SEED,
    );
    // A CI wholly BELOW zero excludes zero just as surely as one above it —
    // it means the signal is real and pointing the wrong way, which is a
    // finding, not a null. An earlier version of this line tested `lo > 0`
    // only and printed "CROSSES ZERO" over an interval of [-1.39, -0.63].
    const clears = s.lo > 0 ? 'clears zero (positive)' : s.hi < 0 ? 'clears zero (NEGATIVE — inverted)' : 'CROSSES ZERO';
    console.log(
      `  top - bottom = ${gap.toFixed(4)} ATR  CI [${s.lo.toFixed(4)}, ${s.hi.toFixed(4)}] ` +
        `over ${s.blocks} blocks · ${clears}`,
    );
    // Magnitude against the toll: a signal pointing backwards is still worth
    // |gap| if you are willing to invert it, so the comparison is on |gap|.
    console.log(
      `  round-trip toll = ${toll.toFixed(4)} ATR  ->  |gap| is ${Math.abs(gap / toll).toFixed(2)}x the toll` +
        `${Math.abs(gap) < toll ? ' — cannot pay for itself even if real' : ''}`,
    );

    // Monotonicity: does realised actually track predicted, or is it two ends
    // and noise between? Spearman-ish rank agreement over the ten decile means.
    const realisedByDecile = Array.from({ length: 10 }, (_, d) =>
      mean(set.filter((_, i) => assign[i] === d).map((x) => x.realised)),
    );
    const ups = realisedByDecile.slice(1).filter((v, i) => v > realisedByDecile[i]).length;
    console.log(`  monotonic steps: ${ups}/9 upward (9 = perfect, ~4.5 = coin flip)`);
  }

  // ── the plan's era sanity check ──
  // Later bars have more history behind their estimate than earlier ones. If
  // the decile response only exists late, it is the history talking.
  console.log('\nPIT-rank top vs bottom decile, split by year');
  const years = [...new Set(set.map((x) => x.era.slice(0, 4)))].sort();
  console.table(
    years.map((y) => {
      const inYear = set.map((x, i) => ({ x, d: pit[i] })).filter((z) => z.x.era.startsWith(y));
      const t = inYear.filter((z) => z.d === 9).map((z) => z.x);
      const b = inYear.filter((z) => z.d === 0).map((z) => z.x);
      const pt = (xs: typeof t): Array<{ time: number; value: number }> =>
        xs.map((x) => ({ time: x.time, value: x.realised }));
      const s = t.length && b.length ? blockSpread(pt(t), pt(b), BLOCK_DAYS, B, SEED) : null;
      return {
        year: y,
        n: inYear.length,
        'configs ranked': new Set(inYear.map((z) => z.x.rank)).size,
        'top decile': t.length ? mean(t.map((x) => x.realised)).toFixed(4) : '—',
        'bottom decile': b.length ? mean(b.map((x) => x.realised)).toFixed(4) : '—',
        gap:
          t.length && b.length
            ? (mean(t.map((x) => x.realised)) - mean(b.map((x) => x.realised))).toFixed(4)
            : '—',
        // Blocks, not rows, is the honest sample size here. A collapsed CI on
        // a big-looking n means one block carried the whole "result".
        blocks: s ? s.blocks : '—',
        '95% CI': s ? `[${s.lo.toFixed(3)}, ${s.hi.toFixed(3)}]` : '—',
      };
    }),
  );
}

if (args.includes('--p3')) {
  p3();
  process.exit(0);
}

async function main(): Promise<void> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();

  console.log(`\nP0 — FEATURE TABLE`);
  console.log(
    `spine ${SPINE} · features ${MID} + ${SLOW} · horizon ${HORIZON} bars ` +
      `(${(HORIZON * TIMEFRAME_MS[SPINE]) / 3_600_000}h) · ${YEARS}y · ${COINS.length} coins\n`,
  );

  const all: FeatureRow[] = [];
  const perCoin: Array<Record<string, string | number>> = [];

  for (const coin of COINS) {
    const startedAt = Date.now();
    const { rows, dropped } = await buildCoin(coin, binance, indicators);
    all.push(...rows);
    perCoin.push({
      coin,
      rows: rows.length,
      first: rows.length ? rows[0].time.toISOString().slice(0, 10) : '—',
      last: rows.length ? rows[rows.length - 1].time.toISOString().slice(0, 10) : '—',
      'dropped (no context)': dropped.context,
      'dropped (other)':
        dropped.percentB + dropped.slowBias + dropped.label + dropped.atr,
      seconds: ((Date.now() - startedAt) / 1000).toFixed(1),
    });
    console.log(`${coin.padEnd(4)} ${rows.length} rows · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }

  console.log('\nper coin');
  console.table(perCoin);

  // ── checkpoint: are the features usable? ──────────────────────────────
  console.log('\nfeature distributions (fixed thresholds, the P1 buckets)');
  const share = (fn: (r: FeatureRow) => boolean): string => pct(all.filter(fn).length, all.length);
  console.table([
    {
      feature: 'RSI (12h)',
      low: `<40: ${share((r) => r.rsi < 40)}`,
      mid: `40-60: ${share((r) => r.rsi >= 40 && r.rsi <= 60)}`,
      high: `>60: ${share((r) => r.rsi > 60)}`,
    },
    {
      feature: '%B (12h)',
      low: `<0.2: ${share((r) => r.percentB < 0.2)}`,
      mid: `0.2-0.8: ${share((r) => r.percentB >= 0.2 && r.percentB <= 0.8)}`,
      high: `>0.8: ${share((r) => r.percentB > 0.8)}`,
    },
    {
      feature: 'trend (12h)',
      low: `down: ${share((r) => r.adx >= 20 && r.mdi > r.pdi)}`,
      mid: `flat (ADX<20): ${share((r) => r.adx < 20)}`,
      high: `up: ${share((r) => r.adx >= 20 && r.pdi >= r.mdi)}`,
    },
    {
      feature: 'slow bias (1d)',
      low: `<-1%: ${share((r) => r.slowBiasPercent < -1)}`,
      mid: `+/-1%: ${share((r) => Math.abs(r.slowBiasPercent) <= 1)}`,
      high: `>+1%: ${share((r) => r.slowBiasPercent > 1)}`,
    },
  ]);

  const labels = all.map((r) => r.forwardAtr);
  const mean = labels.reduce((a, b) => a + b, 0) / labels.length;
  console.log('\nforward return (ATR units) — the label');
  console.table([
    {
      n: labels.length,
      mean: mean.toFixed(4),
      median: quantile(labels, 0.5).toFixed(4),
      p05: quantile(labels, 0.05).toFixed(2),
      p95: quantile(labels, 0.95).toFixed(2),
      min: Math.min(...labels).toFixed(2),
      max: Math.max(...labels).toFixed(2),
      'share > 0': pct(labels.filter((x) => x > 0).length, labels.length),
    },
  ]);

  const cols: Array<keyof FeatureRow> = [
    'coin', 'time', 'close', 'atr', 'rsi', 'percentB', 'adx', 'pdi', 'mdi',
    'slowBiasPercent', 'forwardAtr',
  ];
  fs.writeFileSync(
    OUT,
    [
      `# spine=${SPINE} mid=${MID} slow=${SLOW} horizon=${HORIZON} years=${YEARS} ` +
        `atr-window=${ATR_WINDOW} slow-sma=${SLOW_SMA} coins=${COINS.join('/')}`,
      cols.join(','),
      ...all.map((r) =>
        cols
          .map((c) => (r[c] instanceof Date ? (r[c] as Date).toISOString() : r[c]))
          .join(','),
      ),
    ].join('\n'),
  );
  console.log(`\nwrote ${all.length} rows to ${OUT} (config on line 1)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
