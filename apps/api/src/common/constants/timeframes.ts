/**
 * Timeframe constants for multi-timeframe analysis
 * Based on Miraj's HTF → LTF hierarchy
 */

export const TIMEFRAMES = {
  // Higher Timeframes (HTF) - Determine bias
  WEEKLY: '1w',
  DAILY: '1d',
  TWELVE_HOUR: '12h',

  // Lower Timeframes (LTF) - Entry signals
  FOUR_HOUR: '4h',
  ONE_HOUR: '1h',
  FIFTEEN_MIN: '15m',
  FIVE_MIN: '5m',
  ONE_MIN: '1m',
} as const;

export type Timeframe = (typeof TIMEFRAMES)[keyof typeof TIMEFRAMES];

/**
 * Timeframe hierarchy for different trade types
 * - swing: Longer holds (days to weeks)
 * - day: Intraday trades (hours to day)
 * - scalp: Quick trades (minutes to hours)
 */
export const ANALYSIS_TIMEFRAMES = {
  swing: [
    TIMEFRAMES.WEEKLY,
    TIMEFRAMES.DAILY,
    TIMEFRAMES.TWELVE_HOUR,
    TIMEFRAMES.FOUR_HOUR,
  ],
  day: [
    TIMEFRAMES.DAILY,
    TIMEFRAMES.TWELVE_HOUR,
    TIMEFRAMES.FOUR_HOUR,
    TIMEFRAMES.ONE_HOUR,
  ],
  scalp: [TIMEFRAMES.FOUR_HOUR, TIMEFRAMES.ONE_HOUR, TIMEFRAMES.FIFTEEN_MIN],
} as const;

export type TradeType = keyof typeof ANALYSIS_TIMEFRAMES;

/**
 * Candle limits per timeframe
 * More candles for lower timeframes to capture enough history
 */
export const CANDLE_LIMITS: Record<Timeframe, number> = {
  [TIMEFRAMES.WEEKLY]: 52, // ~1 year
  [TIMEFRAMES.DAILY]: 100, // ~3 months
  [TIMEFRAMES.TWELVE_HOUR]: 120, // ~2 months
  [TIMEFRAMES.FOUR_HOUR]: 150, // ~25 days
  [TIMEFRAMES.ONE_HOUR]: 200, // ~8 days
  [TIMEFRAMES.FIFTEEN_MIN]: 200, // ~2 days
  [TIMEFRAMES.FIVE_MIN]: 200, // ~17 hours
  [TIMEFRAMES.ONE_MIN]: 200, // ~3 hours
};

/**
 * Timeframe the regime description and the 5 condition readings are computed
 * on, when the caller does not name one — which, after `analyze` became
 * symbol-only, is always.
 *
 * 12h because the playbook takes its checklist readings from HTF ("RSI in
 * oversold zone (15-30) on HTF", p12) and names "12h, Daily" as the
 * level-to-level frame (p51). It is also the Fibonacci anchor, so the
 * description and the level map agree about what "the higher timeframe" is.
 *
 * NOT reused from the level map's 12h fetch: the regime needs 250 candles for
 * its 200-sample bandwidth percentile, and the map fetches 120. Sharing them
 * would silently degrade the percentile.
 *
 * Siblings live in `level-map.service.ts`: LEVEL_TIMEFRAMES,
 * FIB_ANCHOR_TIMEFRAME, ATR_TIMEFRAME. All four are surfaced by `analyze`, so
 * no timeframe choice is implicit.
 */
export const ANALYSIS_TIMEFRAME: Timeframe = TIMEFRAMES.TWELVE_HOUR;

/**
 * HTF timeframes for bias determination
 */
export const HTF_TIMEFRAMES: Timeframe[] = [
  TIMEFRAMES.WEEKLY,
  TIMEFRAMES.DAILY,
  TIMEFRAMES.TWELVE_HOUR,
];

/**
 * LTF timeframes for entry signals
 */
export const LTF_TIMEFRAMES: Timeframe[] = [
  TIMEFRAMES.FOUR_HOUR,
  TIMEFRAMES.ONE_HOUR,
  TIMEFRAMES.FIFTEEN_MIN,
];

/**
 * RSI thresholds for overbought/oversold conditions
 */
export const RSI_THRESHOLDS = {
  OVERSOLD: 30,
  OVERBOUGHT: 70,
  EXTREME_OVERSOLD: 20,
  EXTREME_OVERBOUGHT: 80,
} as const;

/**
 * Minimum swing points needed for market structure analysis
 */
export const MIN_SWING_POINTS = 4;
