/**
 * The five entry conditions, reported one by one as met or not, with the
 * value that decided each.
 *
 * There is deliberately NO overall score out of 100 and no quality label.
 * Both were tested and neither predicted anything: higher scores did not lead
 * to better outcomes. A number that ranks nothing still gets trusted, so it
 * was removed rather than left unused.
 */

export interface ChecklistCondition {
  name: string;
  passed: boolean;
  value?: number | string;
  threshold?: string;
  reason: string;
}

export interface RSIConditionParams {
  tradeType: 'long' | 'short';
  rsi: number;
}

export interface QQEConditionParams {
  tradeType: 'long' | 'short';
  qqeColor: 'green' | 'red' | 'neutral';
  previousQQEColor?: 'green' | 'red' | 'neutral';
}

export interface BollingerBandConditionParams {
  tradeType: 'long' | 'short';
  currentPrice: number;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  };
  bandWidth: number; // percentage
}

export interface MarketStructureConditionParams {
  tradeType: 'long' | 'short';
  structure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown';
}

export interface EntryChecklistParams {
  tradeType: 'long' | 'short';
  rsi: number;
  rsiHistory?: number[]; // Last 100 RSI values for Z-score calculation
  qqeColor: 'green' | 'red' | 'neutral';
  previousQQEColor?: 'green' | 'red' | 'neutral';
  currentPrice: number;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  };
  bandWidth: number;
  marketStructure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown';
  nearestLevel: {
    price: number;
    type: 'support' | 'resistance';
    /**
     * How many times price actually tested this level. This is what the
     * SR_THRESHOLDS below count, so it is what the checklist must read.
     *
     * NOT `strength`, which is a 1-5 SCORE derived from the touch count and
     * then nudged half a point for whether the level held. The checklist used
     * to compare `strength` against thresholds named MIN_TESTS, which for a
     * level that held rounded up to count + 1 — so a level touched twice was
     * scored as "3+ tests" and given full credit.
     */
    touchCount: number;
    volumeAtTouch?: number[]; // Volume at each test touch
  } | null;
  volumeAtNearestLevel?: number; // Current volume for volume confirmation
}

export interface EntryChecklistResult {
  // Individual conditions
  rsi: ChecklistCondition;
  qqe: ChecklistCondition;
  bollingerBand: ChecklistCondition;
  marketStructure: ChecklistCondition;
  supportResistance: ChecklistCondition;

  // Summary
  conditionsMet: number; // 0-5
  passed: boolean; // true if conditionsMet >= PLAYBOOK_MIN_CONDITIONS_MET (3 of 5)
  tradeType: 'long' | 'short';

  // All conditions as array for iteration
  conditions: ChecklistCondition[];
}

/**
 * RSI Thresholds for entry conditions (with dynamic relative bands)
 */
export const RSI_ENTRY_THRESHOLDS = {
  LONG: {
    STRICT_MAX: 40,      // RSI must be <= 40 OR meet Z-score criterion
    ZSCORE_THRESHOLD: -1.5, // 1.5 std dev below 100-period MA
  },
  SHORT: {
    STRICT_MIN: 60,      // RSI must be >= 60 OR meet Z-score criterion
    ZSCORE_THRESHOLD: 1.5,  // 1.5 std dev above 100-period MA
  },
} as const;

/**
 * RSI Z-score constants
 */
export const RSI_ZSCORE_CONFIG = {
  LOOKBACK_PERIOD: 100,  // 100-period MA for relative calculation
  STD_DEV_THRESHOLD: 1.5, // 1.5 standard deviations
} as const;

/**
 * Bollinger Band thresholds
 */
export const BB_THRESHOLDS = {
  PROXIMITY_PERCENT: 10, // Within 10% of band
  MIN_BAND_WIDTH: 2, // Minimum 2% width (avoid squeeze)
} as const;

/**
 * Support/Resistance thresholds (with partial credit)
 */
export const SR_THRESHOLDS = {
  // Full credit (20 points)
  STRONG_PROXIMITY_PERCENT: 2, // Within 2% of level
  STRONG_MIN_TESTS: 3,         // Minimum 3 touches

  // Partial credit (15 points)
  PARTIAL_PROXIMITY_PERCENT: 1.5, // Within 1.5% of level
  PARTIAL_MIN_TESTS: 2,           // Exactly 2 touches
  PARTIAL_VOLUME_MULTIPLIER: 1.2, // 2nd touch must be above-average volume
} as const;

/** How many of the five must be met before a setup counts at all. */
export const PLAYBOOK_MIN_CONDITIONS_MET = 3;
