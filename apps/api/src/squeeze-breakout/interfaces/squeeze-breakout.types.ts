/**
 * Squeeze Breakout strategy setup.
 *
 * Produced by SqueezeBreakoutService for assets the MarketRegimeService
 * has flagged as `COMPRESSION`. Defines the two "line in the sand"
 * price levels and the volume baseline used to confirm a breakout.
 */
export interface SqueezeBreakoutSetup {
  symbol: string;
  timeframe: string;

  /** Highest High of the last `lookback` candles. Close above => LONG trigger. */
  upperTriggerPrice: number;

  /** Lowest Low of the last `lookback` candles. Close below => SHORT trigger. */
  lowerTriggerPrice: number;

  /** Simple Moving Average of volume over the last `lookback` candles. */
  volumeBaseline: number;

  /** Lookback window used to derive the levels (number of candles). */
  lookback: number;

  /** Volume multiplier required for breakout confirmation. */
  volumeMultiplier: number;

  /** Human-readable description of the entry rules. */
  entryConditions: string;
}
