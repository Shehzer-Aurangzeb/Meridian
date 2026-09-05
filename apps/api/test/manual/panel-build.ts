/**
 * Phase A — build the feature panel.
 *
 *   pnpm --filter api panel-build --coins BTC,ETH --bars 32000
 *
 * ─── What this is ────────────────────────────────────────────────────────
 * One table. Rows are `(coin, 1h bar close)`. Columns are every feature the
 * analyst already computes — RSI, ADX, %B, bandwidth percentile, QQE, distance
 * to the nearest level — plus the ten flow metrics in `FlowSample`. Targets are
 * forward log returns at 4h, 12h, 24h and 72h.
 *
 * There are no fills, no stops, no ladder and no cooldown. RESEARCH_PLAN §2.1
 * is the reason: every confound measured in Part 1 came from the trade geometry
 * sitting between a feature and its outcome, and none of them were about
 * whether the feature predicts anything. This file removes the geometry so
 * Phase B can ask that question directly.
 *
 * ─── Look-ahead ──────────────────────────────────────────────────────────
 * Three guards, and every one of them has already caught a real leak here:
 *
 *  - `completedAsOf` for candles. A bar still forming holds the future.
 *  - `flowAsOf` for flow rows. Binance serves a print after it stamps it.
 *  - the decision bar's own CLOSE is the `asOf`, and forward returns start
 *    from that same close. Nothing is read at a price it could not be read at.
 *
 * The flow join walks a pointer instead of calling `flowAsOf` per bar, because
 * `flowAsOf` filters the whole array and there are 3.2 million flow rows per
 * coin. The pointer uses the identical predicate, and `panel-build.spec.ts`
 * asserts the two agree — the speed is not allowed to change the answer.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { Cache } from 'cache-manager';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { LEVEL_TIMEFRAMES } from '../../src/analysis/services/level-map.service';
import { CANDLE_LIMITS, Timeframe } from '../../src/common/constants/timeframes';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { completedAsOf, FLOW_EMBARGO_MS, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';

const store = new Map<string, unknown>();
const cache = {
  get: <T>(k: string) => Promise.resolve(store.get(k) as T | undefined),
  set: (k: string, v: unknown) => {
    store.set(k, v);
    return Promise.resolve();
  },
  del: (k: string) => {
    store.delete(k);
    return Promise.resolve();
  },
} as unknown as Cache;

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const BARS = num('bars', 32_000); // 1h decision bars per coin
const STEP = num('step', 1);
const OUT = str('out', 'test/manual/results/panel.csv');

/** Indicator context window. 400 keeps the bandwidth percentile above 200 samples. */
const CTX = 400;
/** Horizons, in 1h bars. The longest one also sets the right-edge reserve. */
const HORIZONS = [4, 12, 24, 72];
const MAX_HORIZON = Math.max(...HORIZONS);
/** Barrier width, in ATRs, for the triple-barrier label. */
const BARRIER_ATR = num('barrier-atr', 1);
/** Trailing window for every flow z-score. Time, not sample count: the metrics
 *  are published at 5m, 1h and 8h, and a fixed sample count would mean 24 hours
 *  for one and three months for another. */
const Z_WINDOW_MS = 7 * 24 * 3_600_000;

const FLOW_METRICS = [
  'openInterest',
  'longShortRatio',
  'takerBuySellRatio5m',
  'topTraderAccountRatio',
  'topTraderPositionRatio',
  'premium',
  'fundingRate',
  'bookImbalanceFar',
  'bookImbalanceNear',
  'bookDepthNotional',
] as const;

/**
 * Venue series loaded but never emitted raw.
 *
 * `okxClose` on its own is a price: non-stationary, and cross-sectionally it is
 * a coin label rather than a signal — the Phase B persistence gate would drop it
 * on sight. What carries information is the GAP between venues, so these are
 * loaded to build the derived columns below and nothing else.
 *
 * OKX supplies price only. Its funding history is ~3 months and its open
 * interest is ~1 month, and the open-interest endpoint ignores `begin` on its
 * own and hands back today's rows whatever window is asked for.
 */
