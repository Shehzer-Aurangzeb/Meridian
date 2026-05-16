/**
 * 5-Point Entry Checklist Types
 * Based on Miraj's trading strategy
 * Each condition scores 0 or 20 points, total 100 points max
 * Minimum 60 points (3/5 conditions) required for trade signal
 */

export interface ChecklistCondition {
  name: string;
  passed: boolean;
  score: 0 | 20;
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

export interface SupportResistanceConditionParams {
  tradeType: 'long' | 'short';
  currentPrice: number;
  nearestLevel: {
    price: number;
    type: 'support' | 'resistance';
    strength: number; // number of tests
  } | null;
}

export interface EntryChecklistParams {
  tradeType: 'long' | 'short';
  rsi: number;
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
    strength: number;
  } | null;
}

export interface EntryChecklistResult {
  // Individual conditions
  rsi: ChecklistCondition;
  qqe: ChecklistCondition;
  bollingerBand: ChecklistCondition;
  marketStructure: ChecklistCondition;
  supportResistance: ChecklistCondition;

  // Summary
  totalScore: number; // 0-100
  conditionsMet: number; // 0-5
  passed: boolean; // totalScore >= 60
  tradeType: 'long' | 'short';

  // All conditions as array for iteration
  conditions: ChecklistCondition[];
}

/**
 * RSI Thresholds for entry conditions
 */
export const RSI_ENTRY_THRESHOLDS = {
  LONG: {
    MIN: 15,
    MAX: 35,
    EXTREME_MIN: 15,
    EXTREME_MAX: 20,
  },
  SHORT: {
    MIN: 65,
    MAX: 85,
    EXTREME_MIN: 80,
    EXTREME_MAX: 95,
  },
} as const;

/**
 * Bollinger Band thresholds
 */
export const BB_THRESHOLDS = {
  PROXIMITY_PERCENT: 10, // Within 10% of band
  MIN_BAND_WIDTH: 2, // Minimum 2% width (avoid squeeze)
} as const;

/**
 * Support/Resistance thresholds
 */
export const SR_THRESHOLDS = {
  PROXIMITY_PERCENT: 2, // Within 2% of level
  MIN_TESTS: 3, // Minimum tests for strong level
} as const;
