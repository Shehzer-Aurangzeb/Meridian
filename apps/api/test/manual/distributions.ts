/**
 * Raw distributions of the values each condition tests.
 *
 *   npx ts-node test/manual/distributions.ts 1d --coins BTC,ETH,... --limit 1200
 *
 * ─── The question ────────────────────────────────────────────────────────
 * `conditions.ts` showed RSI passing 0.1%, Bollinger 0.2% and S/R 0.8%, with
 * zero bars ever reaching 4-of-5. Those three are not independent tests —
 * oversold RSI, price at the lower band, and price at support are three
 * descriptions of ONE event, a dip. They should correlate and co-occur.
 * Pass rates that low which never coincide mean at least one is not
 * measuring what it claims.
 *
 * So this dumps the UNDERLYING values with no condition logic applied:
 *   - RSI, and how often it is <= 40 / >= 60 regardless of direction
 *   - the RSI z-score, which was once computed against the PRICE series
 *     (giving ~-66) and whose thresholds were calibrated during that period
 *   - distance to each Bollinger band as a % of band range, and bandwidth
 *     against the 2% squeeze floor that rejects before proximity is measured
 *   - distance to the nearest level as a % of price, and its type
 *   - pairwise co-occurrence of the three raw dip signatures
 *
 * If the values are normal and the thresholds reject them anyway, the
 * thresholds are wrong. If the values are themselves implausible, there is
 * another wiring bug.
 *
 * Changes nothing. Reports only.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { Timeframe } from '../../src/common/constants/timeframes';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import {
  BB_THRESHOLDS,
  RSI_ENTRY_THRESHOLDS,
  RSI_ZSCORE_CONFIG,
  SR_THRESHOLDS,
} from '../../src/analysis/interfaces/checklist.types';
import { TimeInterval } from '../../src/common/types/candle.types';

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const [, , tfArg, ...rest] = process.argv;
const timeframe = (tfArg ?? '1d') as TimeInterval;
const ci = rest.indexOf('--coins');
const COINS =
  ci >= 0 && rest[ci + 1] ? rest[ci + 1].split(',').map((c) => c.trim().toUpperCase()) : ['BTC'];
const li = rest.indexOf('--limit');
const LIMIT = li >= 0 && rest[li + 1] ? Number(rest[li + 1]) : 1200;

const rsis: number[] = [];
const zs: number[] = [];
const bbProxLower: number[] = [];
const bandWidths: number[] = [];
const levelDist: number[] = [];
const levelIsSupport: boolean[] = [];
// Raw dip signatures, direction-free.
let oversold = 0;
let atLowerBand = 0;
let nearLevel = 0;
let oversoldAndLower = 0;
let oversoldAndLevel = 0;
let lowerAndLevel = 0;
let allThree = 0;
let bars = 0;
// At bars where ALL THREE raw dip signatures are true, evaluate the checklist
// as a LONG — the correct side for a dip — and tally why each condition still
// fails. This is the decisive measurement: a real dip, evaluated on the right
// side, with the condition's own stated reason for rejecting it.
const dipFailReasons = new Map<string, Map<string, number>>();
let dipBarsChecked = 0;
let dipMetCounts = Array(6).fill(0);

function quantiles(xs: number[], label: string) {
  if (xs.length === 0) return { series: label, n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    series: label,
    n: s.length,
    min: q(0).toFixed(2),
    p5: q(0.05).toFixed(2),
    p25: q(0.25).toFixed(2),
    median: q(0.5).toFixed(2),
    p75: q(0.75).toFixed(2),
    p95: q(0.95).toFixed(2),
    max: q(0.999).toFixed(2),
  };
}

async function run(coin: string) {
  const indicators = new IndicatorsService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const sr = new SupportResistanceService(binance);
  const regimeSvc = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    regimeSvc,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
    new SupportResistanceService(binance),
  );
  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) return;

  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    const ctx = indicators.buildContext(coin, timeframe, window);
    const price = ctx.closes[ctx.closes.length - 1];
    bars++;

    // ── RSI and its z-score, exactly as the condition computes them ──
    rsis.push(ctx.rsi);
    const hist = ctx.rsiHistory.slice(-RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD);
    if (hist.length >= RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD) {
      const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
      const sd = Math.sqrt(
        hist.reduce((a, v) => a + (v - mean) ** 2, 0) / hist.length,
      );
      zs.push(sd === 0 ? 0 : (ctx.rsi - mean) / sd);
    }

    // ── Bollinger: proximity to the LOWER band, and the squeeze floor ──
    const { upper, lower } = ctx.bollingerBands;
    const range = upper - lower;
    if (range > 0) bbProxLower.push(((price - lower) / range) * 100);
    bandWidths.push(ctx.bandWidth);

    // ── nearest level, from the engine the condition actually uses ────
    const levels = sr.levelsFromCandles(
      [...ctx.candles],
      ctx.timeframe as Timeframe,
      price,
    );
    const nearest = levels.length
      ? levels.reduce((best, l) =>
          Math.abs(l.distancePercent) < Math.abs(best.distancePercent) ? l : best,
        )
      : null;
    const dist = nearest ? (Math.abs(nearest.price - price) / price) * 100 : NaN;
    if (nearest) {
      levelDist.push(dist);
      levelIsSupport.push(nearest.type === 'support');
    }

    // ── the three raw dip signatures, direction-free ──────────────────
    const isOversold = ctx.rsi <= RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX;
    const isAtLower =
      range > 0 && ((price - lower) / range) * 100 <= BB_THRESHOLDS.PROXIMITY_PERCENT;
    const isNearLevel = nearest !== null && dist <= SR_THRESHOLDS.STRONG_PROXIMITY_PERCENT;

    if (isOversold) oversold++;
    if (isAtLower) atLowerBand++;
    if (isNearLevel) nearLevel++;
    if (isOversold && isAtLower) oversoldAndLower++;
    if (isOversold && isNearLevel) oversoldAndLevel++;
    if (isAtLower && isNearLevel) lowerAndLevel++;
    if (isOversold && isAtLower && isNearLevel) {
      allThree++;

      const regime = regimeSvc.classifyFromContext(ctx);
      const asLong = coordinator.routeFromRegime(ctx, timeframe, regime, 'long');
      if (asLong.checklistResult) {
        dipBarsChecked++;
        dipMetCounts[asLong.checklistResult.conditionsMet]++;
        for (const c of asLong.checklistResult.conditions) {
          if (c.passed) continue;
          const byName = dipFailReasons.get(c.name) ?? new Map<string, number>();
          // Collapse the variable numbers out of the reason so it buckets.
          const key = c.reason.replace(/-?\d+(\.\d+)?/g, 'N');
          byName.set(key, (byName.get(key) ?? 0) + 1);
          dipFailReasons.set(c.name, byName);
        }
      }
    }
  }
}

const pct = (n: number) => `${((n / bars) * 100).toFixed(1)}%`;

async function main() {
  for (const c of COINS) await run(c);

  console.log(`\n${COINS.length} coin(s) · ${timeframe} · ${bars} bars\n`);

  console.log('── raw value distributions ' + '─'.repeat(35));
  console.table([
    quantiles(rsis, 'RSI(14)'),
    quantiles(zs, 'RSI z-score (vs 100 RSI values)'),
    quantiles(bbProxLower, '% of band range above LOWER band'),
    quantiles(bandWidths, 'BB bandwidth %'),
    quantiles(levelDist, '% distance to nearest level'),
  ]);

  console.log('── how often each RAW signature is true (no direction) ' + '─'.repeat(7));
  console.table([
    {
      signature: `RSI <= ${RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX}`,
      bars: oversold,
      pct: pct(oversold),
    },
    {
      signature: `RSI >= ${RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN}`,
      bars: rsis.filter((r) => r >= RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN).length,
      pct: pct(rsis.filter((r) => r >= RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN).length),
    },
    {
      signature: `z <= ${RSI_ENTRY_THRESHOLDS.LONG.ZSCORE_THRESHOLD}`,
      bars: zs.filter((z) => z <= RSI_ENTRY_THRESHOLDS.LONG.ZSCORE_THRESHOLD).length,
      pct: pct(zs.filter((z) => z <= RSI_ENTRY_THRESHOLDS.LONG.ZSCORE_THRESHOLD).length),
    },
    {
      signature: `within ${BB_THRESHOLDS.PROXIMITY_PERCENT}% of LOWER band`,
      bars: atLowerBand,
      pct: pct(atLowerBand),
    },
    {
      signature: `bandwidth >= ${BB_THRESHOLDS.MIN_BAND_WIDTH}% (squeeze floor)`,
      bars: bandWidths.filter((b) => b >= BB_THRESHOLDS.MIN_BAND_WIDTH).length,
      pct: pct(bandWidths.filter((b) => b >= BB_THRESHOLDS.MIN_BAND_WIDTH).length),
    },
    {
      signature: `level within ${SR_THRESHOLDS.STRONG_PROXIMITY_PERCENT}%`,
      bars: nearLevel,
      pct: pct(nearLevel),
    },
    {
      signature: 'nearest level is SUPPORT',
      bars: levelIsSupport.filter(Boolean).length,
      pct: pct(levelIsSupport.filter(Boolean).length),
    },
  ]);

  console.log('── do the three dip signatures co-occur? ' + '─'.repeat(22));
  console.table([
    { pair: 'oversold + at lower band', bars: oversoldAndLower, pct: pct(oversoldAndLower) },
    { pair: 'oversold + near level', bars: oversoldAndLevel, pct: pct(oversoldAndLevel) },
    { pair: 'at lower band + near level', bars: lowerAndLevel, pct: pct(lowerAndLevel) },
    { pair: 'ALL THREE', bars: allThree, pct: pct(allThree) },
  ]);
  console.log(
    '  These are direction-free: they ask only whether the market is AT a dip,\n' +
      '  not whether the checklist would call it one.',
  );

  console.log(
    `\n── at a REAL dip (all three true), evaluated as LONG: ${dipBarsChecked} bars ` +
      '─'.repeat(4),
  );
  console.table(
    dipMetCounts.map((n, i) => ({
      conditionsMet: `${i}/5`,
      bars: n,
      pct: dipBarsChecked ? `${((n / dipBarsChecked) * 100).toFixed(1)}%` : '—',
    })),
  );

  console.log('── why each condition STILL fails at a real dip ' + '─'.repeat(15));
  for (const [name, reasons] of dipFailReasons) {
    const total = [...reasons.values()].reduce((a, b) => a + b, 0);
    console.log(`\n  ${name} — failed ${total}/${dipBarsChecked}`);
    console.table(
      [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, n]) => ({
          reason: reason.slice(0, 78),
          bars: n,
          pct: `${((n / dipBarsChecked) * 100).toFixed(1)}%`,
        })),
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