/**
 * Venue rows carry NO publication embargo, and that is not a relaxation.
 *
 * `FLOW_EMBARGO_MS` models the delay between Binance stamping a
 * `/futures/data/` reading and serving it. A bar close has no such delay: it is
 * known at the close, which is the same instant the panel already reads
 * Binance's own `close` at.
 *
 * Applying the 5-minute embargo here was a real bug and it is worth keeping the
 * symptom. Venue rows are stamped at bar close, which IS `asOf`, so
 * `ts + 5min <= asOf` was false and the cursor fell back to the PREVIOUS hour.
 * The panel then compared Binance at T against OKX at T-1h, and the resulting
 * "spread" was the one-hour return wearing a different name: correlation 0.995
 * with |1h return|, and a mean magnitude of 51.3 bp against the return's 51.1.
 *
 * It would not have looked like a bug in a result table. It would have looked
 * like a strong, stable, brand-new signal.
 */
const VENUE_EMBARGO_MS = 0;

const VENUE_METRICS = [
  'okxClose',
  'bybitClose',
  'bybitOpenInterest',
  'bybitFundingRate',
] as const;

/** One metric's history for one coin, ascending by ts, split for tight memory. */
export interface Series {
  ts: Float64Array;
  value: Float64Array;
}

/**
 * A cursor over one metric, walked forward as the decision bar advances.
 *
 * `hi` is the count of rows published by `asOf` — the same predicate `flowAsOf`
 * applies, `ts + embargo <= asOf`. `lo` is the start of the z-score window.
 * Running sums make the z-score O(1) per bar instead of O(window).
 */
export class FlowCursor {
  private hi = 0;
  private lo = 0;
  private sum = 0;
  private sumsq = 0;

  constructor(
    private readonly s: Series,
    private readonly embargoMs: number = FLOW_EMBARGO_MS,
    private readonly windowMs: number = Z_WINDOW_MS,
  ) {}

  /** Advance to `asOfMs`. Must be called with non-decreasing `asOfMs`. */
  advance(asOfMs: number): void {
    while (this.hi < this.s.ts.length && this.s.ts[this.hi] + this.embargoMs <= asOfMs) {
      const v = this.s.value[this.hi];
      this.sum += v;
      this.sumsq += v * v;
      this.hi += 1;
    }
    while (this.lo < this.hi && this.s.ts[this.lo] < asOfMs - this.windowMs) {
      const v = this.s.value[this.lo];
      this.sum -= v;
      this.sumsq -= v * v;
      this.lo += 1;
    }
  }

  /** The newest published reading, or NaN when nothing has been published yet. */
  last(): number {
    return this.hi === 0 ? NaN : this.s.value[this.hi - 1];
  }

  /** How stale that reading is, in minutes. NaN when there is none. */
  ageMinutes(asOfMs: number): number {
    return this.hi === 0 ? NaN : (asOfMs - this.s.ts[this.hi - 1]) / 60_000;
  }

  /**
   * The newest reading in units of its own trailing week.
   *
   * Two samples is the floor: a standard deviation of one point is zero, and
   * dividing by it manufactures an infinite signal out of a single print.
   */
  z(): number {
    const n = this.hi - this.lo;
    if (n < 2) return NaN;
    const mean = this.sum / n;
    const varr = Math.max(this.sumsq / n - mean * mean, 0);
    const sd = Math.sqrt(varr);
    return sd === 0 ? NaN : (this.last() - mean) / sd;
  }
}

/**
 * Triple-barrier label: did price rise by `k` ATRs before it fell by `k`?
 *
 * Phases B and C predicted the raw forward return and scored its mean. Crypto
 * returns are fat-tailed, so that mean is set by a handful of hours and a
 * squared-error model spends most of its capacity fitting how VOLATILE a coin
 * is rather than which way it goes. A barrier label asks the smaller question a
 * model can actually learn, and asks it in units of the coin's own volatility.
 *
 * Returns +1 up first, -1 down first, 0 if neither barrier is touched.
 *
 * When one bar touches both barriers, OHLC does not record which came first.
 * The bar's own close decides, which uses only information inside that bar and
 * is deterministic. Dropping those rows instead would quietly delete the most
 * volatile hours, which is a worse bias than the one it avoids.
 */
export function tripleBarrier(
  forward: Candle[],
  entry: number,
  widthPct: number,
): number {
  const up = entry * (1 + widthPct);
  const down = entry * (1 - widthPct);
  for (const c of forward) {
    const hitUp = c.high >= up;
    const hitDown = c.low <= down;
    if (hitUp && hitDown) return c.close >= entry ? 1 : -1;
    if (hitUp) return 1;
    if (hitDown) return -1;
  }
  return 0;
}

