import { AnalysisStatus, WinRateStats } from '../services/performance.service';

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
  createdAt: Date;
}

export interface PerformanceData extends WinRateStats {
  coin?: string;
  recentAnalyses: PerformanceAnalysis[];
}

export interface PerformanceResponseDto {
  success: boolean;
  data?: PerformanceData;
  error?: string;
}

export const PerformanceResponseDto = {
  success(data: PerformanceData): PerformanceResponseDto {
    return {
      success: true,
      data,
    };
  },

  failure(error: string): PerformanceResponseDto {
    return {
      success: false,
      error,
    };
  },
};
