/**
 * Series adapters over `trading-signals`.
 *
 * `trading-signals` is instance-based and streaming (`new RSI(14)`,
 * `.update(v)`), while this codebase consumes whole series. These helpers
 * bridge the two and, critically, normalise WARM-UP LENGTH.
 *
 * ─── INVARIANT: warm-up length is load-bearing ───────────────────────────
 * Trailing reads (`series[length-1]`, `[length-2]`, `[length-3]`) do not
 * care how many leading values exist. But `bandWidthSeries` is consumed
 * WHOLE by the regime classifier:
 *
 *     historical = bandWidthSeries.slice(0, -1)
 *     percentileRank(bandWidth, historical)      // denominator = length
 *     sorted[idx] where idx derives from length   // 15th-pct cutoff
 *
 * So a change in leading count silently shifts the COMPRESSION decision.
 * It is the only whole-series consumer in the codebase — `rsiHistory` looks
 * like the same hazard but takes `rsiSeries.slice(-100)`, a trailing slice,
 * which is immune. Audited 4 Aug 2026. If you add another whole-series
 * consumer, it inherits this dependency.
 *
 * Therefore every adapter here emits EXACTLY the number of values the
 * previous library (`technicalindicators@3.1.0`) emitted, trimming leading
 * values where the new library starts earlier.
 *
 * ─── Seeding decision (recorded, not silent) ─────────────────────────────
 * `technicalindicators` seeded EMA with an SMA of the first `period` values;
 * `trading-signals` seeds with the first price. We accept the new seeding
 * and trim, because the seed's influence decays geometrically at
 * (1 - 2/(period+1)) per bar. EMA is used in exactly one place — smoothing
 * RSI for QQE at period 5 — so the decay factor is (1 - 2/6) = 0.667, and
 * over our 250+ candle windows the residual is 0.667^200 ~= 1e-35. The
 * trimmed-away values are the only ones where seeding is observable, and
 * they are warm-up, not information.
 *
 * ATR, ADX and RSI need no such decision: both libraries use Wilder's
 * `1/period` recursion seeded with an SMA. ADX looks different — the old
 * library smoothed +DM/-DM/TR as running SUMS, the new one as AVERAGES —
 * but S_t = N * A_t exactly, and DI is the ratio smoothed(DM)/smoothed(TR),
 * so the factor cancels. Bollinger uses population SD (/N) in both.
 */
import { ADX, ATR, BollingerBands, EMA, RSI } from 'trading-signals';

import { BollingerBandsResult } from './interfaces/indicator.types';

/**
 * Keep the last `legacyLength` values so leading count matches the previous
 * library. If the new library produces FEWER than the legacy count we cannot
 * fabricate one, so the shortfall is returned as-is — `indicator-fixture.ts`
 * reports any length delta rather than letting it pass unnoticed.
 */
function trimTo<T>(values: T[], legacyLength: number): T[] {
  return values.length > legacyLength ? values.slice(-legacyLength) : values;
}

/** Legacy emitted counts, from `technicalindicators@3.1.0`. */
const legacy = {
  rsi: (n: number, period: number) => n - period,
  bollinger: (n: number, period: number) => n - period + 1,
  ema: (n: number, period: number) => n - period + 1,
};

export function rsiSeries(closes: number[], period = 14): number[] {
  const rsi = new RSI(period);
  const out: number[] = [];
  for (const c of closes) {
    const v = rsi.update(c, false);
    if (v !== null) out.push(v);
  }
  return trimTo(out, legacy.rsi(closes.length, period));
}

export function emaSeries(values: number[], period: number): number[] {
  const ema = new EMA(period);
  const out: number[] = [];
  for (const v of values) {
    const r = ema.update(v, false);
    if (r !== null) out.push(r);
  }
  return trimTo(out, legacy.ema(values.length, period));
}

export function bollingerSeries(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerBandsResult[] {
  const bb = new BollingerBands(period, stdDev);
  const out: BollingerBandsResult[] = [];
  for (const c of closes) {
    const r = bb.update(c, false);
    if (r !== null) {
      out.push({ upper: r.upper, middle: r.middle, lower: r.lower });
    }
  }
  return trimTo(out, legacy.bollinger(closes.length, period));
}

/** Latest ATR. Only the final value is consumed anywhere. */
export function atrLatest(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  const atr = new ATR(period);
  let last: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const v = atr.update({ high: highs[i], low: lows[i], close: closes[i] }, false);
    if (v !== null) last = v;
  }
  if (last === null) throw new Error('ATR produced no value');
  return last;
}

/** Latest ADX with its DI components. Only the final values are consumed. */
export function adxLatest(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): { adx: number; pdi: number; mdi: number } {
  const adx = new ADX(period);
  let last: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const v = adx.update({ high: highs[i], low: lows[i], close: closes[i] }, false);
    if (v !== null) last = v;
  }
  if (last === null || adx.pdi === undefined || adx.mdi === undefined) {
    throw new Error('ADX produced no value');
  }
  // trading-signals returns DI as a ratio; the previous library returned it
  // scaled to 0-100, and every downstream consumer expects that scale.
  return { adx: last, pdi: Number(adx.pdi) * 100, mdi: Number(adx.mdi) * 100 };
}
