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
  THIRTY_MIN: '30m',
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
  // 120 not 52: the replay guards skip any bar where a chart has under 50
  // candles, and 52 leaves no room for that. Weekly klines go back to 2017.
  [TIMEFRAMES.WEEKLY]: 120, // ~2.3 years
  [TIMEFRAMES.DAILY]: 100, // ~3 months
  [TIMEFRAMES.TWELVE_HOUR]: 120, // ~2 months
  [TIMEFRAMES.FOUR_HOUR]: 150, // ~25 days
  [TIMEFRAMES.ONE_HOUR]: 200, // ~8 days
  [TIMEFRAMES.THIRTY_MIN]: 200, // ~4 days
  [TIMEFRAMES.FIFTEEN_MIN]: 200, // ~2 days
  [TIMEFRAMES.FIVE_MIN]: 200, // ~17 hours
  [TIMEFRAMES.ONE_MIN]: 200, // ~3 hours
};

/**
 * The chart the market type and the five entry conditions are read from.
 *
 * 12 hours, matching the chart the levels are anchored to, so both parts of
 * the analysis mean the same thing by "the bigger picture". It fetches its own
 * longer history rather than sharing, because one of its measures needs 200
 * past readings.
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
