import { Injectable } from '@nestjs/common';
import { TradeAnalysis } from '@prisma/client';
import { BinanceService } from './binance.service';

export type AnalysisStatus = 'correct' | 'failed' | 'pending' | 'neutral';

export interface AnalysisWithPerformance extends TradeAnalysis {
  currentPrice: number | null;
  status: AnalysisStatus;
  priceChange: number | null;
  priceChangePercent: number | null;
}

export interface WinRateStats {
  winRate: number;
  totalAnalyzed: number;
  correct: number;
  failed: number;
  pending: number;
  neutral: number;
}

@Injectable()
export class PerformanceService {
  private readonly MINIMUM_AGE_HOURS = 1;

  constructor(private readonly binanceService: BinanceService) {}

  async calculatePerformance(
    analyses: TradeAnalysis[],
  ): Promise<AnalysisWithPerformance[]> {
    const results: AnalysisWithPerformance[] = [];
    const priceCache = new Map<string, number | null>();

    for (const analysis of analyses) {
      let currentPrice = priceCache.get(analysis.coin);

      if (currentPrice === undefined) {
        try {
          currentPrice = await this.binanceService.getCurrentPrice(analysis.coin);
          priceCache.set(analysis.coin, currentPrice);
        } catch {
          priceCache.set(analysis.coin, null);
          currentPrice = null;
        }
      }

      const status = this.determineStatus(analysis, currentPrice);
      const priceChange = currentPrice !== null ? currentPrice - analysis.priceAtAnalysis : null;
      const priceChangePercent =
        currentPrice !== null && analysis.priceAtAnalysis > 0
          ? ((currentPrice - analysis.priceAtAnalysis) / analysis.priceAtAnalysis) * 100
          : null;

      results.push({
        ...analysis,
        currentPrice,
        status,
        priceChange,
        priceChangePercent,
      });
    }

    return results;
  }

  private determineStatus(
    analysis: TradeAnalysis,
    currentPrice: number | null,
  ): AnalysisStatus {
    if (analysis.suggestion === 'WAIT') {
      return 'neutral';
    }

    const ageInHours =
      (Date.now() - new Date(analysis.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < this.MINIMUM_AGE_HOURS) {
      return 'pending';
    }

    if (currentPrice === null) {
      return 'pending';
    }

    if (analysis.suggestion === 'LONG') {
      if (currentPrice < analysis.stopLoss) {
        return 'failed';
      }
      return currentPrice >= analysis.entryPrice ? 'correct' : 'failed';
    }

    if (analysis.suggestion === 'SHORT') {
      if (currentPrice > analysis.stopLoss) {
        return 'failed';
      }
      return currentPrice <= analysis.entryPrice ? 'correct' : 'failed';
    }

    return 'neutral';
  }

  calculateWinRate(analysesWithPerformance: AnalysisWithPerformance[]): WinRateStats {
    let correct = 0;
    let failed = 0;
    let pending = 0;
    let neutral = 0;

    for (const analysis of analysesWithPerformance) {
      switch (analysis.status) {
        case 'correct':
          correct++;
          break;
        case 'failed':
          failed++;
          break;
        case 'pending':
          pending++;
          break;
        case 'neutral':
          neutral++;
          break;
      }
    }

    const totalAnalyzed = correct + failed;
    const winRate = totalAnalyzed > 0 ? (correct / totalAnalyzed) * 100 : 0;

    return {
      winRate: Math.round(winRate * 10) / 10,
      totalAnalyzed,
      correct,
      failed,
      pending,
      neutral,
    };
  }
}
