/**
 * Does an input predict DIRECTION? VOLUME_AB.md, then FUNDING_AB.md.
 *
 *   npx ts-node --transpile-only test/manual/volsignal.ts --volume --bars 20000
 *   npx ts-node --transpile-only test/manual/volsignal.ts --flow --bars 20000
 *   npx ts-node --transpile-only test/manual/volsignal.ts --all
 *   npx ts-node --transpile-only test/manual/volsignal.ts --nodes --funding
 *   npx ts-node --transpile-only test/manual/volsignal.ts --self-check
 *
 * No entries, stops, targets or cost model. Every bar is one observation of
 * "input value now -> was price higher 4/12/24h later". If an input cannot pick
 * a direction, nothing built on it can, and that is cheaper to learn here.
 *
 * Buckets are judged against THAT COIN'S OWN base rate, never 50%: measured
 * base rates run 47.9%-52.7%, so a raw hit rate is not a lift.
 *
 * TUNE only — the oldest 70% of each coin's bars. The holdout is not touched.
 *
 * Read-only. Fetches candles and futures flow, writes nothing.
 */
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { makeRng } from './rng';

Logger.overrideLogger(false);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

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
const BARS = num('bars', 20000);
const SEED = num('seed', 12345);
/**
 * Smallest bucket that may carry a verdict.
 *
 * Was 100. A 5,544-observation smoke run of the volume-delta input produced two
 * buckets over 58%, one at 13.7%, and a clean-looking monotone gradient
 * (55.2 -> 52.1 -> 42.6 -> 13.7). At 139,720 observations the same buckets read
 * 49.7%, 51.1% and 51.6%. On this data hundreds is not a sample, it is a story.
 */
const N_FLOOR = num('n-floor', 5000);
/** Points of lift over the coin's own base rate that count as a signal. */
const LIFT_BAR = num('lift', 5);
/**
 * Ten equal-count buckets per input per coin, instead of edges chosen up front.
 *
 * V1 was reported DEAD at +4.0pt with everything above +5% pooled into one
 * bucket of 39,022 observations. Re-cut on deciles its top decile reads +8.2pt.
 * The edges were picked before the distributions were known, which is a
 * resolution problem and not a data one. DECILE_AB.md.
 */
const DECILES = args.includes('--deciles');
/**
 * Effective observations a cell needs before a verdict, in the block-bootstrap
 * sense below — NOT raw bars.
 *
 * Pinned after DECILE_AB.md was committed and before any run: the pre-registration
 * fixed the CI rule and the effective-n definition but left the floor open. 1,000
 * is the order of magnitude the audit's V1 cell implies (n=13,476, CI width 5.4pt
 * -> SE 1.38pt -> n_eff ~ 1,300). It is close to redundant, because a cell whose
 * interval already excludes the bar has by definition been measured precisely
 * enough; it is here to stop a wild interval sneaking through.
 */
const NEFF_FLOOR = num('neff-floor', 1000);
/** Resamples per cell, and the block width. ~19 months of TUNE is ~42 blocks. */
const B_RESAMPLES = num('resamples', 2000);
const BLOCK_MS = num('block-days', 14) * 24 * 3_600_000;
/** Shuffled controls per input. One shuffle is an anecdote about a seed. */
const SHUFFLES = num('shuffles', 3);
/** How far a recovered plant may sit from its planted strength. */
const PLANT_TOL = num('plant-tol', 0.5);
/** Oldest share of each coin's bars that may be looked at. */
const TUNE_SHARE = 0.7;
const HORIZONS = [4, 12, 24] as const;

const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pctOf = (a: number, b: number) => (b === 0 ? NaN : (100 * a) / b);

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
// Math.min(...xs) throws on ~10^5 arguments, and every array here is that size.
const minOf = (xs: number[]) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
const maxOf = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

/**
 * A timestamped value from a non-price series, stamped with when it became
 * PUBLIC — not when the period it describes began.
 *
 * This is the whole lookahead defence for funding and premium, in one place:
 *
 *   funding  publishedAt = fundingTime, the settlement moment. The 8h rate
 *            settled at 16:00 is not usable at 08:01, even though it describes
 *            08:00-16:00. Bucketing a bar by "the funding of the period it sits
 *            in" reads a number decided by the future of that bar, and would be
 *            the easiest way to fake a result in this experiment.
 *   premium  publishedAt = kline openTime + 1h, when the bar closed. The
 *            co-terminal kline IS allowed: it closes at the same instant the
 *            decision bar does, so its close is known at decision time.
 */
export interface Pub {
  publishedAt: number;
  value: number;
}

/** Everything a bar may look at. */
export interface Bundle {
  candles: Candle[];
  funding: Pub[];
  premium: Pub[];
}

/** The last value published at or before `atMs`, or null. Rows must be sorted. */
export function latestAtOrBefore(rows: Pub[], atMs: number): Pub | null {
  let lo = 0;
  let hi = rows.length - 1;
  let best: Pub | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].publishedAt <= atMs) {
      best = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** The nth-most-recent published value at or before `atMs` (0 = latest). */
function nthBefore(rows: Pub[], atMs: number, n: number): Pub | null {
  let lo = 0;
  let hi = rows.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].publishedAt <= atMs) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const want = idx - n;
  return want >= 0 ? rows[want] : null;
}

/** When bar `i` closed — the moment a decision at that bar is made. */
const closeOf = (candles: Candle[], i: number): number =>
  candles[i].time.getTime() + 3_600_000;

// ── the inputs ──────────────────────────────────────────────────────────
//
// Every one is a pure function of `candles` and `i` that reads NOTHING past
// index i. `selfCheck` proves that by recomputing on candles.slice(0, i + 1)
// and demanding the identical number — if a function ever peeks forward,
// truncating the array changes its answer and the check fails.

const NODE_LOOKBACK = 500; // ~3 weeks of 1h bars
const NODE_BINS = 50;
const RELVOL_WINDOW = 24;
const EXTREME_WINDOW = 48;
const DELTA_WINDOW = 24;

/**
 * 1. Signed distance from spot to the heaviest-traded price bin over the
 *    lookback (a point of control), as a percent. Negative = the node is below.
 */
function volumeNode({ candles }: Bundle, i: number): number {
  const from = i - NODE_LOOKBACK + 1;
  if (from < 0) return NaN;
  const win = candles.slice(from, i + 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of win) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (!(hi > lo)) return NaN;

  const width = (hi - lo) / NODE_BINS;
  const vol = new Array<number>(NODE_BINS).fill(0);
  for (const c of win) {
    // Volume is credited to the bar's typical price. Spreading it across the
    // bar's whole range would be more faithful and needs tick data to justify.
    // ponytail: typical price, upgrade to range-spread if the input ever goes LIVE.
    const typical = (c.high + c.low + c.close) / 3;
    const bin = Math.min(NODE_BINS - 1, Math.max(0, Math.floor((typical - lo) / width)));
    vol[bin] += c.volume;
  }
  let best = 0;
  for (let b = 1; b < NODE_BINS; b++) if (vol[b] > vol[best]) best = b;
  const nodePrice = lo + width * (best + 0.5);
  const spot = candles[i].close;
  return ((nodePrice - spot) / spot) * 100;
}

/** 2. This bar's volume against the mean of the PRECEDING window. */
function relativeVolume({ candles }: Bundle, i: number): number {
  const from = i - RELVOL_WINDOW;
  if (from < 0) return NaN;
  const prior = candles.slice(from, i).map((c) => c.volume);
  const avg = mean(prior);
  if (!(avg > 0)) return NaN;
  return candles[i].volume / avg;
}

/**
 * 3. The most recent extreme in the window, signed by which extreme it was,
 *    scaled by how much volume it came on. +2.0 = a high on twice-average
 *    volume; -2.0 = a low on twice-average volume.
 */
function volumeAtExtreme({ candles }: Bundle, i: number): number {
  const from = i - EXTREME_WINDOW + 1;
  if (from < 0) return NaN;
  const win = candles.slice(from, i + 1);
  let hiI = 0;
  let loI = 0;
  for (let k = 1; k < win.length; k++) {
    if (win[k].high > win[hiI].high) hiI = k;
    if (win[k].low < win[loI].low) loI = k;
  }
  const avg = mean(win.map((c) => c.volume));
  if (!(avg > 0)) return NaN;
  const isHigh = hiI >= loI; // the later extreme wins; ties go to the high
  const at = isHigh ? win[hiI] : win[loI];
  return (isHigh ? 1 : -1) * (at.volume / avg);
}

/** 4. (up-bar volume - down-bar volume) / total volume over the window. */
function volumeDelta({ candles }: Bundle, i: number): number {
  const from = i - DELTA_WINDOW + 1;
  if (from < 0) return NaN;
  let up = 0;
  let down = 0;
  for (let k = from; k <= i; k++) {
    const c = candles[k];
    if (c.close > c.open) up += c.volume;
    else if (c.close < c.open) down += c.volume;
  }
  const total = up + down;
  if (!(total > 0)) return NaN;
  return (up - down) / total;
}

