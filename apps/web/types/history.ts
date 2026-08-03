import type { Action, StrategyRoute } from './analysis';

// ============ Performance Types ============

export type AnalysisStatus = 'correct' | 'failed' | 'pending' | 'neutral';

export interface PerformanceAnalysis {
  id: string;
  coin: string;
  suggestion: Action;
  entryPrice: number;
  stopLoss: number;
  priceAtAnalysis: number;
  currentPrice: number | null;
  status: AnalysisStatus;
  priceChange: number | null;
  priceChangePercent: number | null;
  createdAt: string;
}

export interface PerformanceData {
  winRate: number;
  totalAnalyzed: number;
  correct: number;
  failed: number;
  pending: number;
  neutral: number;
  coin?: string;
  recentAnalyses: PerformanceAnalysis[];
}

export interface PerformanceResponse {
  success: boolean;
  data?: PerformanceData;
  error?: string;
}

// ============ History Types ============

export interface CoordinatorRunRecord {
  id: string;
  symbol: string;
  timeframe: string;
  regime: string;
  strategyRoute: StrategyRoute;
  checklistStatus: string | null;
  totalScore: number | null;
  shouldInvokeAI: boolean;
  aiAction: Action | null;
  aiConfidence: number | null;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface HistoryData {
  symbol: string;
  total: number;
  count: number;
  runs: CoordinatorRunRecord[];
}

export interface HistoryResponse {
  success: boolean;
  data?: HistoryData;
  error?: string;
}

export interface HistoryQueryOptions {
  limit?: number;
  startDate?: string;
  endDate?: string;
}
