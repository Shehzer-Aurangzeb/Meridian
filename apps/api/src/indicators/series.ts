/**
 * Wrappers around the maths library, so the rest of the code can work with
 * whole lists of values instead of feeding it one price at a time.
 *
 * These deliberately return the same NUMBER of values the previous library
 * did. That matters in one place: the "is the market quiet" check compares
 * today's reading against the whole list, so a list that started a few bars
 * earlier would quietly change the answer.
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
