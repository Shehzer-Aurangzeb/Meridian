/**
 * Does volume information predict DIRECTION? VOLUME_AB.md.
 *
 *   npx ts-node --transpile-only test/manual/volsignal.ts --nodes --bars 20000
 *   npx ts-node --transpile-only test/manual/volsignal.ts --relvol --extremes --delta
 *   npx ts-node --transpile-only test/manual/volsignal.ts --all --coins BTC,ETH
 *   npx ts-node --transpile-only test/manual/volsignal.ts --self-check
 *
 * No entries, stops, targets or cost model. Every bar is one observation of
 * "input value now -> was price higher 4/12/24h later". If volume cannot pick a
 * direction, nothing built on it can, and that is cheaper to learn here.
 *
 * TUNE only — the oldest 70% of each coin's bars. The holdout is not touched.
 *
 * Read-only. Fetches candles, writes nothing.
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

// ── the four inputs ─────────────────────────────────────────────────────
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
function volumeNode(candles: Candle[], i: number): number {
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
function relativeVolume(candles: Candle[], i: number): number {
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
function volumeAtExtreme(candles: Candle[], i: number): number {
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
function volumeDelta(candles: Candle[], i: number): number {
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

/**
 * Bucket edges are FIXED numbers chosen from what each input means, never
 * sample percentiles: a percentile boundary is computed from the whole series,
 * including bars in the future of the one being labelled.
 */
interface Input {
  key: string;
  label: string;
  compute: (candles: Candle[], i: number) => number;
  edges: number[];
  unit: string;
}

const INPUTS: Input[] = [
  {
    key: 'nodes',
    label: '1. volume node — signed % from spot to heaviest-traded price',
    compute: volumeNode,
    edges: [-5, -3, -1.5, -0.5, 0.5, 1.5, 3, 5],
    unit: '%',
  },
  {
    key: 'relvol',
    label: '2. relative volume — this bar vs its prior 24-bar mean',
    compute: relativeVolume,
    edges: [0.5, 0.8, 1.0, 1.25, 1.6, 2.5, 4],
    unit: 'x',
  },
  {
    key: 'extremes',
    label: '3. volume at the most recent 48-bar extreme (+high / -low)',
    compute: volumeAtExtreme,
    edges: [-3, -2, -1.4, -1, 1, 1.4, 2, 3],
    unit: 'x',
  },
  {
    key: 'delta',
    label: '4. volume delta proxy — (up vol - down vol) / total, 24 bars',
    compute: volumeDelta,
    edges: [-0.5, -0.3, -0.15, -0.05, 0.05, 0.15, 0.3, 0.5],
    unit: '',
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
}

// ── run ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const wanted = INPUTS.filter(
    (x) => args.includes('--all') || args.includes(`--${x.key}`),
  );
  if (wanted.length === 0) {
    console.log(
      'pick at least one input: --nodes --relvol --extremes --delta, or --all\n' +
        'or --self-check',
    );
    return;
  }

  const binance = new BinanceService(cache, new CacheTelemetryService());
  console.log(
    `VOLUME AS A DIRECTIONAL INPUT — VOLUME_AB.md\n` +
      `coins=${COINS.join(',')} bars=${BARS} horizons=${HORIZONS.join('/')}h ` +
      `tune=oldest ${TUNE_SHARE * 100}% seed=${SEED}\n`,
  );

  const series = new Map<string, Candle[]>();
  const baseRate = new Map<string, number[]>();

  for (const coin of COINS) {
    const all = await binance.getCandlesPaged(coin, '1h' as TimeInterval, BARS);
    // The still-forming bar is never an observation and never a forward price.
    const closed = all.slice(0, -1);
    const cut = Math.floor(closed.length * TUNE_SHARE);
    const tune = closed.slice(0, cut);
    series.set(coin, tune);
    console.log(
      `${coin.padEnd(5)} ${closed.length} closed bars, TUNE = oldest ${tune.length} ` +
        `(${tune[0]?.time.toISOString().slice(0, 10)} → ${tune[tune.length - 1]?.time.toISOString().slice(0, 10)})`,
    );
  }

  // ── base rate: what share of forward moves were up at all, per coin ────
  console.log('\nbase rate — share of forward moves that were UP (the null)');
  console.log('coin     n         +4h      +12h     +24h');
  for (const coin of COINS) {
    const c = series.get(coin) ?? [];
    const ups = HORIZONS.map(() => 0);
    const tot = HORIZONS.map(() => 0);
    for (let i = 0; i < c.length; i++) {
      HORIZONS.forEach((h, hi) => {
        if (i + h >= c.length) return;
        tot[hi] += 1;
        if (c[i + h].close > c[i].close) ups[hi] += 1;
      });
    }
    console.log(
      `${coin.padEnd(8)} ${String(tot[0]).padEnd(9)} ` +
        HORIZONS.map((_, hi) => `${f(pctOf(ups[hi], tot[hi]), 1)}%`.padEnd(8)).join(' '),
    );
  }

  const rng = makeRng(SEED);

  for (const input of wanted) {
    console.log(`\n${'='.repeat(78)}\n${input.label}`);
    console.log(
      `bucket edges (fixed, not percentiles): ${input.edges.join(' | ')}${input.unit}`,
    );

    const obs: Obs[] = [];
    for (const coin of COINS) {
      const c = series.get(coin) ?? [];
      for (let i = 0; i < c.length; i++) {
        const raw = input.compute(c, i);
        if (!Number.isFinite(raw)) continue;
        const fwd = HORIZONS.map((h) =>
          i + h < c.length ? ((c[i + h].close - c[i].close) / c[i].close) * 100 : NaN,
        );
        if (fwd.every((x) => !Number.isFinite(x))) continue;
        obs.push({ coin, raw, bucket: bucketOf(raw, input.edges), fwd });
      }
    }

    report(obs, input, false);

    // ── shuffled control ────────────────────────────────────────────────
    // Buckets kept, forward returns reassigned at random. Every bucket must
    // land on the base rate. If one clears 55% here the measurement is broken
    // and nothing above it means anything.
    const shuffled = obs.map((o) => ({ ...o, fwd: o.fwd }));
    const pool = obs.map((o) => o.fwd);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    shuffled.forEach((o, k) => (o.fwd = pool[k]));
    console.log('\n  — shuffled-label control (must sit at the base rate) —');
    report(shuffled, input, true);
  }
}

