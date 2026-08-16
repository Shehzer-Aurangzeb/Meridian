import { Candle } from '../types/candle.types';

export type ReplayOutcome = 'TARGET_HIT' | 'STOPPED_OUT' | 'OPEN';

/**
 * First candle whose wick reaches the entry price.
 *
 * A resting limit order fills on a touch, so the wick counts — not the close.
 */
export function findFirstFill(
  candles: Candle[],
  action: 'LONG' | 'SHORT',
  entryPrice: number,
): Candle | null {
  for (const c of candles) {
    if (action === 'LONG' && c.low <= entryPrice) return c;
    if (action === 'SHORT' && c.high >= entryPrice) return c;
  }
  return null;
}

/**
 * Steps through the bars after a trade opened; whichever of the stop or the
 * first target price touches first decides the outcome.
 *
 * If one bar covers both, it counts as stopped out. A bar's high and low carry
 * no order, so assuming the target came first would flatter every result.
 */
export function findFirstOutcome(
  candles: Candle[],
  action: 'LONG' | 'SHORT',
  stopLoss: number,
  takeProfit1: number,
): ReplayOutcome {
  for (const c of candles) {
    if (action === 'LONG') {
      if (c.low <= stopLoss) return 'STOPPED_OUT';
      if (c.high >= takeProfit1) return 'TARGET_HIT';
    } else {
      if (c.high >= stopLoss) return 'STOPPED_OUT';
      if (c.low <= takeProfit1) return 'TARGET_HIT';
    }
  }
  return 'OPEN';
}