/** Percent distance from `price` to the nearest level on a side, and its shape. */
export function nearest(
  levels: Array<{ price: number; type: string; touchCount: number; held: boolean }>,
  price: number,
  type: 'support' | 'resistance',
): { distPct: number; touches: number; held: number } {
  let best: (typeof levels)[number] | null = null;
  for (const l of levels) {
    if (l.type !== type) continue;
    if (best === null || Math.abs(l.price - price) < Math.abs(best.price - price)) best = l;
  }
  if (best === null) return { distPct: NaN, touches: NaN, held: NaN };
  // Signed: a support above spot and a resistance below it are both real and
  // both meaningful, and an absolute value would fold them onto each other.
  return {
    distPct: ((best.price - price) / price) * 100,
    touches: best.touchCount,
    held: best.held ? 1 : 0,
  };
}

/**
 * The five cross-venue readings, from three prices, two funding rates and two
 * open interests.
 *
 * These are the only columns in the panel that are not Binance-only, which is
 * the entire reason they exist: Phases B through D measured the Binance feature
 * set at roughly a third of a retail fee, with a gross that goes negative over
 * 3.1 years, so what is needed is a different phenomenon rather than a better
 * fit to the same one.
 *
 * Spreads are in basis points so a $80,000 coin and a $0.50 coin are on the
 * same scale — a raw price difference would rank the ten coins by their price
 * and nothing else, which is the static-tilt trap the Phase B persistence gate
 * exists to catch.
 *
 * Open-interest share is built from NOTIONAL on both sides, not from the raw
 * figures. Both venues report open interest in base units, and each is
 * multiplied by ITS OWN price — a coin trading a few basis points apart across
 * venues barely moves the share, but using one venue's price for both would
 * fold the price spread into a leverage measurement. `openInterestValue` is not
 * used because it is deliberately absent from the panel: it is open interest
 * times price and every consumer already holds the price.
 *
 * Every input can be NaN — a venue can be missing an hour, and OKX has real
 * gaps — so each output is guarded independently rather than the whole row
 * being dropped. One missing venue must not delete the readings the others
 * still support.
 */
export function crossVenue(
  binancePx: number,
  okxPx: number,
  bybitPx: number,
  binanceFunding: number,
  bybitFunding: number,
  binanceOi: number,
  bybitOi: number,
): number[] {
  const bp = (a: number, b: number): number =>
    Number.isFinite(a) && Number.isFinite(b) && b > 0 ? ((a - b) / b) * 1e4 : NaN;

  const spreadOkx = bp(okxPx, binancePx);
  const spreadBybit = bp(bybitPx, binancePx);

  // Population sd across the venues that reported, in bp of the mean. Two
  // venues is enough for a dispersion; one is not.
  const pxs = [binancePx, okxPx, bybitPx].filter((x) => Number.isFinite(x) && x > 0);
  let dispersion = NaN;
  if (pxs.length >= 2) {
    const mu = pxs.reduce((a, x) => a + x, 0) / pxs.length;
    const varr = pxs.reduce((a, x) => a + (x - mu) ** 2, 0) / pxs.length;
    dispersion = (Math.sqrt(varr) / mu) * 1e4;
  }

  const fundSpread =
    Number.isFinite(bybitFunding) && Number.isFinite(binanceFunding)
      ? bybitFunding - binanceFunding
      : NaN;

  const bybitNotional = bybitOi * bybitPx;
  const binanceNotional = binanceOi * binancePx;
  const total = binanceNotional + bybitNotional;
  const oiShare =
    Number.isFinite(total) && total > 0 && Number.isFinite(bybitNotional)
      ? bybitNotional / total
      : NaN;

  return [spreadOkx, spreadBybit, dispersion, fundSpread, oiShare];
}

const COLUMNS = [
  'coin',
  'ts',
  'close',
  'rsi',
  'adx',
  'pdi',
  'mdi',
  'atrPct',
  'percentB',
  'bandWidth',
  'bandWidthPct',
  'qqe',
  'qqeUp',
  ...LEVEL_TIMEFRAMES.flatMap((tf) => [
    `sup_${tf}_distPct`,
    `sup_${tf}_touches`,
    `sup_${tf}_held`,
    `res_${tf}_distPct`,
    `res_${tf}_touches`,
    `res_${tf}_held`,
  ]),
  ...FLOW_METRICS.flatMap((m) => [m, `${m}_z`, `${m}_ageMin`]),
  // Cross-venue. Everything above this line is Binance-only.
  'pxSpreadOkxBp',
  'pxSpreadBybitBp',
  'pxDispersionBp',
  'fundSpreadBybit',
  'oiShareBybit',
  ...HORIZONS.map((h) => `fwd${h}h`),
  // The forward move in units of the coin's own volatility, so a 2% move in a
  // quiet coin and a 2% move in a wild one stop being the same observation.
  ...HORIZONS.map((h) => `fwdVol${h}h`),
  ...HORIZONS.map((h) => `tb${h}h`),
];

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(6))) : '');