function report(obs: Obs[], input: Input, terse: boolean): void {
  const nBuckets = input.edges.length + 1;
  const overallUp = HORIZONS.map((_, hi) => {
    const v = obs.map((o) => o.fwd[hi]).filter(Number.isFinite);
    return pctOf(v.filter((x) => x > 0).length, v.length);
  });

  console.log(
    `\n  ${'bucket'.padEnd(20)} ${'n'.padEnd(8)} ` +
      HORIZONS.map((h) => `${`+${h}h up%`.padEnd(9)}${`mean`.padEnd(8)}${`med`.padEnd(8)}`).join(''),
  );

  const flags: string[] = [];
  for (let b = 0; b < nBuckets; b++) {
    const inB = obs.filter((o) => o.bucket === b);
    if (inB.length === 0) continue;
    const cells: string[] = [];
    HORIZONS.forEach((h, hi) => {
      const v = inB.map((o) => o.fwd[hi]).filter(Number.isFinite);
      const up = pctOf(v.filter((x) => x > 0).length, v.length);
      cells.push(`${f(up, 1)}%`.padEnd(9), f(mean(v), 2).padEnd(8), f(median(v), 2).padEnd(8));
      // The kill criterion, applied here rather than by eye.
      if (!terse && v.length >= 100 && (up >= 55 || up <= 45)) {
        flags.push(
          `      ${bucketLabel(b, input.edges, input.unit)} at +${h}h: ${f(up, 1)}% ` +
            `on n=${v.length} (base ${f(overallUp[hi], 1)}%)`,
        );
      }
      if (terse && v.length >= 100 && (up >= 55 || up <= 45)) {
        flags.push(
          `      BROKEN: shuffled ${bucketLabel(b, input.edges, input.unit)} at +${h}h ` +
            `reached ${f(up, 1)}% on n=${v.length}`,
        );
      }
    });
    console.log(
      `  ${bucketLabel(b, input.edges, input.unit).padEnd(20)} ${String(inB.length).padEnd(8)} ${cells.join('')}`,
    );
  }
  console.log(
    `  ${'ALL'.padEnd(20)} ${String(obs.length).padEnd(8)} ` +
      HORIZONS.map((_, hi) => `${f(overallUp[hi], 1)}%`.padEnd(9) + ' '.repeat(16)).join(''),
  );
  console.log(
    flags.length
      ? `\n    buckets clearing the 55%/45% bar on n>=100:\n${flags.join('\n')}`
      : `\n    no bucket cleared 55%/45% on n>=100 at any horizon`,
  );
}

