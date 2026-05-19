import { MarketRegimeResult } from '../../market-regime/interfaces/market-regime.types';
import { SqueezeBreakoutSetup } from '../../squeeze-breakout/interfaces/squeeze-breakout.types';
import { EntryChecklistResult } from '../../analysis/interfaces/checklist.types';

/**
 * Strategy routing types for the coordinator
 */
export type StrategyRoute = 'SQUEEZE_BREAKOUT' | 'CONFLUENCE_CHECKLIST';

/**
 * Coordinator analysis result
 *
 * This is the unified return type from the AnalysisCoordinatorService,
 * serving as the single entry point for all downstream decision-making
 * (checklist routing, AI invocation, execution signals, etc).
 */
export interface CoordinatorAnalysisResult {
  // Asset identification
  symbol: string;
  timeframe: string;

  // Market regime classification (always populated)
  regimeResult: MarketRegimeResult;

  // Strategy routing decision
  strategyRoute: StrategyRoute;

  // Squeeze breakout payload (populated only if strategyRoute === 'SQUEEZE_BREAKOUT')
  squeezeSetup: SqueezeBreakoutSetup | null;

  // Checklist evaluation result (populated only if strategyRoute === 'CONFLUENCE_CHECKLIST')
  checklistResult: EntryChecklistResult | null;

  // Gate controlling downstream AI invocation
  // - SQUEEZE_BREAKOUT always sets true
  // - CONFLUENCE_CHECKLIST sets true only if status !== 'WATCHING'
  shouldInvokeAI: boolean;

  // Optional: reasoning/explanation of the coordinator's decision path
  reasoning: string;
}
