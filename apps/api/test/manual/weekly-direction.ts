/**
 * Weekly direction — does anything predict which coin goes up next week?
 *
 *   pnpm --filter api weekly-direction
 *   pnpm --filter api weekly-direction --self-check
 *
 * ─── The question ────────────────────────────────────────────────────────
 * Every earlier phase of this project asked the same question on 1h bars and
 * got an answer that could not pay a retail fee. This file asks it on WEEKLY
 * bars, where the fee is charged once per week instead of once per hour, so a
 * signal one twentieth as strong would still clear the same cost.
 *
 * Ten liquid majors, ~190 weekly closes each. At every weekly close the ten
 * coins are ranked by a feature and ranked by what actually happened over the
 * following 1, 2 and 4 weeks, and the two rankings are correlated. That is the
 * cross-sectional information coefficient. Ranking WITHIN a close subtracts the
 * market-wide move, so a feature cannot score by being long crypto in 2023-24.
 *
 * ─── Why the statistics here are not the naive ones ──────────────────────
 * A 4-week forward return measured every week shares 3 of its 4 weeks with the
 * reading before it, so the IC series is autocorrelated by construction and
 * `sd / sqrt(n)` understates the standard error by roughly sqrt(H). Two
 * defences, and they have to agree:
 *   - Newey-West at lag = the horizon, the textbook correction for exactly this.
 *   - A 30-WEEK block bootstrap. Blocks are in weeks, not days, because the
 *     bars are weekly: a 30-day block on weekly bars is four observations and
 *     the resampling would be almost as noisy as the statistic.
 *
 * ─── Four falsification bars, pre-registered ─────────────────────────────
 *   1. Some feature clears |t| > 3.0 (Harvey/Liu/Zhu, many features at once).
 *   2. Priced as a top-3/bottom-3 long-short, it clears a 14 bp round trip.
 *   3. It beats its own shuffled control by an interval excluding zero.
 *   4. It is not momentum: |corr| with the 4-week backward return under 0.70.
 * All four are printed BEFORE any result, as every pre-registration here has.
 *
 * ─── Look-ahead ──────────────────────────────────────────────────────────
 * Three guards:
 *   - the final weekly candle is still forming and is never a row, and never a
 *     forward return either;
 *   - the decision instant is the bar's own CLOSE, and forward returns start
 *     from that same close;
 *   - flow is bucketed into the week that CLOSES at that instant. Binance
 *     settles funding at 00:00/08:00/16:00 UTC, so a print stamped exactly at
 *     the Monday close falls in the NEXT bucket and cannot be read early. The
 *     bucket arithmetic is anchored to 1970-01-05, the first Monday, because
 *     the epoch itself is a Thursday and `date_trunc('week')` would depend on
 *     the session time zone.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import axios from 'axios';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { Candle } from '../../src/common/types/candle.types';
import {
  blockBootstrapMean,
  mean,
  neweyWestSe,
  normalCdf,
  rank,
  spearman,
} from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const START = str('start', '2023-01-01');
const OUT = str('out', 'test/manual/results/weekly-panel.csv');

const WEEK_MS = TIMEFRAME_MS['1w'];
/** 1970-01-05 00:00 UTC — the first Monday, and where Binance weekly bars open. */
const MONDAY_EPOCH_S = 345_600;
const WEEK_S = 604_800;

/** Weekly bars to pull per coin. 400 is ~7.7 years, more than any of these listed. */
const FETCH = num('fetch', 400);
/** Indicator warm-up, in weeks. RSI/ADX/ATR(14) need ~30; the bandwidth
 *  percentile wants as many samples as the listing allows. */
const CTX = num('ctx', 60);
/** Window for the distance-to-extreme features. */
const HIGH_LOW_WEEKS = 20;

const HORIZONS = [1, 2, 4];
const BAR = num('bar', 3.0);
const MIN_COINS = num('min-coins', 8);
/** Weeks, not days. See the header. */
const BLOCK_WEEKS = num('block-weeks', 30);
const DRAWS = num('draws', 2000);
const SHUFFLES = num('shuffles', 1000);
const SEED = num('seed', 12345);
/** Round trip, taker both sides, charged against one unit of gross notional. */
const FEE_BP = num('fee-bp', 14);
/** Coins per side of the long-short. */
const K = num('k', 3);
/** Weekly rank persistence above this is a coin label, not a forecast. */
const MAX_PERSIST = num('max-persist', 0.5);
/** Backward-return correlation above this means the feature IS momentum. */
const MOMENTUM_BAR = num('momentum-bar', 0.7);