// ── self-check ──────────────────────────────────────────────────────────
function selfCheck(): void {
  const ok = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  // A deterministic but uneven series, so the inputs have something to chew on.
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 900; i++) {
    price *= 1 + Math.sin(i / 7) * 0.004 + Math.cos(i / 31) * 0.002;
    const open = price * (1 - Math.sin(i / 5) * 0.001);
    bars.push({
      time: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
      open,
      high: Math.max(open, price) * 1.002,
      low: Math.min(open, price) * 0.998,
      close: price,
      volume: 1000 + ((i * 37) % 500) + (i % 11 === 0 ? 4000 : 0),
    });
  }

  // 1. THE LOOKAHEAD INVARIANT. Each input at bar i must depend only on bars
  //    0..i, so recomputing it on a series truncated at i must give the exact
  //    same number. Anything that peeks forward changes when truncated.
  for (const input of INPUTS) {
    for (const i of [520, 640, 777, 899]) {
      const full = input.compute(bars, i);
      const truncated = input.compute(bars.slice(0, i + 1), i);
      ok(
        (Number.isNaN(full) && Number.isNaN(truncated)) || full === truncated,
        `${input.key} reads past bar ${i}: full=${full} truncated=${truncated}`,
      );
    }
  }

  // 2. The invariant test must be capable of failing, or it proves nothing.
  const peeking = (candles: Candle[], i: number): number =>
    i + 1 < candles.length ? candles[i + 1].close : NaN;
  let fired = false;
  const i0 = 600;
  const a = peeking(bars, i0);
  const b = peeking(bars.slice(0, i0 + 1), i0);
  if (!((Number.isNaN(a) && Number.isNaN(b)) || a === b)) fired = true;
  ok(fired, 'the lookahead check cannot detect a deliberately peeking input');

  // 3. Bucketing is total, ordered, and never sample-derived.
  const edges = [-1, 0, 1];
  ok(bucketOf(-99, edges) === 0, 'below every edge -> bucket 0');
  ok(bucketOf(-1, edges) === 1, 'edges are inclusive lower bounds');
  ok(bucketOf(0.5, edges) === 2, 'mid bucket');
  ok(bucketOf(99, edges) === 3, 'above every edge -> last bucket');
  ok(bucketOf(NaN, edges) === 0, 'NaN buckets deterministically (and is filtered upstream)');

  // 4. The inputs mean what their names say, at their real window lengths.
  const run = (n: number, up: boolean): Candle[] =>
    Array.from({ length: n }, () => ({
      ...bars[0],
      open: up ? 1 : 2,
      close: up ? 2 : 1,
      volume: 10,
    }));
  const W = DELTA_WINDOW;
  ok(volumeDelta(run(W, true), W - 1) === 1, 'all up bars -> delta +1');
  ok(volumeDelta(run(W, false), W - 1) === -1, 'all down bars -> delta -1');
  ok(Number.isNaN(volumeDelta(run(W - 1, true), W - 2)), 'short window -> NaN, not a partial answer');
  const half = [...run(W / 2, true), ...run(W / 2, false)];
  ok(Math.abs(volumeDelta(half, W - 1)) < 1e-12, 'balanced volume -> delta 0');

  ok(relativeVolume(run(RELVOL_WINDOW + 1, true), RELVOL_WINDOW) === 1, 'flat volume -> relvol 1');

  ok(median([3, 1, 2]) === 2, 'median odd');
  ok(median([4, 1, 2, 3]) === 2.5, 'median even');
  ok(Number.isNaN(median([])), 'empty median is NaN');

  console.log(
    'self-check passed (lookahead invariant on all 4 inputs + a peeking control, ' +
      'bucket totality, delta bounds, median)',
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
