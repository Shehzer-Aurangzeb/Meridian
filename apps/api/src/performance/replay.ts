import { Candle } from '../common/types/candle.types';

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
 * Walk post-fill candles in order; the first wick to touch SL or TP1 wins.
 *
 * When one candle straddles both levels it counts as `STOPPED_OUT`. OHLC
 * carries no intra-candle ordering, so the pessimistic branch is the only
 * honest one — assuming the target filled first would flatter every result.
 *
 * Extracted from PerformanceService so the journal can replay a plan the user
 * actually took without a database: this is pure, and the DB path was the only
 * reason it was unreachable.
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