const FEATURES = [
  'rsi',
  'adx',
  'diSpread',
  'percentB',
  'bandWidth',
  'bandWidthPct',
  'atrPct',
  'qqe',
  'funding',
  'volChange',
  'oiChange',
  'dist20wHigh',
  'dist20wLow',
] as const;
export type Feature = string;

// ── panel ────────────────────────────────────────────────────────────────

export interface Panel {
  coins: string[];
  /** Weekly CLOSE timestamps, ascending. The decision instant. */
  times: number[];
  /** column -> Float64Array[times.length * coins.length], NaN where absent. */
  data: Map<string, Float64Array>;
}

const bucketOpenMs = (bk: number): number => (bk * WEEK_S + MONDAY_EPOCH_S) * 1000;

/**
 * Flow for one coin, already reduced to one number per week.
 *
 * The reduction happens in SQL rather than here because open interest is a
 * 5-minute series — 384,000 rows per coin for the 190 numbers this needs, and
 * materialising all of them ten times over is the whole runtime of the script.
 *
 * `funding` is the mean of the week's 8-hourly prints, which is what the brief
 * asks for. `oi` is the LAST print inside the week: the week's boundary value,
 * so a change between consecutive weeks is a real change in position rather
 * than a change in the averaging window.
 */
async function loadWeeklyFlow(
  prisma: PrismaClient,
  coin: string,
  fromIso: string,
): Promise<{ funding: Map<number, number>; fundingN: Map<number, number>; oi: Map<number, number> }> {
  const sym = coin.toUpperCase();
  const bucket = `floor((extract(epoch from ts) - ${MONDAY_EPOCH_S}) / ${WEEK_S})::int`;

  const f = await prisma.$queryRawUnsafe<Array<{ bk: number; v: number; n: number }>>(
    `SELECT ${bucket} AS bk, avg(value)::float8 AS v, count(*)::int AS n
       FROM "FlowSample"
      WHERE symbol = $1 AND metric = 'fundingRate' AND ts >= $2::timestamp
      GROUP BY 1`,
    sym,
    fromIso,
  );

  // DISTINCT ON keeps the newest row per bucket, which is the week's closing
  // reading. Ordering must repeat the bucket expression, so it is aliased in a
  // subquery rather than written twice.
  const o = await prisma.$queryRawUnsafe<Array<{ bk: number; value: number }>>(
    `SELECT DISTINCT ON (bk) bk, value FROM (
       SELECT ${bucket} AS bk, ts, value
         FROM "FlowSample"
        WHERE symbol = $1 AND metric = 'openInterest' AND ts >= $2::timestamp
     ) q ORDER BY bk, ts DESC`,
    sym,
    fromIso,
  );

  return {
    funding: new Map(f.map((r) => [bucketOpenMs(r.bk), Number(r.v)])),
    fundingN: new Map(f.map((r) => [bucketOpenMs(r.bk), Number(r.n)])),
    oi: new Map(o.map((r) => [bucketOpenMs(r.bk), Number(r.value)])),
  };
}

/** Highest high and lowest low over the trailing `n` bars, current bar included. */
export function extremes(c: Candle[], i: number, n: number): { hi: number; lo: number } {
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k += 1) {
    if (c[k].high > hi) hi = c[k].high;
    if (c[k].low < lo) lo = c[k].low;
  }
  return { hi, lo };
}

/**
 * Weekly bars for one coin's PERPETUAL, from the futures endpoint.
 *
 * The perp rather than spot, deliberately: funding and open interest are perp
 * series, the 14 bp taker round trip below is a perp fee, and the book this
 * prices is a perp book. Mixing a spot price into that would be pricing one
 * instrument with another's cost. (`BinanceService.getCandlesPaged` reads
 * `api.binance.com`, which is spot, which is why it is not reused here.)
 *
 * One request: 400 weekly bars is under the 1500-bar cap, and none of these ten
 * perps listed earlier than 2019.
 */
