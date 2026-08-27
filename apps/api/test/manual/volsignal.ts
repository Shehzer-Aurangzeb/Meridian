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
  group: 'volume' | 'flow';
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
      args.includes('--all') ||
      args.includes(`--${x.key}`) ||
      args.includes(`--${x.group}`),
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
      `criteria: lift >= ${LIFT_BAR}pt over the coin's own base rate, n >= ${N_FLOOR}\n`,
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
        obs.push({ coin, raw, bucket: bucketOf(raw, input.edges), fwd, base: bs });
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

  ok(median([3, 1, 2]) === 2, 'median odd');
  ok(median([4, 1, 2, 3]) === 2.5, 'median even');
  ok(Number.isNaN(median([])), 'empty median is NaN');

  console.log(
    'self-check passed (lookahead invariant on all 8 inputs, 2 peeking cheats both ' +
      'detected, publication lag, nthBefore, bucket totality, volume semantics, median)',
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