const DD_LOOKBACK = 500; // the same window as the volume node, deliberately

/**
 * The control that matters more than the shuffle.
 *
 * Signed percent change from the close 500 bars ago to this close. No volume in
 * it, no flow, no node — just "how far has price come". V1's entire effect
 * reproduces from this input (+4.2 / +6.9 / +8.0 against V1's +5.4 / +8.5 /
 * +9.6), so the volume machinery was contributing nothing and the finding was
 * post-drawdown mean reversion wearing a volume costume.
 *
 * Every candidate cell that clears the bar is printed next to this one. Without
 * that comparison the project rediscovers mean reversion once per input class.
 */
function drawdown({ candles }: Bundle, i: number): number {
  const from = i - DD_LOOKBACK;
  if (from < 0) return NaN;
  const then = candles[from].close;
  return then > 0 ? ((candles[i].close - then) / then) * 100 : NaN;
}

const FUND_CHANGE_SETTLEMENTS = 3; // 24h at an 8h cadence
const EXTREMITY_SETTLEMENTS = 30; // ~10 days

/** 5. The latest PUBLISHED funding rate, in percent. */
function fundingRate(b: Bundle, i: number): number {
  const at = latestAtOrBefore(b.funding, closeOf(b.candles, i));
  return at ? at.value : NaN;
}

/** 6. Change in funding across the last 3 published settlements, in points. */
function fundingChange(b: Bundle, i: number): number {
  const at = closeOf(b.candles, i);
  const now = nthBefore(b.funding, at, 0);
  const then = nthBefore(b.funding, at, FUND_CHANGE_SETTLEMENTS);
  return now && then ? now.value - then.value : NaN;
}

/**
 * 7. The latest PUBLISHED premium index, in percent.
 *
 * Note the scale before reading the buckets: measured across BTC/ETH/SOL/ADA
 * the premium index sits around -0.04% with p10/p90 near -0.06/-0.02, so it is
 * persistently negative by construction. Edges are centred on that, not on
 * zero, or every observation would land in one bucket.
 */
function premiumIndex(b: Bundle, i: number): number {
  const at = latestAtOrBefore(b.premium, closeOf(b.candles, i));
  return at ? at.value : NaN;
}

/**
 * 8. Funding against its own recent size: rate / mean(|rate|) over the last 30
 *    published settlements. A ratio, so the threshold is fixed rather than a
 *    percentile of the sample.
 */
function fundingExtremity(b: Bundle, i: number): number {
  const at = closeOf(b.candles, i);
  const now = nthBefore(b.funding, at, 0);
  if (!now) return NaN;
  const hist: number[] = [];
  for (let k = 1; k <= EXTREMITY_SETTLEMENTS; k++) {
    const r = nthBefore(b.funding, at, k);
    if (!r) return NaN;
    hist.push(Math.abs(r.value));
  }
  const scale = mean(hist);
  return scale > 0 ? now.value / scale : NaN;
}

/**
 * Bucket edges are FIXED numbers chosen from what each input means, never
 * sample percentiles: a percentile boundary is computed from the whole series,
 * including bars in the future of the one being labelled.
 *
 * For funding and premium the edges were set after measuring each input's own
 * SCALE — never against forward returns — because default edges around zero
 * would have left premium entirely in one bucket. Scale is a property of the
 * input; the outcome was not consulted.
 */
interface Input {
  key: string;
  label: string;
  group: 'volume' | 'flow' | 'control';
  compute: (b: Bundle, i: number) => number;
  edges: number[];
  unit: string;
}

const INPUTS: Input[] = [
  {
    key: 'nodes',
    label: 'V1. volume node — signed % from spot to heaviest-traded price',
    group: 'volume',
    compute: volumeNode,
    edges: [-5, -3, -1.5, -0.5, 0.5, 1.5, 3, 5],
    unit: '%',
  },
  {
    key: 'relvol',
    label: 'V2. relative volume — this bar vs its prior 24-bar mean',
    group: 'volume',
    compute: relativeVolume,
    edges: [0.5, 0.8, 1.0, 1.25, 1.6, 2.5, 4],
    unit: 'x',
  },
  {
    key: 'extremes',
    label: 'V3. volume at the most recent 48-bar extreme (+high / -low)',
    group: 'volume',
    compute: volumeAtExtreme,
    edges: [-3, -2, -1.4, -1, 1, 1.4, 2, 3],
    unit: 'x',
  },
  {
    key: 'delta',
    label: 'V4. volume delta proxy — (up vol - down vol) / total, 24 bars',
    group: 'volume',
    compute: volumeDelta,
    edges: [-0.5, -0.3, -0.15, -0.05, 0.05, 0.15, 0.3, 0.5],
    unit: '',
  },
  {
    key: 'funding',
    label: 'F1. funding rate — latest published, percent per 8h',
    group: 'flow',
    compute: fundingRate,
    edges: [-0.03, -0.01, 0, 0.005, 0.01, 0.02, 0.05],
    unit: '%',
  },
  {
    key: 'fundchange',
    label: 'F2. funding change — across the last 3 settlements (24h), points',
    group: 'flow',
    compute: fundingChange,
    edges: [-0.03, -0.01, -0.003, 0.003, 0.01, 0.03],
    unit: 'pt',
  },
  {
    key: 'premium',
    label: 'F3. premium index — latest published, percent (sits near -0.04)',
    group: 'flow',
    compute: premiumIndex,
    edges: [-0.12, -0.09, -0.07, -0.055, -0.04, -0.025, -0.01, 0.02],
    unit: '%',
  },
  {
    key: 'extremity',
    label: 'F4. funding extremity — rate / mean|rate| over 30 settlements',
    group: 'flow',
    compute: fundingExtremity,
    edges: [-4, -2, -1, 0, 1, 2, 4],
    unit: 'x',
  },
  {
    key: 'dd',
    label: 'DD. drawdown baseline — trailing 500-bar return, no volume in it (CONTROL)',
    group: 'control',
    compute: drawdown,
    edges: [-40, -25, -15, -7, 0, 7, 15, 25, 40],
    unit: '%',
  },
];

function bucketOf(value: number, edges: number[]): number {
  let b = 0;
  while (b < edges.length && value >= edges[b]) b += 1;
  return b;
}
function bucketLabel(b: number, edges: number[], unit: string): string {
  const lo = b === 0 ? '-inf' : `${edges[b - 1]}`;
  const hi = b === edges.length ? '+inf' : `${edges[b]}`;
  return `[${lo}, ${hi})${unit}`;
}

interface Obs {
  coin: string;
  raw: number;
  bucket: number;
  /** Signed forward return in %, one per HORIZONS entry. NaN if unavailable. */
  fwd: number[];
  /**
   * This coin's own base rate at each horizon. Carried per observation so a
   * bucket's lift is measured against the coins actually in it — a bucket that
   * happens to be 80% BNB must be judged against BNB's upward drift, not
   * against the pooled average.
   */
  base: number[];
  /** When the decision bar closed — the block bootstrap resamples on this. */
  t: number;
}

/** Paged fetch of the futures flow series, both stamped with PUBLICATION time. */
const FAPI = 'https://fapi.binance.com';

async function getJson(path: string, q: Record<string, string | number>): Promise<unknown[]> {
  const r = await fetch(`${FAPI}${path}?${new URLSearchParams(q as Record<string, string>)}`);
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return (await r.json()) as unknown[];
}

/**
 * Funding, paged BACKWARD.
 *
 * `/fapi/v1/fundingRate` IGNORES startTime — given a limit it returns the most
 * recent window regardless, exactly like the `/futures/data/` family the
 * collector documents. Measured: startTime=0 returns the trailing 500 rows.
 * So the cursor walks endTime backwards, and the loop stops if a page fails to
 * move older, which is what prevents a misbehaving endpoint looping for ever.
 */
async function fetchFunding(pair: string, sinceMs: number): Promise<Pub[]> {
  const out = new Map<number, number>();
  let cursor = Date.now();
  for (let page = 0; page < 60; page++) {
    const rows = await getJson('/fapi/v1/fundingRate', { symbol: pair, endTime: cursor, limit: 500 });
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const r of rows as Array<Record<string, unknown>>) {
      const ts = Number(r.fundingTime);
      const v = Number(r.fundingRate) * 100;
      if (Number.isFinite(ts) && Number.isFinite(v)) out.set(ts, v);
      if (ts < oldest) oldest = ts;
    }
    if (!Number.isFinite(oldest) || oldest >= cursor) break;
    cursor = oldest - 1;
    if (oldest <= sinceMs) break;
  }
  return [...out.entries()]
    .map(([publishedAt, value]) => ({ publishedAt, value }))
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

