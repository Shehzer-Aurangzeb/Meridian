/**
 * Enhanced Claude Analysis Response Types
 * For structured, validated AI trade recommendations
 */

import { TradeAction } from '../../analysis/interfaces/analysis.types';

export interface ClaudeEntryDetails {
  price: number;
  reasoning: string;
}

export interface ClaudeStopLoss {
  price: number;
  distance: string; // e.g., "5.2%"
  method: string; // e.g., "Support at $28,600 minus ATR $450"
}

export interface ClaudeTakeProfitLevel {
  price: number;
  gain: string; // e.g., "5.0%"
}

export interface ClaudeTakeProfit {
  tp1: ClaudeTakeProfitLevel;
  tp2: ClaudeTakeProfitLevel;
  tp3: ClaudeTakeProfitLevel;
}

export interface ClaudeLeverage {
  recommended: number;
  rationale: string;
}

export interface ClaudeReasoning {
  checklistAnalysis: string;
  timeframeConfluence: string;
  keyLevels: string;
  risks: string;
}

/**
 * Full Claude analysis response for trade signals (LONG/SHORT)
 */
export interface ClaudeTradeAnalysis {
  action: 'LONG' | 'SHORT';
  confidence: number;
  entry: ClaudeEntryDetails;
  stopLoss: ClaudeStopLoss;
  takeProfit: ClaudeTakeProfit;
  leverage: ClaudeLeverage;
  riskReward: number;
  summary: string;
  reasoning: ClaudeReasoning;
  warnings: string[];
  conditionsMet: string;
}

/**
 * Claude analysis response for WAIT signal
 */
export interface ClaudeWaitAnalysis {
  action: 'WAIT';
  confidence: number;
  summary: string;
  reasoning: ClaudeReasoning;
  warnings: string[];
  conditionsMet: string;
}

/**
 * Union type for all Claude analysis responses
 */
export type ClaudeAnalysisResponse = ClaudeTradeAnalysis | ClaudeWaitAnalysis;

/**
 * Type guard to check if response is a trade signal
 */
export function isTradeSignal(
  response: ClaudeAnalysisResponse,
): response is ClaudeTradeAnalysis {
  return response.action === 'LONG' || response.action === 'SHORT';
}

/**
 * Type guard to check if response is a wait signal
 */
export function isWaitSignal(
  response: ClaudeAnalysisResponse,
): response is ClaudeWaitAnalysis {
  return response.action === 'WAIT';
}

/**
 * Validation error for Claude responses
 */
export class ClaudeResponseValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly receivedValue?: unknown,
  ) {
    super(`Invalid Claude response: ${message}`);
    this.name = 'ClaudeResponseValidationError';
  }
}
