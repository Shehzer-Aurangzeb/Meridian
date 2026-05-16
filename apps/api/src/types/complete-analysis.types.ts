import { EntryChecklistResult } from './checklist.types';
import { SupportResistanceLevel } from './support-resistance.types';
import { ClaudeTradeAnalysis, ClaudeWaitAnalysis } from './claude-response.types';
import { PositionSizingResult, RiskRewardResult } from './position-sizing.types';
import { LeverageRecommendation } from './leverage.types';
import { MultiTimeframeAnalysisResult } from './multi-timeframe.types';

/**
 * Complete analysis response with all components
 * Everything a trader needs to make a decision
 */
export interface CompleteAnalysisResponse {
  // Basic info
  coin: string;
  timestamp: string;
  currentPrice: number;
  
  // Multi-timeframe analysis (use the actual result type)
  timeframeAnalysis: MultiTimeframeAnalysisResult;
  
  // Entry checklist
  checklist: EntryChecklistResult;
  
  // Support/resistance
  keyLevels: {
    support: SupportResistanceLevel[];
    resistance: SupportResistanceLevel[];
    fibonacci?: any;
  };
  
  // AI recommendation
  aiAnalysis: ClaudeTradeAnalysis | ClaudeWaitAnalysis;
  
  // Risk management (only if account balance provided)
  riskManagement?: {
    leverageRecommendation: LeverageRecommendation;
    positionSizing: PositionSizingResult;
    riskReward: RiskRewardResult;
  };
  
  // Trade summary (quick overview)
  summary: TradeSummary;
  
  // Performance metadata
  meta: {
    processingTimeMs: number;
    cacheHit: boolean;
    dataFreshness: string; // e.g., "Real-time" or "Cached (2 min ago)"
  };
}

export interface TradeSummary {
  action: 'LONG' | 'SHORT' | 'WAIT';
  confidence: 'high' | 'medium' | 'low';
  quickReason: string; // One-sentence explanation
  
  // Key metrics (if action is LONG/SHORT)
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  leverage?: number;
  
  // Warnings
  warnings: string[];
  shouldTrade: boolean; // Final recommendation
}

export interface CompleteAnalysisRequest {
  // Required
  coin: string;
  
  // Optional - analysis parameters
  tradeType?: 'swing' | 'day' | 'scalp';
  timeframe?: string; // Override primary timeframe
  
  // Optional - risk management
  accountBalance?: number;
  riskPercentage?: number; // 1-2%
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  
  // Optional - preferences
  includeRiskManagement?: boolean; // Default: true if accountBalance provided
  includeFibonacci?: boolean;
}