/** Premium index klines, paged FORWARD — this endpoint does respect startTime. */
async function fetchPremium(pair: string, sinceMs: number): Promise<Pub[]> {
  const out = new Map<number, number>();
  let cursor = sinceMs;
  const now = Date.now();
  for (let page = 0; page < 60 && cursor < now; page++) {
    const rows = await getJson('/fapi/v1/premiumIndexKlines', {
      symbol: pair, interval: '1h', startTime: cursor, limit: 1500,
    });
    if (rows.length === 0) break;
    let newest = -Infinity;
    for (const k of rows as unknown[][]) {
      const openTime = Number(k[0]);
      const close = Number(k[4]) * 100;
      // Published when the bar CLOSED, not when it opened.
      if (Number.isFinite(openTime) && Number.isFinite(close)) {
        out.set(openTime + 3_600_000, close);
      }
      if (openTime > newest) newest = openTime;
    }
    if (!Number.isFinite(newest) || newest + 1 <= cursor) break;
    cursor = newest + 1;
  }
  return [...out.entries()]
    .map(([publishedAt, value]) => ({ publishedAt, value }))
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

// ── run ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const wanted = INPUTS.filter(
    (x) =>
      args.includes(`--${x.key}`) ||
      // The drawdown control is never a candidate: it does not carry a verdict
      // and it does not count against the multiple-comparison budget.
      ((args.includes('--all') || args.includes(`--${x.group}`)) && x.group !== 'control'),
  );
  if (wanted.length === 0) {
    console.log(
      'pick inputs: --volume (V1-V4), --flow (F1-F4), --all, or by key:\n  ' +
        INPUTS.map((x) => `--${x.key}`).join(' ') +
        '\nor --self-check',
    );
    return;
  }
  const needFlow = wanted.some((x) => x.group === 'flow');

  const binance = new BinanceService(cache, new CacheTelemetryService());
  console.log(
    `DIRECTIONAL INPUT PROBE — VOLUME_AB.md / FUNDING_AB.md\n` +
      `coins=${COINS.join(',')} bars=${BARS} horizons=${HORIZONS.join('/')}h ` +
      `tune=oldest ${TUNE_SHARE * 100}% seed=${SEED}\n` +
      (DECILES
        ? `criteria: a cell is DEAD only when its ${f(95, 0)}% CI excludes ${LIFT_BAR}pt of lift; ` +
          `CLEARS when the CI excludes it the other way and n_eff >= ${NEFF_FLOOR}\n` +
          `deciles: 10 equal-count buckets per input PER COIN, cut from TUNE only\n` +
          `CI: ${B_RESAMPLES} resamples of ${BLOCK_MS / 86_400_000}-day calendar blocks, all coins inside a block\n`
        : `criteria: lift >= ${LIFT_BAR}pt over the coin's own base rate, n >= ${N_FLOOR}\n`),
  );

  const bundles = new Map<string, Bundle>();
  const base = new Map<string, number[]>();
  const dropped: string[] = [];

  for (const coin of COINS) {
    const all = await binance.getCandlesPaged(coin, '1h' as TimeInterval, BARS);
    // The still-forming bar is never an observation and never a forward price.
    const closed = all.slice(0, -1);
    const cut = Math.floor(closed.length * TUNE_SHARE);
    const candles = closed.slice(0, cut);
    if (candles.length < 200) {
      dropped.push(`${coin} (only ${candles.length} bars)`);
      continue;
    }

    let funding: Pub[] = [];
    let premium: Pub[] = [];
    if (needFlow) {
      const pair = `${coin}USDT`;
      const since = candles[0].time.getTime();
      try {
        [funding, premium] = await Promise.all([
          fetchFunding(pair, since),
          fetchPremium(pair, since),
        ]);
      } catch (e) {
        dropped.push(`${coin} (flow fetch: ${e instanceof Error ? e.message : e})`);
        continue;
      }
      // A perpetual whose flow does not cover the window is DROPPED, never
      // substituted or partially filled.
      const fOk = funding.length > 0 && funding[0].publishedAt <= since;
      const pOk = premium.length > 0 && premium[0].publishedAt <= since + 3_600_000;
      if (!fOk || !pOk) {
        dropped.push(
          `${coin} (flow starts ${new Date(Math.max(funding[0]?.publishedAt ?? 0, premium[0]?.publishedAt ?? 0)).toISOString().slice(0, 10)}, ` +
            `window starts ${new Date(since).toISOString().slice(0, 10)})`,
        );
        continue;
      }
    }

    bundles.set(coin, { candles, funding, premium });

    // Base rate: this coin's own share of upward forward moves, per horizon.
    const ups = HORIZONS.map(() => 0);
    const tot = HORIZONS.map(() => 0);
    for (let i = 0; i < candles.length; i++) {
      HORIZONS.forEach((h, hi) => {
        if (i + h >= candles.length) return;
        tot[hi] += 1;
        if (candles[i + h].close > candles[i].close) ups[hi] += 1;
      });
    }
    base.set(coin, HORIZONS.map((_, hi) => pctOf(ups[hi], tot[hi])));

    console.log(
      `${coin.padEnd(5)} ${candles.length} TUNE bars ` +
        `${candles[0].time.toISOString().slice(0, 10)} → ${candles[candles.length - 1].time.toISOString().slice(0, 10)}` +
        (needFlow ? ` · funding ${funding.length} · premium ${premium.length}` : ''),
    );
  }

  console.log(
    `\ncoverage: ${bundles.size}/${COINS.length} coins in` +
      (dropped.length ? `, dropped: ${dropped.join('; ')}` : ', none dropped'),
  );

  console.log('\nbase rate — this coin\'s own share of UP forward moves (the null)');
  console.log('coin     +4h      +12h     +24h');
  for (const [coin, b] of base) {
    console.log(`${coin.padEnd(8)} ${b.map((x) => `${f(x, 1)}%`.padEnd(8)).join(' ')}`);
  }

  if (DECILES) {
    runDeciles(wanted, bundles, base);
    return;
  }

  const rng = makeRng(SEED);

  for (const input of wanted) {
    console.log(`\n${'='.repeat(84)}\n${input.label}`);
    console.log(
      `bucket edges (fixed, not percentiles): ${input.edges.join(' | ')}${input.unit}`,
    );

    const obs: Obs[] = [];
    for (const [coin, bundle] of bundles) {
      const c = bundle.candles;
      const bs = base.get(coin) as number[];
      for (let i = 0; i < c.length; i++) {
        const raw = input.compute(bundle, i);
        if (!Number.isFinite(raw)) continue;
        const fwd = HORIZONS.map((h) =>
          i + h < c.length ? ((c[i + h].close - c[i].close) / c[i].close) * 100 : NaN,
        );
        if (fwd.every((x) => !Number.isFinite(x))) continue;
        obs.push({ coin, raw, bucket: bucketOf(raw, input.edges), fwd, base: bs, t: closeOf(c, i) });
      }
    }

    const hits = report(obs, input, false);

    // Per-coin persistence, but only for buckets that actually cleared. The
    // LIVE criterion needs 6+ of 10 coins; anything below the bar has nothing
    // to be persistent about.
    for (const hit of hits) {
      const inB = obs.filter((o) => o.bucket === hit.bucket);
      const perCoin = [...bundles.keys()].map((coin) => {
        const v = inB.filter((o) => o.coin === coin);
        const fw = v.map((o) => o.fwd[hit.hi]).filter(Number.isFinite);
        if (fw.length === 0) return `${coin} —`;
        const up = pctOf(fw.filter((x) => x > 0).length, fw.length);
        const lift = up - (base.get(coin) as number[])[hit.hi];
        return `${coin} ${lift >= 0 ? '+' : ''}${f(lift, 1)}`;
      });
      const same = perCoin.filter((s) => {
        const n = Number(s.split(' ')[1]);
        return Number.isFinite(n) && Math.sign(n) === Math.sign(hit.lift);
      }).length;
      console.log(
        `    per-coin lift for ${bucketLabel(hit.bucket, input.edges, input.unit)} @+${HORIZONS[hit.hi]}h: ` +
          `${perCoin.join('  ')}\n      same sign on ${same}/${bundles.size} coins ` +
          `(LIVE needs 6+)`,
      );
    }

    // ── shuffled control ────────────────────────────────────────────────
    // Buckets kept, forward returns reassigned at random. Every cell must land
    // on its coin's base rate. If one clears the lift bar the rig is broken and
    // nothing above it means anything.
    const pool = obs.map((o) => o.fwd);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    const shuffled = obs.map((o, k) => ({ ...o, fwd: pool[k] }));
    console.log('\n  — shuffled-label control (must show no lift) —');
    report(shuffled, input, true);
  }
}

interface Hit { bucket: number; hi: number; lift: number }

