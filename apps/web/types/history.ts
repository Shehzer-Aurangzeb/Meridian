export type AnalysisStatus = 'correct' | 'failed' | 'pending' | 'neutral';

export interface PerformanceAnalysis {
  id: string;
  coin: string;
  suggestion: string;
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