export async function weeklyCandles(coin: string, limit: number): Promise<Candle[]> {
  const { data } = await axios.get<Array<Array<string | number>>>(
    'https://fapi.binance.com/fapi/v1/klines',
    {
      params: { symbol: `${coin.toUpperCase()}USDT`, interval: '1w', limit },
      timeout: 60_000,
    },
  );
  return data.map((k) => ({
    time: new Date(k[0] as number),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

export interface Row {
  closeMs: number;
  values: Map<string, number>;
}

async function buildCoin(
  coin: string,
  prisma: PrismaClient,
  indicators: IndicatorsService,
  startMs: number,
): Promise<Row[]> {
  const candles = await weeklyCandles(coin, FETCH);
  // The last bar is still forming: it holds days that have not happened.
  const lastComplete = candles.length - 2;
  const flow = await loadWeeklyFlow(prisma, coin, new Date(startMs - 8 * WEEK_MS).toISOString());

  const rows: Row[] = [];
  for (let i = Math.max(CTX, HIGH_LOW_WEEKS, 4); i <= lastComplete - 1; i += 1) {
    const bar = candles[i];
    const openMs = bar.time.getTime();
    if (openMs < startMs) continue;
    const closeMs = openMs + WEEK_MS;
    const price = bar.close;

    const ctx = indicators.buildContext(coin, '1w', candles.slice(i - CTX + 1, i + 1));
    const { upper, lower } = ctx.bollingerBands;
    const prevVol = candles[i - 1].volume;
    const oiNow = flow.oi.get(openMs);
    const oiPrev = flow.oi.get(openMs - WEEK_MS);
    const { hi, lo } = extremes(candles, i, HIGH_LOW_WEEKS);

    const v = new Map<string, number>();
    v.set('close', price);
    v.set('rsi', ctx.rsi);
    v.set('adx', ctx.adx.adx);
    // ADX alone is direction-free and cannot forecast direction by construction.
    // Its directional half is the DI spread, so both are carried: one is the
    // real candidate, the other is close to a null control.
    v.set('diSpread', ctx.adx.pdi - ctx.adx.mdi);
    v.set('percentB', upper === lower ? NaN : (price - lower) / (upper - lower));
    v.set('bandWidth', ctx.bandWidth);
    v.set('bandWidthPct', indicators.percentileRank(ctx.bandWidth, [...ctx.bandWidthSeries]));
    v.set('atrPct', (ctx.atr / price) * 100);
    v.set('qqe', ctx.qqe.value);
    v.set('funding', flow.funding.get(openMs) ?? NaN);
    v.set('volChange', bar.volume > 0 && prevVol > 0 ? Math.log(bar.volume / prevVol) : NaN);
    v.set(
      'oiChange',
      oiNow !== undefined && oiPrev !== undefined && oiNow > 0 && oiPrev > 0
        ? Math.log(oiNow / oiPrev)
        : NaN,
    );
    // Signed and in percent. Distance to the high is <= 0, to the low >= 0, so
    // they are two different readings rather than one folded onto itself.
    v.set('dist20wHigh', ((price - hi) / price) * 100);
    v.set('dist20wLow', ((price - lo) / price) * 100);

    // Log returns forward, so horizons are additive and +10%/-10% are symmetric.
    // A horizon whose last bar has not completed is NaN rather than a shorter
    // return, and drops out of that horizon's test only.
    for (const h of HORIZONS) {
      v.set(
        `fwd${h}w`,
        i + h <= lastComplete ? Math.log(candles[i + h].close / price) : NaN,
      );
    }
    // Backward 4-week return, for the momentum bar. Not a feature.
    v.set('back4w', Math.log(price / candles[i - 4].close));

    rows.push({ closeMs, values: v });
  }
  return rows;
}

export function assemble(byCoin: Map<string, Row[]>): Panel {
  const coins = [...byCoin.keys()].sort();
  const timeSet = new Set<number>();
  for (const rows of byCoin.values()) for (const r of rows) timeSet.add(r.closeMs);
  const times = [...timeSet].sort((a, b) => a - b);
  const timeIdx = new Map(times.map((t, i) => [t, i]));

  const cols = ['close', ...FEATURES, ...HORIZONS.map((h) => `fwd${h}w`), 'back4w'];
  const data = new Map<string, Float64Array>();
  for (const c of cols) data.set(c, new Float64Array(times.length * coins.length).fill(NaN));

  coins.forEach((coin, ci) => {
    for (const r of byCoin.get(coin)!) {
      const at = timeIdx.get(r.closeMs)! * coins.length + ci;
      for (const c of cols) {
        const x = r.values.get(c);
        if (x !== undefined && Number.isFinite(x)) data.get(c)![at] = x;
      }
    }
  });

  // Cross-sectional rank of every feature, per week.
  //
  // These are emitted because the brief asks for them, and they are NOT tested
  // as separate features: a Spearman correlation is computed from ranks, so
  // IC(rank of x) is IC(x) exactly, and testing both would double the
  // multiple-comparison count for zero extra information. `selfCheck` asserts
  // that identity rather than asking anyone to take it on faith.
  const nC = coins.length;
  for (const f of FEATURES) {
    const src = data.get(f)!;
    const dst = new Float64Array(times.length * nC).fill(NaN);
    for (let ti = 0; ti < times.length; ti += 1) {
      const idx: number[] = [];
      const vals: number[] = [];
      for (let ci = 0; ci < nC; ci += 1) {
        const at = ti * nC + ci;
        if (Number.isFinite(src[at])) {
          idx.push(ci);
          vals.push(src[at]);
        }
      }
      if (vals.length < 2) continue;
      const rk = rank(vals);
      for (let j = 0; j < idx.length; j += 1) dst[ti * nC + idx[j]] = rk[j];
    }
    data.set(`rk_${f}`, dst);
  }

  return { coins, times, data };
}

// ── measurement ──────────────────────────────────────────────────────────

export interface Result {
  feature: Feature;
  horizon: number;
  n: number;
  ic: number;
  se: number;
  t: number;
  lo: number;
  hi: number;
  blocks: number;
  persist: number;
  momentum: number;
}

/** One cross-sectional Spearman per week, between two columns of the panel. */
export function icSeries(
  panel: Panel,
  x: Float64Array,
  y: Float64Array,
): Array<{ time: number; value: number }> {
  const nC = panel.coins.length;
  const out: Array<{ time: number; value: number }> = [];
  for (let ti = 0; ti < panel.times.length; ti += 1) {
    const a: number[] = [];
    const b: number[] = [];
    for (let ci = 0; ci < nC; ci += 1) {
      const at = ti * nC + ci;
      // A coin missing either side is out of THIS week's ranking and no other.
      if (Number.isFinite(x[at]) && Number.isFinite(y[at])) {
        a.push(x[at]);
        b.push(y[at]);
      }
    }
    if (a.length < MIN_COINS) continue;
    const rho = spearman(a, b);
    if (Number.isFinite(rho)) out.push({ time: panel.times[ti], value: rho });
  }
  return out;
}

/**
 * How much a feature's ordering of the ten coins survives ONE week.
 *
 * A feature whose ranking never changes cannot predict a change: it is a fixed
 * bet on which coins, with an effective sample size near one, wearing 190
 * observations as a disguise. Phase B caught raw open interest that way at a
 * 30-day lag. The lag here is a single week, because a weekly bar's decision is
 * remade weekly and that is the horizon at which the ordering has to move.
 */
export function persistence(panel: Panel, f: Float64Array, lagWeeks: number): number {
  const nC = panel.coins.length;
  const rs: number[] = [];
  for (let ti = 0; ti + lagWeeks < panel.times.length; ti += 1) {
    const a: number[] = [];
    const b: number[] = [];
    for (let ci = 0; ci < nC; ci += 1) {
      const p = f[ti * nC + ci];
      const q = f[(ti + lagWeeks) * nC + ci];
      if (Number.isFinite(p) && Number.isFinite(q)) {
        a.push(p);
        b.push(q);
      }
    }
    if (a.length < MIN_COINS) continue;
    const r = spearman(a, b);
    if (Number.isFinite(r)) rs.push(r);
  }
  return rs.length === 0 ? NaN : mean(rs);
}

export function measure(panel: Panel, feature: Feature, horizon: number): Result {
  const f = panel.data.get(feature)!;
  const y = panel.data.get(`fwd${horizon}w`)!;
  const series = icSeries(panel, f, y);
  const persist = persistence(panel, f, 1);
  const momentum = mean(
    icSeries(panel, f, panel.data.get('back4w')!).map((r) => r.value),
  );

  if (series.length < 30) {
    return {
      feature, horizon, n: series.length,
      ic: NaN, se: NaN, t: NaN, lo: NaN, hi: NaN, blocks: 0, persist, momentum,
    };
  }
  const ics = series.map((r) => r.value);
  const ic = mean(ics);
  // Lag = the horizon: two IC readings more than H weeks apart share no part
  // of the same forward return.
  const se = neweyWestSe(ics, horizon);
  const boot = blockBootstrapMean(series, BLOCK_WEEKS * 7, DRAWS, SEED);
  return {
    feature, horizon, n: series.length,
    ic, se, t: ic / se, lo: boot.lo, hi: boot.hi, blocks: boot.blocks, persist, momentum,
  };
}

// ── pricing ──────────────────────────────────────────────────────────────

/**
 * Target weights at one week: long the K coins the feature ranks highest,
 * short the K lowest, sign flipped when the IC is negative.
 *
 * Gross notional sums to 1.0 — each side is 0.5 — so a fee quoted per unit of
 * gross is charged once against the whole book and the basis points below are
 * per unit of capital deployed.
 */
export function weightsAt(
  f: Float64Array,
  y: Float64Array,
  ti: number,
  nC: number,
  sign: number,
  k: number,
  minCoins: number,
): Float64Array | null {
  const idx: number[] = [];
  for (let ci = 0; ci < nC; ci += 1) {
    const at = ti * nC + ci;
    if (Number.isFinite(f[at]) && Number.isFinite(y[at])) idx.push(ci);
  }
  if (idx.length < minCoins || idx.length < 2 * k) return null;
  idx.sort((a, b) => sign * (f[ti * nC + a] - f[ti * nC + b]));
  const w = new Float64Array(nC);
  for (let j = 0; j < k; j += 1) {
    w[idx[idx.length - 1 - j]] = 0.5 / k;
    w[idx[j]] = -0.5 / k;
  }
  return w;
}

export interface Priced {
  /** Gross simple return per holding period, in basis points, per week held. */
  rows: Array<{ time: number; value: number }>;
  grossBp: number;
  /** Fraction of gross notional replaced at each rebalance, 0..1. */
  turnover: number;
}

/**
 * Price the feature as a long-short over `horizon`-week holds.
 *
 * Returns are SIMPLE, not log: a portfolio is a weighted sum of arithmetic
 * returns, and summing log returns across coins would price a book nobody can
 * hold. The series is overlapping — a hold is opened every week — which is
 * exactly what the 30-week block bootstrap is there to handle.
 */
export function price(
  panel: Panel,
  feature: Feature,
  horizon: number,
  sign: number,
  yOverride?: Float64Array,
): Priced {
  const nC = panel.coins.length;
  const f = panel.data.get(feature)!;
  const y = yOverride ?? panel.data.get(`fwd${horizon}w`)!;

  const rows: Array<{ time: number; value: number }> = [];
  const ws: Array<Float64Array | null> = [];
  for (let ti = 0; ti < panel.times.length; ti += 1) {
    const w = weightsAt(f, y, ti, nC, sign, K, MIN_COINS);
    ws.push(w);
    if (w === null) continue;
    let ret = 0;
    for (let ci = 0; ci < nC; ci += 1) {
      if (w[ci] !== 0) ret += w[ci] * (Math.exp(y[ti * nC + ci]) - 1);
    }
    rows.push({ time: panel.times[ti], value: ret * 1e4 });
  }

  // Turnover at the rebalance spacing: how much of the book is different a
  // holding period later. Half the summed absolute weight change, so a fully
  // replaced book is 1.0 rather than 2.0.
  const tos: number[] = [];
  for (let ti = 0; ti + horizon < ws.length; ti += 1) {
    const a = ws[ti];
    const b = ws[ti + horizon];
    if (a === null || b === null) continue;
    let d = 0;
    for (let ci = 0; ci < nC; ci += 1) d += Math.abs(b[ci] - a[ci]);
    tos.push(d / 2);
  }

  return {
    rows,
    grossBp: rows.length === 0 ? NaN : mean(rows.map((r) => r.value)),
    turnover: tos.length === 0 ? NaN : mean(tos),
  };
}

/** Reassign forward returns among the coins present in each week. */
export function permuted(panel: Panel, horizon: number, rng: () => number): Float64Array {
  const nC = panel.coins.length;
  const y = Float64Array.from(panel.data.get(`fwd${horizon}w`)!);
  for (let ti = 0; ti < panel.times.length; ti += 1) {
    const at = ti * nC;
    // Fisher-Yates across the whole week. A blank stays blank and simply moves
    // to another coin, so each week keeps its count of usable coins and the
    // market-wide move for that week survives untouched — only the pairing dies.
    for (let i = nC - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = y[at + i];
      y[at + i] = y[at + j];
      y[at + j] = tmp;
    }
  }
  return y;
}

const quantile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// ── self-check ───────────────────────────────────────────────────────────

/**
 * The three claims in this file that are not obvious by reading it.
 *
 *   pnpm --filter api weekly-direction --self-check
 */
function selfCheck(): void {
  const ok = (name: string, cond: boolean): void => {
    if (!cond) throw new Error(`self-check FAILED: ${name}`);
    console.log(`  ok  ${name}`);
  };

  // 1. Ranking a feature cross-sectionally cannot change its IC, which is why
  //    the rank columns are emitted but not tested a second time.
  const x = [3, 1, 4, 1, 5, 9, 2, 6];
  const y = [-1, 0.5, 2, 0.1, 3, 8, -2, 4];
  ok('IC(rank x, y) === IC(x, y)', Math.abs(spearman(rank(x), y) - spearman(x, y)) < 1e-12);

  // 2. Flipping the sign flips the book: the longs become the shorts exactly.
  const f = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const yy = Float64Array.from(new Array(10).fill(0.01));
  const up = weightsAt(f, yy, 0, 10, 1, 3, 8)!;
  const dn = weightsAt(f, yy, 0, 10, -1, 3, 8)!;
  let flipped = true;
  let gross = 0;
  for (let i = 0; i < 10; i += 1) {
    if (Math.abs(up[i] + dn[i]) > 1e-12) flipped = false;
    gross += Math.abs(up[i]);
  }
  ok('sign flip mirrors the book', flipped);
  ok('gross notional is 1.0', Math.abs(gross - 1) < 1e-12);

  // 3. Newey-West at lag 0 is the ordinary standard error. If this drifts, the
  //    autocorrelation correction is doing something other than correcting.
  const s = [0.1, -0.2, 0.3, 0.05, -0.1, 0.22, -0.03, 0.14, 0.0, -0.08];
  const m = mean(s);
  const plain = Math.sqrt(s.reduce((a, v) => a + (v - m) ** 2, 0) / s.length / s.length);
  ok('Newey-West at lag 0 === sd/sqrt(n)', Math.abs(neweyWestSe(s, 0) - plain) < 1e-12);

  // 4. The bucket arithmetic lands on Mondays, which is where Binance opens a
  //    weekly bar. Anchored to 1970-01-05 because the epoch is a Thursday.
  const anyBucket = Math.floor((Date.UTC(2024, 5, 13) / 1000 - MONDAY_EPOCH_S) / WEEK_S);
  ok('week buckets open on Monday 00:00 UTC', new Date(bucketOpenMs(anyBucket)).getUTCDay() === 1);

  console.log('\nself-check passed\n');
}

// ── report ───────────────────────────────────────────────────────────────

function main(): void {
  if (args.includes('--self-check')) {
    selfCheck();
    return;
  }
  void run();
}

async function run(): Promise<void> {
  Logger.overrideLogger(['error', 'warn']);
  const t0 = Date.now();
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const url = process.env.DATABASE_URL ?? '';
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const indicators = new IndicatorsService();

  console.log('\nWEEKLY DIRECTION — does any feature predict next week’s ranking?');
  console.log(`coins      ${COINS.join(', ')}  (USDT perpetuals)`);
  console.log(`from       ${START}\n`);

  const byCoin = new Map<string, Row[]>();
  for (const coin of COINS) {
    const rows = await buildCoin(coin, prisma, indicators, startMs);
    byCoin.set(coin.toUpperCase(), rows);
    console.log(`  ${coin.padEnd(5)} ${String(rows.length).padStart(4)} weeks`);
  }
  await prisma.$disconnect();
  await pool.end();

  const panel = assemble(byCoin);
  const nC = panel.coins.length;

  // Write the panel before any test touches it.
  const cols = ['coin', 'ts', 'close', ...FEATURES, ...FEATURES.map((f) => `rk_${f}`),
    ...HORIZONS.map((h) => `fwd${h}w`), 'back4w'];
  const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(6))) : '');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = [cols.join(',')];
  for (let ti = 0; ti < panel.times.length; ti += 1) {
    for (let ci = 0; ci < nC; ci += 1) {
      const at = ti * nC + ci;
      if (!Number.isFinite(panel.data.get('close')![at])) continue;
      lines.push(
        [panel.coins[ci], new Date(panel.times[ti]).toISOString()]
          .concat(cols.slice(2).map((c) => fmt(panel.data.get(c)![at])))
          .join(','),
      );
    }
  }
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);

  const tests = FEATURES.length * HORIZONS.length;
  const tail = 2 * (1 - normalCdf(BAR));
  console.log(`\npanel      ${panel.times.length} weekly closes x ${nC} coins = ${lines.length - 1} rows`);
  console.log(`            ${new Date(panel.times[0]).toISOString().slice(0, 10)} -> ${new Date(panel.times[panel.times.length - 1]).toISOString().slice(0, 10)}`);
  console.log(`written    ${OUT}`);

  console.log('\n── pre-registered, before any result ──');
  console.log(`features   ${FEATURES.length}  (rank columns are emitted, not re-tested: IC(rank) === IC)`);
  console.log(`horizons   ${HORIZONS.join('w, ')}w`);
  console.log(`tests      ${tests}`);
  console.log(`bar 1      |t| > ${BAR.toFixed(1)}  Newey-West, lag = horizon`);
  console.log(`           expected false passes at that bar: ${(tests * tail).toFixed(2)}`);
  console.log(`bar 2      top-${K}/bottom-${K} long-short must clear ${FEE_BP} bp round trip`);
  console.log(`bar 3      must beat ${SHUFFLES} shuffled controls, interval excluding zero`);
  console.log(`bar 4      |corr| with the 4-week backward return under ${MOMENTUM_BAR.toFixed(2)}`);
  console.log(`interval   ${BLOCK_WEEKS}-week block bootstrap, ${DRAWS} draws, seed ${SEED}`);
  console.log(`gate       weekly rank persistence under ${MAX_PERSIST.toFixed(2)}`);

  // Coverage, so a column that is quietly empty cannot pass as a null result.
  console.log('\n── coverage ──');
  const cells = panel.times.length * nC;
  const present = (c: string): number => {
    let n = 0;
    const a = panel.data.get(c)!;
    for (let i = 0; i < cells; i += 1) if (Number.isFinite(a[i])) n += 1;
    return n;
  };
  const live = present('close');
  for (const f of FEATURES) {
    const p = present(f);
    console.log(`  ${f.padEnd(14)} ${((p / live) * 100).toFixed(1).padStart(6)}%  ${p} / ${live}`);
  }

  const results: Result[] = [];
  for (const f of FEATURES) for (const h of HORIZONS) results.push(measure(panel, f, h));

  const byT = (a: Result, b: Result): number => Math.abs(b.t) - Math.abs(a.t);
  const row = (r: Result): string =>
    `  ${r.feature.padEnd(14)} ${r.horizon}w  IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}  ` +
    `t ${r.t.toFixed(2).padStart(6)}  boot [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  ` +
    `persist ${r.persist.toFixed(2).padStart(5)}  mom ${r.momentum.toFixed(2).padStart(5)}  n ${String(r.n).padStart(3)}`;

  console.log('\n── all tests, by |t| ──');
  [...results].sort(byT).forEach((r) => console.log(row(r)));

  const overBar = results.filter((r) => Number.isFinite(r.t) && Math.abs(r.t) > BAR).sort(byT);
  console.log(`\n── BAR 1: |t| > ${BAR.toFixed(1)} ──`);
  if (overBar.length === 0) console.log('  none');
  else overBar.forEach((r) => console.log(row(r)));

  // Bars 2-4 are run on everything that cleared bar 1, and — so the report
  // always carries a number rather than only a verdict — on the single largest
  // |t| even when it did not clear.
  const best = [...results].sort(byT)[0];
  const priced = overBar.length > 0 ? overBar : [best];
  const header = overBar.length > 0
    ? '\n── BARS 2-4, on everything that cleared bar 1 ──'
    : '\n── BARS 2-4, on the largest |t| even though it did NOT clear bar 1 ──';
  console.log(header);

  const verdicts: Array<{ r: Result; pass: boolean; netBp: number }> = [];
  for (const r of priced) {
    // The sign is taken from the in-sample IC. That is a free parameter fitted
    // on the same data, and it can only FLATTER the result — so a failure here
    // is a real failure, and a pass is an optimistic one.
    const sign = r.ic >= 0 ? 1 : -1;
    const p = price(panel, r.feature, r.horizon, sign);
    const feeFull = FEE_BP;
    const feeMeasured = FEE_BP * p.turnover;
    const netFull = p.grossBp - feeFull;
    const netMeasured = p.grossBp - feeMeasured;
    const boot = blockBootstrapMean(
      p.rows.map((x) => ({ time: x.time, value: x.value - feeFull })),
      BLOCK_WEEKS * 7,
      DRAWS,
      SEED,
    );

    const rng = makeRng(SEED);
    const shuf: number[] = [];
    for (let s = 0; s < SHUFFLES; s += 1) {
      const yp = permuted(panel, r.horizon, rng);
      const q = price(panel, r.feature, r.horizon, sign, yp);
      if (Number.isFinite(q.grossBp)) shuf.push(q.grossBp);
    }
    shuf.sort((a, b) => a - b);
    const sLo = quantile(shuf, 0.025);
    const sHi = quantile(shuf, 0.975);
    const beat = shuf.filter((v) => v >= p.grossBp).length;
    const pval = (beat + 1) / (shuf.length + 1);

    const bar2 = Number.isFinite(netFull) && netFull > 0;
    const bar3 = Number.isFinite(p.grossBp) && p.grossBp > sHi;
    const bar4 = Number.isFinite(r.momentum) && Math.abs(r.momentum) < MOMENTUM_BAR;
    const bar1 = Math.abs(r.t) > BAR;
    const gate = Number.isFinite(r.persist) && Math.abs(r.persist) < MAX_PERSIST;

    console.log(`\n  ${r.feature} @ ${r.horizon}w   sign ${sign > 0 ? 'long-high' : 'long-low'}`);
    console.log(`    IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}   t ${r.t.toFixed(2)}   n ${r.n} weeks   blocks ${r.blocks}`);
    console.log(`    gross            ${p.grossBp.toFixed(2).padStart(8)} bp per ${r.horizon}w hold  (${(p.grossBp / r.horizon).toFixed(2)} bp/week)`);
    console.log(`    turnover         ${(p.turnover * 100).toFixed(1).padStart(8)} % of gross per rebalance`);
    console.log(`    fee, measured    ${feeMeasured.toFixed(2).padStart(8)} bp    net ${netMeasured.toFixed(2)} bp`);
    console.log(`    fee, full ${FEE_BP} bp  ${feeFull.toFixed(2).padStart(8)} bp    net ${netFull.toFixed(2)} bp   95% CI [${boot.lo.toFixed(2)}, ${boot.hi.toFixed(2)}]`);
    console.log(`    shuffled control ${shuf.length} draws, 95% band [${sLo.toFixed(2)}, ${sHi.toFixed(2)}] bp,  p = ${pval.toFixed(4)}`);
    console.log(`    backward-4w corr ${r.momentum.toFixed(3)}`);
    console.log(`    weekly persist   ${r.persist.toFixed(3)}`);
    console.log(
      `    BAR 1 |t|>${BAR.toFixed(1)}  ${bar1 ? 'PASS' : 'FAIL'}` +
      `   BAR 2 pays ${FEE_BP}bp  ${bar2 ? 'PASS' : 'FAIL'}` +
      `   BAR 3 shuffle  ${bar3 ? 'PASS' : 'FAIL'}` +
      `   BAR 4 not momentum  ${bar4 ? 'PASS' : 'FAIL'}` +
      `   persistence gate  ${gate ? 'PASS' : 'FAIL'}`,
    );
    verdicts.push({ r, pass: bar1 && bar2 && bar3 && bar4 && gate, netBp: netFull });
  }

  console.log('\n── VERDICT ──');
  const won = verdicts.filter((v) => v.pass);
  if (won.length === 0) {
    console.log('  No feature passes all four bars.');
    console.log('  WEEKLY DIRECTION IS DEAD ON THIS DATA.');
  } else {
    for (const v of won) {
      console.log(`  ${v.r.feature} @ ${v.r.horizon}w passes all four bars.`);
      console.log(`  net ${v.netBp.toFixed(2)} bp per ${v.r.horizon}-week hold after a full ${FEE_BP} bp round trip.`);
    }
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) main();
