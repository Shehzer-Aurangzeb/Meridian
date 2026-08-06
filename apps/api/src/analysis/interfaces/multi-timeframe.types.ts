import { Timeframe } from '../../common/constants/timeframes';
import { IndicatorResults, QQEResult } from '../../indicators/interfaces/indicator.types';
import { Candle } from '../../common/types/candle.types';
import { EntryChecklistResult } from './checklist.types';

export type MarketStructure = 'bullish' | 'bearish' | 'ranging' | 'unknown';

/**
 * Convert MarketStructure to checklist format
 */
export type MarketStructurePattern = 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown';

export interface SwingPoint {
  type: 'high' | 'low';
  price: number;
  index: number;
  time: Date;
}

export interface MarketStructureAnalysis {
  structure: MarketStructure;
  pattern: MarketStructurePattern; // Added for checklist compatibility
  swingPoints: SwingPoint[];
  lastHigherHigh: SwingPoint | null;
  lastHigherLow: SwingPoint | null;
  lastLowerHigh: SwingPoint | null;
  lastLowerLow: SwingPoint | null;
  trendStrength: number; // 0-100
}

export type Bias = 'bullish' | 'bearish' | 'neutral';

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  indicators: IndicatorResults;
  marketStructure: MarketStructureAnalysis;
  bias: Bias;
  confidence: number; // 0-100
  key50Level: number; // 50% fib/range level
  currentPrice: number;
  candleCount: number;
}

export interface HTFBiasResult {
  bias: Bias;
  confidence: number; // 0-100
  reasoning: string[];
  alignedTimeframes: Timeframe[];
  conflictingTimeframes: Timeframe[];
}

export type EntrySignal =
  | 'pullback_to_support'
  | 'pullback_to_resistance'
  | 'breakout_retest'
  | 'rsi_divergence'
  | 'bollinger_bounce'
  | 'swing_failure'
  | 'none';

export interface LTFEntryResult {
  hasEntry: boolean;
  timeframe: Timeframe | null;
  signal: EntrySignal;
  reasons: string[];
  entryZone: {
    low: number;
    high: number;
  } | null;
  suggestedStopLoss: number | null;
  riskRewardRatio: number | null;
}

/**
 * Legacy simple checklist (for backward compatibility)
 */
export interface EntryChecklist {
  htfBiasConfirmed: boolean;
  marketStructureAligned: boolean;
  keyLevelIdentified: boolean;
  ltfConfirmation: boolean;
  rsiConditionMet: boolean;
  score: number; // 0-5
  passed: boolean; // >= 4 required
}

export interface MultiTimeframeAnalysisResult {
  symbol: string;
  analyzedAt: Date;
  currentPrice: number;

  // Individual timeframe breakdowns
  timeframeAnalysis: TimeframeAnalysis[];

  // Aggregated bias
  htfBias: HTFBiasResult;

  // Entry signal
  ltfEntry: LTFEntryResult;

  // Legacy simple checklist (backward compatibility)
  entryChecklist: EntryChecklist;

  // NEW: Miraj's 5-point checklist with detailed scoring
  fivePointChecklist?: EntryChecklistResult;

  // Trade suggestion based on all analysis
  tradeSuggestion: {
    action: 'long' | 'short' | 'wait';
    confidence: number;
    reasoning: string;
  };
}

export interface AnalysisOptions {
  tradeType: 'swing' | 'day' | 'scalp';
  symbol: string;
  customTimeframes?: Timeframe[];
  includeDetailedChecklist?: boolean; // Enable 5-point checklist
}