function report(obs: Obs[], input: Input, isControl: boolean): Hit[] {
  const nBuckets = input.edges.length + 1;

  console.log(
    `\n  ${'bucket'.padEnd(20)} ${'n'.padEnd(8)} ` +
      HORIZONS.map((h) =>
        `${`+${h}h up%`.padEnd(9)}${'lift'.padEnd(8)}${'mean'.padEnd(8)}${'med'.padEnd(8)}`,
      ).join(''),
  );

  const hits: Hit[] = [];
  const flags: string[] = [];
  for (let b = 0; b < nBuckets; b++) {
    const inB = obs.filter((o) => o.bucket === b);
    if (inB.length === 0) continue;
    const cells: string[] = [];
    HORIZONS.forEach((h, hi) => {
      const rows = inB.filter((o) => Number.isFinite(o.fwd[hi]));
      const v = rows.map((o) => o.fwd[hi]);
      const up = pctOf(v.filter((x) => x > 0).length, v.length);
      // Lift against the coins actually in this bucket, not against 50%.
      const expected = mean(rows.map((o) => o.base[hi]));
      const lift = up - expected;
      cells.push(
        `${f(up, 1)}%`.padEnd(9),
        `${lift >= 0 ? '+' : ''}${f(lift, 1)}`.padEnd(8),
        f(mean(v), 2).padEnd(8),
        f(median(v), 2).padEnd(8),
      );
      if (Math.abs(lift) >= LIFT_BAR && v.length >= N_FLOOR) {
        hits.push({ bucket: b, hi, lift });
        flags.push(
          `      ${isControl ? 'BROKEN — shuffled ' : ''}` +
            `${bucketLabel(b, input.edges, input.unit)} @+${h}h: ` +
            `${f(up, 1)}% vs base ${f(expected, 1)}% = ${lift >= 0 ? '+' : ''}${f(lift, 1)}pt ` +
            `on n=${v.length} · mean fwd ${f(mean(v), 3)}%`,
        );
      } else if (Math.abs(lift) >= LIFT_BAR) {
        flags.push(
          `      UNPROVEN ${bucketLabel(b, input.edges, input.unit)} @+${h}h: ` +
            `${lift >= 0 ? '+' : ''}${f(lift, 1)}pt on n=${v.length} — under the ${N_FLOOR} floor`,
        );
      }
    });
    console.log(
      `  ${bucketLabel(b, input.edges, input.unit).padEnd(20)} ${String(inB.length).padEnd(8)} ${cells.join('')}`,
    );
  }
  console.log(
    flags.length
      ? `\n    buckets at or past ${LIFT_BAR}pt of lift:\n${flags.join('\n')}`
      : `\n    no bucket reached ${LIFT_BAR}pt of lift at any horizon`,
  );
  return isControl ? [] : hits;
}

// ── decile bucketing ────────────────────────────────────────────────────
//
// The earlier runs used FIXED edges chosen from what an input means. That is
// honest about lookahead and blind to where the mass actually sits: V1 put
// everything above +5% into one bucket of 39,022 observations and reported the
// average of a wide tail as though it were a cell. The tail had a result in it.
//
// Deciles are cut PER COIN and from TUNE ONLY. Per coin, because a pooled
// decile is mostly whichever coin is most volatile. From TUNE only, because a
// percentile of the whole sample is computed from bars in the future of the one
// being labelled — the same leak the fixed edges existed to avoid, and a
// sharper one here since the edges are now derived from the data itself.
//
// The boundaries are printed with every run so that a holdout spend applies
// THESE numbers rather than re-deriving percentiles over there.

const DECILE_QS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** The 9 cut points of a coin's own TUNE distribution. Sorted input copy. */
export function decileEdges(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return [];
  return DECILE_QS.map((q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]);
}

const decileLabel = (b: number): string => `D${b + 1}`;

// ── the block bootstrap ─────────────────────────────────────────────────
//
// Every CI and every effective n in this file comes from here.
//
// A block is 14 calendar days and is drawn with EVERY coin's observations
// inside it. Ten crypto majors over one window are not ten independent
// samples — they move together — and resampling coins or bars independently
// would quietly claim otherwise. Same reasoning as the month blocks in
// bootstrap.ts.
//
// ~19 months of TUNE is about 42 blocks. That is the real sample size behind
// every interval printed below, and it is why they are wide: 140,000
// observations of an 8-hourly series, sampled hourly, across ten correlated
// coins, is not 140,000 pieces of evidence. The whole point of the re-run is
// that a cell should say how precisely it is measured, not just what it
// measured.

/** One draw sequence, reused across every cell of a report (common random
 *  numbers) — so two cells' intervals are comparable and it costs one pass. */