async function loadFlow(prisma: PrismaClient, coin: string): Promise<Map<string, Series>> {
  const out = new Map<string, Series>();
  for (const metric of [...FLOW_METRICS, ...VENUE_METRICS]) {
    // Raw SQL: Prisma materialises 500k objects per metric otherwise, and this
    // runs ten times per coin.
    const rows = await prisma.$queryRawUnsafe<Array<{ ts: Date; value: number }>>(
      'SELECT ts, value FROM "FlowSample" WHERE symbol = $1 AND metric = $2 ORDER BY ts ASC',
      coin.toUpperCase(),
      metric,
    );
    const ts = new Float64Array(rows.length);
    const value = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i += 1) {
      ts[i] = rows[i].ts.getTime();
      value[i] = rows[i].value;
    }
    out.set(metric, { ts, value });
  }
  return out;
}

async function runCoin(
  coin: string,
  prisma: PrismaClient,
  write: (line: string) => void,
): Promise<number> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();
  const sr = new SupportResistanceService();

  // Each level timeframe needs its own live window PLUS the replay span, so the
  // oldest decision bar sees exactly what a live call would have seen.
  const series = new Map<Timeframe, Candle[]>();
  for (const tf of LEVEL_TIMEFRAMES) {
    const span = Math.ceil((BARS * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[tf]);
    // The 1h series carries two warm-ups, not one: the level map wants
    // CANDLE_LIMITS bars and `buildContext` wants CTX, and CTX is the larger.
    // Fetching only CANDLE_LIMITS silently ate the first 200 decision bars.
    const warmup = tf === '1h' ? Math.max(CANDLE_LIMITS[tf], CTX) : CANDLE_LIMITS[tf];
    // Plus the right-edge reserve, so `--bars 600` yields 600 rows rather than
    // 600 minus whatever the longest forward return costs.
    const reserve = Math.ceil((MAX_HORIZON * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[tf]);
    series.set(tf, await binance.getCandlesPaged(coin, tf as TimeInterval, warmup + span + reserve + 5));
  }
  const h1 = series.get('1h') ?? [];

  // The right edge. A bar cannot be a row unless its longest forward return
  // exists, and the final candle is still forming.
  const last = h1.length - 2 - MAX_HORIZON;
  const first = Math.max(CTX, last - BARS + 1);
  if (last < first) {
    throw new Error(
      `${coin}: ${h1.length} 1h candles is too few — ${CTX} are needed for the ` +
        `indicator window and ${MAX_HORIZON + 1} more must be reserved so the ` +
        `last row has a 72h forward return.`,
    );
  }

  const flow = await loadFlow(prisma, coin);
  const cursors = new Map(
    [...FLOW_METRICS, ...VENUE_METRICS].map((m) => {
      const series = flow.get(m) ?? { ts: new Float64Array(), value: new Float64Array() };
      const isVenue = (VENUE_METRICS as readonly string[]).includes(m);
      return [m, new FlowCursor(series, isVenue ? VENUE_EMBARGO_MS : undefined)] as const;
    }),
  );

  // Levels only move when a bar on their own timeframe closes. Recomputing them
  // every hour would be 96,000 calls a coin to get 43,000 distinct answers.
  const levelCache = new Map<Timeframe, { key: number; levels: ReturnType<SupportResistanceService['levelsFromCandles']> }>();

  let rows = 0;
  for (let i = first; i <= last; i += STEP) {
    const bar = h1[i];
    const asOf = bar.time.getTime() + TIMEFRAME_MS['1h']; // the bar's CLOSE
    const price = bar.close;

    const ctx = indicators.buildContext(coin, '1h', h1.slice(i - CTX + 1, i + 1));
    const { upper, lower } = ctx.bollingerBands;
    const percentB = upper === lower ? NaN : (price - lower) / (upper - lower);
    const bandWidthPct = indicators.percentileRank(ctx.bandWidth, [...ctx.bandWidthSeries]);

    const levelCols: number[] = [];
    for (const tf of LEVEL_TIMEFRAMES) {
      const all = series.get(tf) ?? [];
      const key = Math.floor(asOf / TIMEFRAME_MS[tf]);
      let hit = levelCache.get(tf);
      if (!hit || hit.key !== key) {
        // A bounded tail, not the whole series: `completedAsOf` filters what it
        // is handed, and handing it 40,000 candles 32,000 times is quadratic.
        // The tail is longer than any `limit`, so the answer is identical.
        const need = CANDLE_LIMITS[tf];
        const cut = all.findIndex((c) => c.time.getTime() + TIMEFRAME_MS[tf] > asOf);
        const end = cut < 0 ? all.length : cut;
        const done = completedAsOf(all.slice(Math.max(0, end - need - 5), end + 2), TIMEFRAME_MS[tf], asOf, need);
        hit = { key, levels: done.length >= 20 ? sr.levelsFromCandles(done, tf, price) : [] };
        levelCache.set(tf, hit);
      }
      const s = nearest(hit.levels, price, 'support');
      const r = nearest(hit.levels, price, 'resistance');
      levelCols.push(s.distPct, s.touches, s.held, r.distPct, r.touches, r.held);
    }

    const flowCols: number[] = [];
    for (const m of FLOW_METRICS) {
      const c = cursors.get(m)!;
      c.advance(asOf);
      flowCols.push(c.last(), c.z(), c.ageMinutes(asOf));
    }
    for (const m of VENUE_METRICS) cursors.get(m)!.advance(asOf);
    const venueCols = crossVenue(
      price,
      cursors.get('okxClose')!.last(),
      cursors.get('bybitClose')!.last(),
      cursors.get('fundingRate')!.last(),
      cursors.get('bybitFundingRate')!.last(),
      cursors.get('openInterest')!.last(),
      cursors.get('bybitOpenInterest')!.last(),
    );

    // Log returns, so horizons are additive and a +10% and a −10% are symmetric.
    const targets = HORIZONS.map((h) => Math.log(h1[i + h].close / price));
    const atrFrac = ctx.atr / price;
    const volTargets = targets.map((r) => (atrFrac > 0 ? r / atrFrac : NaN));
    const barriers = HORIZONS.map((h) =>
      atrFrac > 0 ? tripleBarrier(h1.slice(i + 1, i + h + 1), price, BARRIER_ATR * atrFrac) : NaN,
    );

    write(
      [
        coin,
        new Date(asOf).toISOString(),
        fmt(price),
        fmt(ctx.rsi),
        fmt(ctx.adx.adx),
        fmt(ctx.adx.pdi),
        fmt(ctx.adx.mdi),
        fmt((ctx.atr / price) * 100),
        fmt(percentB),
        fmt(ctx.bandWidth),
        fmt(bandWidthPct),
        fmt(ctx.qqe.value),
        ctx.qqe.color === 'green' ? '1' : ctx.qqe.color === 'red' ? '0' : '',
        ...levelCols.map(fmt),
        ...flowCols.map(fmt),
        ...venueCols.map(fmt),
        ...targets.map(fmt),
        ...volTargets.map(fmt),
        ...barriers.map(fmt),
      ].join(','),
    );
    rows += 1;
  }
  return rows;
}

async function main(): Promise<void> {
  // The level detector debug-logs its swing count on every call, and this
  // makes ~43,000 of those per coin.
  Logger.overrideLogger(['error', 'warn']);
  const url = process.env.DATABASE_URL ?? '';
  console.log(`\nPANEL BUILD — ${COINS.length} coins x ${BARS} bars, step ${STEP}`);
  console.log(`target: ${url.replace(/:\/\/[^@]*@/, '://***@')}`);
  console.log(`out:    ${OUT}\n`);

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT);
  out.write(`${COLUMNS.join(',')}\n`);
  const write = (line: string): void => {
    out.write(`${line}\n`);
  };

  const t0 = Date.now();
  let total = 0;
  for (const coin of COINS) {
    const n = await runCoin(coin, prisma, write);
    total += n;
    console.log(`  ${coin.padEnd(5)} ${n.toLocaleString().padStart(8)} rows  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await new Promise<void>((res) => out.end(res));
  console.log(`\n${total.toLocaleString()} rows x ${COLUMNS.length} columns in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