function blockDraws(nBlocks: number, rng: () => number): Int32Array {
  const draws = new Int32Array(B_RESAMPLES * nBlocks);
  for (let b = 0; b < B_RESAMPLES; b++) {
    for (let k = 0; k < nBlocks; k++) {
      draws[b * nBlocks + k] = Math.floor(rng() * nBlocks);
    }
  }
  return draws;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

interface Cell {
  bucket: number;
  hi: number;
  /** Observations with a finite forward return at this horizon. */
  n: number;
  /**
   * The binomial sample size that would produce the spread the block bootstrap
   * actually shows: p(1-p) / SE^2. On an i.i.d. cell it lands near raw n. On
   * funding — an 8h series sampled hourly, then clustered in time — it should
   * land far below it, which is the thing raw n cannot see.
   */
  nEff: number;
  up: number;
  expected: number;
  lift: number;
  ciLo: number;
  ciHi: number;
  meanFwd: number;
  medFwd: number;
  rawLo: number;
  rawHi: number;
  /** CLEARS = the interval excludes the bar. DEAD = the interval excludes it
   *  on the other side, i.e. this cell is measured and it is flat. */
  verdict: 'DEAD' | 'UNPROVEN' | 'CLEARS';
}

/**
 * Every cell of one input: lift, interval, effective n, verdict.
 *
 * `blockOf` maps an observation to its calendar block. Blocks with nothing in
 * a given cell contribute zero when drawn — which is exactly right: a cell
 * whose observations sit in six blocks should be told it has six blocks of
 * evidence, not forty-two.
 */
function cellsOf(obs: Obs[], nBuckets: number, rng: () => number): Cell[] {
  if (obs.length === 0) return [];
  const t0 = minOf(obs.map((o) => o.t));
  const nBlocks = Math.floor((maxOf(obs.map((o) => o.t)) - t0) / BLOCK_MS) + 1;
  const draws = blockDraws(nBlocks, rng);

  const out: Cell[] = [];
  for (let b = 0; b < nBuckets; b++) {
    const inB = obs.filter((o) => o.bucket === b);
    if (inB.length === 0) continue;
    const raws = inB.map((o) => o.raw);

    HORIZONS.forEach((_h, hi) => {
      const rows = inB.filter((o) => Number.isFinite(o.fwd[hi]));
      if (rows.length === 0) return;
      const v = rows.map((o) => o.fwd[hi]);
      const up = pctOf(v.filter((x) => x > 0).length, v.length);
      const expected = mean(rows.map((o) => o.base[hi]));

      const bUp = new Float64Array(nBlocks);
      const bN = new Float64Array(nBlocks);
      const bBase = new Float64Array(nBlocks);
      for (const o of rows) {
        const k = Math.floor((o.t - t0) / BLOCK_MS);
        bN[k] += 1;
        bBase[k] += o.base[hi];
        if (o.fwd[hi] > 0) bUp[k] += 1;
      }

      const lifts: number[] = [];
      let sp = 0;
      let sp2 = 0;
      let m = 0;
      for (let r = 0; r < B_RESAMPLES; r++) {
        let u = 0;
        let n = 0;
        let bs = 0;
        const off = r * nBlocks;
        for (let k = 0; k < nBlocks; k++) {
          const j = draws[off + k];
          u += bUp[j];
          n += bN[j];
          bs += bBase[j];
        }
        if (n === 0) continue;
        const p = u / n;
        lifts.push(100 * p - bs / n);
        sp += p;
        sp2 += p * p;
        m += 1;
      }
      lifts.sort((a, b2) => a - b2);
      const varP = m > 1 ? Math.max(0, sp2 / m - (sp / m) ** 2) : NaN;
      const pHat = up / 100;
      const nEff = varP > 0 ? (pHat * (1 - pHat)) / varP : NaN;
      const ciLo = quantile(lifts, 0.025);
      const ciHi = quantile(lifts, 0.975);

      // Number.isFinite, not !(nEff < floor): an unmeasurable cell must fail
      // the floor, and NaN fails every comparison including the one that
      // would have let it through.
      const clears =
        (ciLo >= LIFT_BAR || ciHi <= -LIFT_BAR) && Number.isFinite(nEff) && nEff >= NEFF_FLOOR;
      const dead = ciLo > -LIFT_BAR && ciHi < LIFT_BAR;

      out.push({
        bucket: b,
        hi,
        n: v.length,
        nEff,
        up,
        expected,
        lift: up - expected,
        ciLo,
        ciHi,
        meanFwd: mean(v),
        medFwd: median(v),
        rawLo: minOf(raws),
        rawHi: maxOf(raws),
        verdict: clears ? 'CLEARS' : dead ? 'DEAD' : 'UNPROVEN',
      });
    });
  }
  return out;
}

const cellLine = (c: Cell, label: string): string =>
  `  ${label.padEnd(7)}${`[${f(c.rawLo, 2)}, ${f(c.rawHi, 2)}]`.padEnd(24)}` +
  `${String(c.n).padEnd(9)}${(Number.isFinite(c.nEff) ? String(Math.round(c.nEff)) : '—').padEnd(9)}` +
  `${`${f(c.up, 1)}%`.padEnd(8)}${`${f(c.expected, 1)}%`.padEnd(8)}` +
  `${`${c.lift >= 0 ? '+' : ''}${f(c.lift, 1)}`.padEnd(8)}` +
  `${`[${c.ciLo >= 0 ? '+' : ''}${f(c.ciLo, 1)}, ${c.ciHi >= 0 ? '+' : ''}${f(c.ciHi, 1)}]`.padEnd(18)}` +
  `${f(c.meanFwd, 2).padEnd(8)}${c.verdict}`;

function printCells(cells: Cell[], label: (b: number) => string): void {
  HORIZONS.forEach((h, hi) => {
    console.log(
      `\n  +${h}h\n  ${'cell'.padEnd(7)}${'raw range'.padEnd(24)}${'n'.padEnd(9)}` +
        `${'n_eff'.padEnd(9)}${'up%'.padEnd(8)}${'base'.padEnd(8)}${'lift'.padEnd(8)}` +
        `${'95% CI'.padEnd(18)}${'mean%'.padEnd(8)}verdict`,
    );
    for (const c of cells.filter((x) => x.hi === hi)) console.log(cellLine(c, label(c.bucket)));
  });
}

/** Spearman rank correlation of lift against decile index, at one horizon.
 *  A structural signal strengthens across neighbours; noise spikes alone. */
function spearman(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const rank = new Array<number>(n);
  order.forEach(([, i], r) => (rank[i] = r + 1));
  const idx = Array.from({ length: n }, (_, i) => i + 1);
  const mx = mean(idx);
  const my = mean(rank);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (idx[i] - mx) * (rank[i] - my);
    dx += (idx[i] - mx) ** 2;
    dy += (rank[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

// ── the decile run ──────────────────────────────────────────────────────

/** Every observation an input produces, unbucketed. */
function buildObs(input: Input, bundles: Map<string, Bundle>, base: Map<string, number[]>): Obs[] {
  const obs: Obs[] = [];
  for (const [coin, bundle] of bundles) {
    const c = bundle.candles;
    const bs = base.get(coin) as number[];
    for (let i = 0; i < c.length; i++) {
      const raw = input.compute(bundle, i);
      if (!Number.isFinite(raw)) continue;
      const fwd = HORIZONS.map((h) =>
        i + h < c.length ? ((c[i + h].close - c[i].close) / c[i].close) * 100 : NaN,
      );
      if (fwd.every((x) => !Number.isFinite(x))) continue;
      obs.push({ coin, raw, bucket: -1, fwd, base: bs, t: closeOf(c, i) });
    }
  }
  return obs;
}

/** Cut each coin's own distribution into ten, and label every observation.
 *  Returns the boundaries so they can be printed and reused on holdout. */
function assignDeciles(obs: Obs[]): Map<string, number[]> {
  const byCoin = new Map<string, number[]>();
  for (const o of obs) {
    const xs = byCoin.get(o.coin) ?? [];
    xs.push(o.raw);
    byCoin.set(o.coin, xs);
  }
  const edges = new Map<string, number[]>();
  for (const [coin, xs] of byCoin) edges.set(coin, decileEdges(xs));
  for (const o of obs) o.bucket = bucketOf(o.raw, edges.get(o.coin) as number[]);
  return edges;
}

/**
 * Forward returns reshuffled WITHIN each coin.
 *
 * Within, not across: shuffling the pooled set also shuffles which coin's base
 * rate an observation is judged against, so the control was measuring a second
 * thing (worth up to 0.56pt) on top of the one it was for. Deciles stay put,
 * outcomes move, and every cell must land on its own base rate.
 */
function shuffleWithinCoin(obs: Obs[], rng: () => number): Obs[] {
  const idxByCoin = new Map<string, number[]>();
  obs.forEach((o, i) => {
    const xs = idxByCoin.get(o.coin) ?? [];
    xs.push(i);
    idxByCoin.set(o.coin, xs);
  });
  const out = obs.map((o) => ({ ...o }));
  for (const idx of idxByCoin.values()) {
    const pool = idx.map((i) => obs[i].fwd);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    idx.forEach((i, k) => (out[i].fwd = pool[k]));
  }
  return out;
}

/**
 * A positive control for DECILE bucketing.
 *
 * The plants that validated fixed edges do not validate this: the boundaries
 * are now derived from the data, so the cutting code is part of what is being
 * trusted. Each plant takes the real bars — real forward returns, real
 * timestamps, so the block bootstrap sees real time structure — and gives every
 * observation a synthetic value chosen so that a KNOWN lift lands in a KNOWN
 * decile at a KNOWN horizon.
 *
 * Construction, per coin: take the target decile's worth of observations, of
 * which exactly (base + lift)% are ones that went up, drawn at random from the
 * up and down pools. Give those the top (or bottom) tenth of the value range
 * and everyone else the rest. The decile cutter then has to find them.
 *
 * If a plant does not come back at its planted strength, no other number in
 * this run means anything.
 */
interface Plant { key: string; decile: number; hi: number; lift: number }
const PLANTS: Plant[] = [
  { key: 'P5', decile: 9, hi: 2, lift: 8 },
  { key: 'P6', decile: 9, hi: 1, lift: 5 },
  { key: 'P7', decile: 9, hi: 0, lift: 2 },
  { key: 'P8', decile: 0, hi: 1, lift: -5 },
];

function plantedObs(
  plant: Plant,
  bundles: Map<string, Bundle>,
  base: Map<string, number[]>,
  rng: () => number,
): Obs[] {
  const obs: Obs[] = [];
  const top = plant.decile === 9;
  for (const [coin, bundle] of bundles) {
    const c = bundle.candles;
    const bs = base.get(coin) as number[];
    const rows: Obs[] = [];
    for (let i = 0; i < c.length; i++) {
      const fwd = HORIZONS.map((h) =>
        i + h < c.length ? ((c[i + h].close - c[i].close) / c[i].close) * 100 : NaN,
      );
      if (fwd.every((x) => !Number.isFinite(x))) continue;
      rows.push({ coin, raw: NaN, bucket: -1, fwd, base: bs, t: closeOf(c, i) });
    }
    const eligible = rows.filter((r) => Number.isFinite(r.fwd[plant.hi]));
    const ups = eligible.filter((r) => r.fwd[plant.hi] > 0);
    const downs = eligible.filter((r) => !(r.fwd[plant.hi] > 0));
    const shuffle = (xs: Obs[]): Obs[] => {
      const a = [...xs];
      for (let k = a.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [a[k], a[j]] = [a[j], a[k]];
      }
      return a;
    };
    const nD = Math.round(rows.length / 10);
    const wantUp = Math.min(
      ups.length,
      Math.max(0, Math.round((nD * (bs[plant.hi] + plant.lift)) / 100)),
    );
    const picked = new Set<Obs>([
      ...shuffle(ups).slice(0, wantUp),
      ...shuffle(downs).slice(0, Math.max(0, nD - wantUp)),
    ]);
    for (const r of rows) {
      const inPlant = picked.has(r);
      // Planted rows occupy the outer tenth of the range, so the decile cutter
      // — not this function — is what has to put them in the target decile.
      r.raw = top
        ? (inPlant ? 0.9 + 0.1 * rng() : 0.9 * rng())
        : (inPlant ? 0.1 * rng() : 0.1 + 0.9 * rng());
      obs.push(r);
    }
  }
  return obs;
}

function runPlants(
  bundles: Map<string, Bundle>,
  base: Map<string, number[]>,
  rng: () => number,
): boolean {
  console.log(
    `\n${'='.repeat(96)}\nPOSITIVE CONTROL UNDER DECILES — DECILE_AB.md\n` +
      `A planted lift must come back at its planted strength (tolerance ${f(PLANT_TOL, 1)}pt).\n`,
  );
  console.log(
    `  ${'plant'.padEnd(7)}${'decile'.padEnd(8)}${'horizon'.padEnd(9)}${'planted'.padEnd(9)}` +
      `${'recovered'.padEnd(11)}${'n'.padEnd(9)}${'n_eff'.padEnd(9)}${'95% CI'.padEnd(18)}result`,
  );
  let allOk = true;
  for (const plant of PLANTS) {
    const obs = plantedObs(plant, bundles, base, rng);
    assignDeciles(obs);
    const cells = cellsOf(obs, 10, makeRng(SEED));
    const cell = cells.find((c) => c.bucket === plant.decile && c.hi === plant.hi);
    if (!cell) {
      console.log(`  ${plant.key} — NO CELL`);
      allOk = false;
      continue;
    }
    const ok = Math.abs(cell.lift - plant.lift) <= PLANT_TOL;
    allOk = allOk && ok;
    console.log(
      `  ${plant.key.padEnd(7)}${decileLabel(plant.decile).padEnd(8)}` +
        `${`+${HORIZONS[plant.hi]}h`.padEnd(9)}` +
        `${`${plant.lift >= 0 ? '+' : ''}${f(plant.lift, 1)}`.padEnd(9)}` +
        `${`${cell.lift >= 0 ? '+' : ''}${f(cell.lift, 1)}`.padEnd(11)}` +
        `${String(cell.n).padEnd(9)}${String(Math.round(cell.nEff)).padEnd(9)}` +
        `${`[${f(cell.ciLo, 1)}, ${f(cell.ciHi, 1)}]`.padEnd(18)}${ok ? 'OK' : 'FAILED'}`,
    );
  }
  console.log(
    allOk
      ? '\n  positive control PASSED — the decile cutter recovers what is planted in it'
      : '\n  positive control FAILED — nothing else in this run counts',
  );
  return allOk;
}

/** The four extra questions asked of a cell that clears the bar. */
interface Forensics {
  perCoin: string[];
  coinsSameSign: number;
  perPeriod: number[];
  periodsSameSign: number;
  rho: number;
  lifts: number[];
  monotone: boolean;
  dd: Cell | undefined;
  ddBest: Cell | undefined;
  beatsDd: boolean;
  /** How this cell's bars are spread across the drawdown control's deciles. */
  ddSpread: number[];
  /** The same cell with every bar that is ALSO in a drawdown extreme removed. */
  residual: Cell | undefined;
  residualN: number;
}

function forensicsOf(
  cell: Cell,
  obs: Obs[],
  cells: Cell[],
  base: Map<string, number[]>,
  ddCells: Cell[],
  ddBucketAt: Map<string, number>,
): Forensics {
  const inB = obs.filter((o) => o.bucket === cell.bucket && Number.isFinite(o.fwd[cell.hi]));

  const coins = [...new Set(obs.map((o) => o.coin))];
  const perCoin: string[] = [];
  let coinsSameSign = 0;
  for (const coin of coins) {
    const v = inB.filter((o) => o.coin === coin).map((o) => o.fwd[cell.hi]);
    if (v.length === 0) {
      perCoin.push(`${coin} —`);
      continue;
    }
    const lift = pctOf(v.filter((x) => x > 0).length, v.length) - (base.get(coin) as number[])[cell.hi];
    if (Math.sign(lift) === Math.sign(cell.lift)) coinsSameSign += 1;
    perCoin.push(`${coin} ${lift >= 0 ? '+' : ''}${f(lift, 1)}`);
  }

  // Three equal spans of calendar time, not three equal counts: a signal that
  // only exists in 2025 is a 2025 phenomenon, and equal counts would hide that.
  const ts = obs.map((o) => o.t);
  const t0 = minOf(ts);
  const span = (maxOf(ts) - t0) / 3;
  const perPeriod = [0, 1, 2].map((p) => {
    const v = inB.filter((o) => Math.min(2, Math.floor((o.t - t0) / span)) === p);
    if (v.length === 0) return NaN;
    const up = pctOf(v.filter((o) => o.fwd[cell.hi] > 0).length, v.length);
    return up - mean(v.map((o) => o.base[cell.hi]));
  });
  const periodsSameSign = perPeriod.filter((x) => Math.sign(x) === Math.sign(cell.lift)).length;

  const lifts = Array.from({ length: 10 }, (_, b) => {
    const c = cells.find((x) => x.bucket === b && x.hi === cell.hi);
    return c ? c.lift : NaN;
  });
  const rho = spearman(lifts.map((x) => (Number.isFinite(x) ? x : 0)));
  // Structural means the gradient runs across the whole range AND the clearing
  // cell sits at the end of it. One decile spiking in the middle is noise.
  const atEnd = cell.bucket === 0 || cell.bucket === 9;
  const monotone = atEnd && Math.abs(rho) >= 0.7;

  const dd = ddCells.find((c) => c.bucket === cell.bucket && c.hi === cell.hi);
  const ddBest = ddCells
    .filter((c) => c.hi === cell.hi)
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))[0];
  const beatsDd = dd ? Math.abs(cell.lift) > Math.abs(dd.lift) : true;

  // Same decile + same horizon is the comparison the pre-registration asked
  // for, and on its own it is too weak: it only rules out the drawdown control
  // producing the effect AT THE SAME PLACE IN ITS OWN RANGE. The question that
  // actually matters is whether these are the SAME BARS. V1's top decile is
  // "the heavy-volume price is far above spot", which is another way of saying
  // price has fallen away from where it traded — so it can be a drawdown in a
  // volume costume even when the two inputs' deciles do not line up.
  //
  // So: print where this cell's bars sit in the control's deciles, then remove
  // every bar that is also in a drawdown extreme and re-measure what is left.
  const ddSpread = new Array<number>(10).fill(0);
  for (const o of inB) {
    const d = ddBucketAt.get(`${o.coin}|${o.t}`);
    if (d !== undefined) ddSpread[d] += 1;
  }
  const kept = obs.filter((o) => {
    const d = ddBucketAt.get(`${o.coin}|${o.t}`);
    return d !== undefined && d > 1;
  });
  const residual = cellsOf(kept, 10, makeRng(SEED)).find(
    (c) => c.bucket === cell.bucket && c.hi === cell.hi,
  );
  const residualN = kept.filter((o) => o.bucket === cell.bucket).length;

  return {
    perCoin, coinsSameSign, perPeriod, periodsSameSign, rho, lifts, monotone,
    dd, ddBest, beatsDd, ddSpread, residual, residualN,
  };
}

function printBoundaries(edges: Map<string, number[]>, obs: Obs[], unit: string): void {
  console.log(
    `\n  decile boundaries — each coin's OWN TUNE percentiles (apply THESE to holdout)\n` +
      `  ${'coin'.padEnd(6)}${DECILE_QS.map((q) => `p${Math.round(q * 100)}`.padEnd(10)).join('')}`,
  );
  for (const [coin, e] of edges) {
    console.log(`  ${coin.padEnd(6)}${e.map((x) => f(x, 3).padEnd(10)).join('')}${unit}`);
  }
  const counts = Array.from({ length: 10 }, (_, b) => obs.filter((o) => o.bucket === b).length);
  console.log(
    `  counts: ${counts
      .map((n, b) => `${decileLabel(b)} ${n} (${f(pctOf(n, obs.length), 1)}%)`)
      .join('  ')}`,
  );
}

function runDeciles(
  wanted: Input[],
  bundles: Map<string, Bundle>,
  base: Map<string, number[]>,
): void {
  const candidates = wanted.filter((x) => x.group !== 'control');

  if (!args.includes('--no-plants')) {
    const ok = runPlants(bundles, base, makeRng(SEED));
    if (!ok && !args.includes('--force')) {
      console.log('\nstopping: a failed positive control invalidates everything downstream.');
      return;
    }
  }

  // The drawdown baseline runs FIRST, because every candidate cell that clears
  // has to be shown next to it. V1's whole effect reproduced from this input
  // with no volume in it at all; without the comparison the project keeps
  // rediscovering post-drawdown mean reversion in a new costume.
  const ddInput = INPUTS.find((x) => x.key === 'dd') as Input;
  const ddObs = buildObs(ddInput, bundles, base);
  const ddEdges = assignDeciles(ddObs);
  const ddCells = cellsOf(ddObs, 10, makeRng(SEED));
  // Which drawdown decile each bar sits in, so a clearing cell can be asked
  // whether it is made of the same bars rather than merely a different number.
  const ddBucketAt = new Map<string, number>(ddObs.map((o) => [`${o.coin}|${o.t}`, o.bucket]));
  console.log(`\n${'='.repeat(96)}\nCONTROL — ${ddInput.label}`);
  printBoundaries(ddEdges, ddObs, ddInput.unit);
  printCells(ddCells, decileLabel);

  const verdicts: string[] = [];
  let clearingCells = 0;
  let candidateCells = 0;
  const shuffleClears: number[] = [];
  let shuffleWorst = 0;

  for (const input of candidates) {
    console.log(`\n${'='.repeat(96)}\n${input.label}`);
    const obs = buildObs(input, bundles, base);
    const edges = assignDeciles(obs);
    printBoundaries(edges, obs, input.unit);

    const cells = cellsOf(obs, 10, makeRng(SEED));
    printCells(cells, decileLabel);
    candidateCells += cells.length;

    const clears = cells.filter((c) => c.verdict === 'CLEARS');
    clearingCells += clears.length;
    let live = false;

    for (const cell of clears) {
      const fx = forensicsOf(cell, obs, cells, base, ddCells, ddBucketAt);
      const isLive =
        fx.coinsSameSign >= 6 && fx.periodsSameSign === 3 && fx.beatsDd && fx.monotone;
      live = live || isLive;
      console.log(
        `\n  — ${decileLabel(cell.bucket)} @+${HORIZONS[cell.hi]}h clears: ` +
          `${cell.lift >= 0 ? '+' : ''}${f(cell.lift, 1)}pt CI [${f(cell.ciLo, 1)}, ${f(cell.ciHi, 1)}] ` +
          `n=${cell.n} n_eff=${Math.round(cell.nEff)} —\n` +
          `    lift by decile: ${fx.lifts.map((x) => `${x >= 0 ? '+' : ''}${f(x, 1)}`).join(' ')}\n` +
          `    monotone: rho=${f(fx.rho, 2)} at an end=${cell.bucket === 0 || cell.bucket === 9} -> ${fx.monotone ? 'YES' : 'NO'}\n` +
          `    per-coin: ${fx.perCoin.join('  ')}\n` +
          `      same sign on ${fx.coinsSameSign}/${bundles.size} (LIVE needs 6+)\n` +
          `    per-period: ${fx.perPeriod.map((x) => `${x >= 0 ? '+' : ''}${f(x, 1)}`).join('  ')}` +
          ` -> ${fx.periodsSameSign}/3 same sign (LIVE needs 3)\n` +
          `    drawdown baseline, same decile+horizon: ` +
          `${fx.dd ? `${fx.dd.lift >= 0 ? '+' : ''}${f(fx.dd.lift, 1)}pt CI [${f(fx.dd.ciLo, 1)}, ${f(fx.dd.ciHi, 1)}] n=${fx.dd.n}` : '—'}` +
          `  ·  its best cell at +${HORIZONS[cell.hi]}h: ` +
          `${fx.ddBest ? `${decileLabel(fx.ddBest.bucket)} ${fx.ddBest.lift >= 0 ? '+' : ''}${f(fx.ddBest.lift, 1)}pt` : '—'}\n` +
          `      beats the baseline: ${fx.beatsDd ? 'YES' : 'NO'}\n` +
          `    same bars? this cell's spread across the drawdown control's deciles:\n` +
          `      ${fx.ddSpread.map((n, b) => `${decileLabel(b)} ${f(pctOf(n, cell.n), 1)}%`).join('  ')}\n` +
          `    with drawdown D1-D2 bars removed: ` +
          `${fx.residual ? `${fx.residual.lift >= 0 ? '+' : ''}${f(fx.residual.lift, 1)}pt CI [${f(fx.residual.ciLo, 1)}, ${f(fx.residual.ciHi, 1)}] ` +
            `n=${fx.residual.n} n_eff=${Math.round(fx.residual.nEff)} -> ${fx.residual.verdict}` : '— (nothing left)'}\n` +
          `    => ${isLive ? 'LIVE' : 'UNPROVEN (a criterion above failed)'}`,
      );
    }

    const allDead = cells.every((c) => c.verdict === 'DEAD');
    const verdict = live ? 'LIVE' : allDead ? 'DEAD' : 'UNPROVEN';
    verdicts.push(`${input.key.padEnd(11)}${verdict}`);
    console.log(
      `\n  VERDICT ${input.key}: ${verdict} ` +
        `(${cells.filter((c) => c.verdict === 'DEAD').length}/${cells.length} cells measured flat, ` +
        `${clears.length} clear the ${LIFT_BAR}pt bar)`,
    );

    // ── shuffled control ────────────────────────────────────────────────
    // A true null with this input's exact n, decile structure and block
    // structure. It is the honest answer to "how many cells clear by chance",
    // because the nominal figure assumes independence this data does not have.
    const sh: string[] = [];
    for (let s = 0; s < SHUFFLES; s++) {
      const shuffled = shuffleWithinCoin(obs, makeRng(SEED + 1000 * (s + 1)));
      const sc = cellsOf(shuffled, 10, makeRng(SEED));
      const cl = sc.filter((c) => c.verdict === 'CLEARS').length;
      const worst = maxOf(sc.map((c) => Math.abs(c.lift)));
      shuffleClears.push(cl);
      shuffleWorst = Math.max(shuffleWorst, worst);
      sh.push(`seed ${SEED + 1000 * (s + 1)}: ${cl} cells clear, largest |lift| ${f(worst, 1)}pt`);
    }
    console.log(`  shuffled control (within coin, ${SHUFFLES} seeds): ${sh.join(' · ')}`);
  }

  console.log(`\n${'='.repeat(96)}\nSUMMARY`);
  for (const v of verdicts) console.log(`  ${v}`);
  console.log(
    `\n  cells clearing the ${LIFT_BAR}pt bar: ${clearingCells} of ${candidateCells} candidate cells\n` +
      `  shuffled controls over the same cells: ${shuffleClears.join(', ')} ` +
      `(total ${shuffleClears.reduce((a, b) => a + b, 0)} across ${shuffleClears.length} runs), ` +
      `largest |lift| under shuffle ${f(shuffleWorst, 1)}pt\n` +
      `  nominal reference: a 95% interval on a null sitting exactly at the bar clears ` +
      `2.5% of the time = ${f(0.025 * candidateCells, 1)} cells. The shuffle is the better ` +
      `number; the nominal one assumes an independence this data does not have.\n` +
      `  the drawdown baseline is excluded from both counts — it is a control, not a candidate.`,
  );
}

// ── self-check ──────────────────────────────────────────────────────────
function selfCheck(): void {
  const ok = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  const T0 = Date.UTC(2026, 0, 1);
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 900; i++) {
    price *= 1 + Math.sin(i / 7) * 0.004 + Math.cos(i / 31) * 0.002;
    const open = price * (1 - Math.sin(i / 5) * 0.001);
    bars.push({
      time: new Date(T0 + i * 3_600_000),
      open,
      high: Math.max(open, price) * 1.002,
      low: Math.min(open, price) * 0.998,
      close: price,
      volume: 1000 + ((i * 37) % 500) + (i % 11 === 0 ? 4000 : 0),
    });
  }
  // Funding settles every 8h; premium publishes hourly at each bar's close.
  const funding: Pub[] = [];
  for (let k = 0; k * 8 < 900; k++) {
    funding.push({ publishedAt: T0 + k * 8 * 3_600_000, value: 0.01 * Math.sin(k / 4) });
  }
  const premium: Pub[] = bars.map((c, i) => ({
    publishedAt: c.time.getTime() + 3_600_000,
    value: -0.04 + 0.02 * Math.cos(i / 13),
  }));
  const bundle: Bundle = { candles: bars, funding, premium };

  /** Everything a decision at bar i is allowed to see, and nothing else. */
  const truncate = (b: Bundle, i: number): Bundle => {
    const at = closeOf(b.candles, i);
    return {
      candles: b.candles.slice(0, i + 1),
      funding: b.funding.filter((r) => r.publishedAt <= at),
      premium: b.premium.filter((r) => r.publishedAt <= at),
    };
  };

  // 1. THE LOOKAHEAD INVARIANT, on all eight inputs. Recomputing on a bundle
  //    truncated at bar i must give the identical number. Anything that reads a
  //    later candle, or a funding value settled after the bar closed, changes
  //    when the future is removed.
  for (const input of INPUTS) {
    for (const i of [520, 640, 777, 899]) {
      const full = input.compute(bundle, i);
      const cut = input.compute(truncate(bundle, i), i);
      ok(
        (Number.isNaN(full) && Number.isNaN(cut)) || full === cut,
        `${input.key} reads past bar ${i}: full=${full} truncated=${cut}`,
      );
    }
  }

  // 2. The invariant test must be able to FAIL, or it proves nothing. Two
  //    deliberate cheats: the next candle, and the funding that settles AFTER
  //    the bar closes — the second is the specific way this experiment could
  //    have faked a result.
  const peekCandle = (b: Bundle, i: number): number =>
    i + 1 < b.candles.length ? b.candles[i + 1].close : NaN;
  const peekFunding = (b: Bundle, i: number): number => {
    const at = closeOf(b.candles, i);
    const next = b.funding.find((r) => r.publishedAt > at);
    return next ? next.value : NaN;
  };
  for (const [name, cheat] of [
    ['next candle', peekCandle],
    ['unpublished funding', peekFunding],
  ] as const) {
    let fired = false;
    for (const i of [520, 640, 777]) {
      const full = cheat(bundle, i);
      const cut = cheat(truncate(bundle, i), i);
      if (!((Number.isNaN(full) && Number.isNaN(cut)) || full === cut)) fired = true;
    }
    ok(fired, `the lookahead check cannot detect a ${name} cheat`);
  }

  // 3. Publication lag, stated as a concrete case: a bar closing one hour into
  //    an 8h funding period must see the PREVIOUS settlement, not the one that
  //    period ends with.
  const i1 = 8 * 5 + 1; // one bar past a settlement boundary
  const seen = latestAtOrBefore(funding, closeOf(bars, i1));
  const boundary = T0 + 6 * 8 * 3_600_000;
  ok(seen !== null && seen.publishedAt < boundary, 'a bar saw funding published after it closed');
  ok(
    latestAtOrBefore(funding, T0 - 1) === null,
    'a bar before any settlement must see no funding, not the first one',
  );
  // The co-terminal premium kline IS allowed: it closes when the bar closes.
  const pAt = latestAtOrBefore(premium, closeOf(bars, 100));
  ok(pAt?.publishedAt === closeOf(bars, 100), 'the co-terminal premium kline should be visible');

  // 4. nthBefore counts published rows backwards, and refuses to wrap.
  ok(nthBefore(funding, closeOf(bars, 800), 0)?.publishedAt !== undefined, 'nthBefore(0)');
  const a0 = nthBefore(funding, closeOf(bars, 800), 0) as Pub;
  const a3 = nthBefore(funding, closeOf(bars, 800), 3) as Pub;
  ok(a0.publishedAt - a3.publishedAt === 3 * 8 * 3_600_000, 'nthBefore steps one settlement at a time');
  ok(nthBefore(funding, T0 + 3_600_000, 5) === null, 'nthBefore does not wrap past the start');

  // 5. Bucketing is total, ordered, and never sample-derived.
  const edges = [-1, 0, 1];
  ok(bucketOf(-99, edges) === 0, 'below every edge -> bucket 0');
  ok(bucketOf(-1, edges) === 1, 'edges are inclusive lower bounds');
  ok(bucketOf(0.5, edges) === 2, 'mid bucket');
  ok(bucketOf(99, edges) === 3, 'above every edge -> last bucket');
  ok(bucketOf(NaN, edges) === 0, 'NaN buckets deterministically (and is filtered upstream)');

  // 6. The volume inputs still mean what their names say, at real windows.
  const run = (n: number, up: boolean): Candle[] =>
    Array.from({ length: n }, () => ({
      ...bars[0], open: up ? 1 : 2, close: up ? 2 : 1, volume: 10,
    }));
  const only = (candles: Candle[]): Bundle => ({ candles, funding: [], premium: [] });
  const W = DELTA_WINDOW;
  ok(volumeDelta(only(run(W, true)), W - 1) === 1, 'all up bars -> delta +1');
  ok(volumeDelta(only(run(W, false)), W - 1) === -1, 'all down bars -> delta -1');
  ok(Number.isNaN(volumeDelta(only(run(W - 1, true)), W - 2)), 'short window -> NaN, not a partial answer');
  ok(Math.abs(volumeDelta(only([...run(W / 2, true), ...run(W / 2, false)]), W - 1)) < 1e-12,
    'balanced volume -> delta 0');
  ok(relativeVolume(only(run(RELVOL_WINDOW + 1, true)), RELVOL_WINDOW) === 1, 'flat volume -> relvol 1');

  // 7. DECILE CUTTING — equal counts, and cut per coin rather than pooled.
  const flat = Array.from({ length: 1000 }, (_, i) => i);
  const e10 = decileEdges(flat);
  ok(e10.length === 9, 'nine cut points');
  ok(e10[0] === 100 && e10[4] === 500 && e10[8] === 900, `cuts land on percentiles: ${e10.join(',')}`);
  const dCounts = new Array(10).fill(0);
  for (const v of flat) dCounts[bucketOf(v, e10)] += 1;
  ok(dCounts.every((c) => c === 100), `each decile holds a tenth: ${dCounts.join(',')}`);

  // Per coin, because a pooled cut is mostly whichever coin has the widest
  // range: BIG's values are 10x SMALL's, and both must still fill all ten.
  const twoCoins: Obs[] = [];
  for (let i = 0; i < 1000; i++) {
    for (const [coin, scale] of [['SMALL', 1], ['BIG', 10]] as const) {
      twoCoins.push({ coin, raw: i * scale, bucket: -1, fwd: [1, 1, 1], base: [50, 50, 50], t: T0 + i * 3_600_000 });
    }
  }
  assignDeciles(twoCoins);
  for (const coin of ['SMALL', 'BIG']) {
    const c = new Array(10).fill(0);
    for (const o of twoCoins.filter((x) => x.coin === coin)) c[o.bucket] += 1;
    ok(c.every((x) => x === 100), `${coin} fills every decile of its own scale: ${c.join(',')}`);
  }

  ok(Math.abs(spearman([1, 2, 3, 4, 5]) - 1) < 1e-9, 'spearman: rising is +1');
  ok(Math.abs(spearman([5, 4, 3, 2, 1]) + 1) < 1e-9, 'spearman: falling is -1');
  ok(quantile([1, 2, 3, 4, 5], 0.5) === 3, 'quantile: median');

  // 8. THE POSITIVE CONTROL, OFFLINE. A known lift is planted in a known
  //    decile of synthetic bars, and the decile cutter plus the block
  //    bootstrap have to find it. This is the check that would fail if the
  //    percentile cutting, the pooling or the base-rate subtraction were
  //    wrong — and no result from a live run counts if it does.
  const rngSC = makeRng(4242);
  const synth = new Map<string, Bundle>();
  const synthBase = new Map<string, number[]>();
  for (const coin of ['AAA', 'BBB', 'CCC']) {
    const cs: Candle[] = [];
    let px = 100;
    for (let i = 0; i < 4000; i++) {
      px *= 1 + (rngSC() - 0.5) * 0.02;
      cs.push({ time: new Date(T0 + i * 3_600_000), open: px, high: px * 1.001, low: px * 0.999, close: px, volume: 1000 });
    }
    synth.set(coin, { candles: cs, funding: [], premium: [] });
    const ups = HORIZONS.map(() => 0);
    const tot = HORIZONS.map(() => 0);
    for (let i = 0; i < cs.length; i++) {
      HORIZONS.forEach((h, hi) => {
        if (i + h >= cs.length) return;
        tot[hi] += 1;
        if (cs[i + h].close > cs[i].close) ups[hi] += 1;
      });
    }
    synthBase.set(coin, HORIZONS.map((_x, hi) => pctOf(ups[hi], tot[hi])));
  }
  for (const plant of PLANTS) {
    const pObs = plantedObs(plant, synth, synthBase, makeRng(7));
    assignDeciles(pObs);
    const pCells = cellsOf(pObs, 10, makeRng(7));
    const hit = pCells.find((c) => c.bucket === plant.decile && c.hi === plant.hi) as Cell;
    ok(hit !== undefined, `${plant.key}: the planted decile exists`);
    ok(
      Math.abs(hit.lift - plant.lift) <= PLANT_TOL,
      `${plant.key}: planted ${plant.lift}pt, recovered ${f(hit.lift, 2)}pt`,
    );
    // and the deciles NOT planted in must stay flat, or the plant leaked
    const mid = pCells.find((c) => c.bucket === 4 && c.hi === plant.hi) as Cell;
    ok(Math.abs(mid.lift) < 3, `${plant.key}: D5 stays flat (${f(mid.lift, 2)}pt) — the plant did not leak`);
  }

  // 9. Effective n must be BELOW raw n on overlapping forward returns. This is
  //    the whole reason the CIs are block-bootstrapped: neighbouring hourly
  //    bars share most of a 24h forward window, so raw n overstates evidence.
  const overlapObs = plantedObs(PLANTS[0], synth, synthBase, makeRng(9));
  assignDeciles(overlapObs);
  const overlapCell = cellsOf(overlapObs, 10, makeRng(9)).find(
    (c) => c.bucket === 9 && c.hi === 2,
  ) as Cell;
  ok(
    overlapCell.nEff < overlapCell.n,
    `effective n (${f(overlapCell.nEff, 0)}) must be under raw n (${overlapCell.n})`,
  );

  ok(median([3, 1, 2]) === 2, 'median odd');
  ok(median([4, 1, 2, 3]) === 2.5, 'median even');
  ok(Number.isNaN(median([])), 'empty median is NaN');

  console.log(
    'self-check passed (lookahead invariant on all 9 inputs, 2 peeking cheats both ' +
      'detected, publication lag, nthBefore, bucket totality, volume semantics, median, ' +
      'decile cutting per coin, 4 planted signals recovered offline, effective n < raw n)',
  );
}

if (require.main === module && args.includes('--self-check')) {
  selfCheck();
} else if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
