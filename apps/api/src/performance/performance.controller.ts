import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  PerformanceService,
  AnalysisWithPerformance,
  CoordinatorRunEvaluation,
} from './performance.service';
import { PrismaService } from '../prisma/prisma.service';
import { PerformanceResponseDto, PerformanceAnalysis } from './dto/performance-response.dto';
import { HistoryQueryDto } from '../analysis/dto/history-query.dto';
import { Prisma } from '@prisma/client';

@ApiTags('performance')
@Controller('analysis/performance')
export class PerformanceController {
  constructor(
    private readonly performanceService: PerformanceService,
    private readonly prismaService: PrismaService,
  ) {}

  /** @deprecated Backed by legacy TradeAnalysis rows. Use GET /analysis/performance/coordinator-runs/:symbol (smart-TTL evaluator over CoordinatorRun). */
  @Get()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Legacy TradeAnalysis performance. Use /analysis/performance/coordinator-runs/:symbol.',
  })
  async getPerformance(
    @Query() query: HistoryQueryDto,
  ): Promise<PerformanceResponseDto> {
    try {
      const { limit = 100, startDate, endDate } = query;

      const where: Prisma.TradeAnalysisWhereInput = {};

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const analyses = await this.prismaService.tradeAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const analysesWithPerformance =
        await this.performanceService.calculatePerformance(analyses);
      const stats = this.performanceService.calculateWinRate(analysesWithPerformance);

      const recentAnalyses: PerformanceAnalysis[] = analysesWithPerformance.map(
        (a: AnalysisWithPerformance) => ({
          id: a.id,
          coin: a.coin,
          suggestion: a.suggestion,
          entryPrice: a.entryPrice,
          stopLoss: a.stopLoss,
          priceAtAnalysis: a.priceAtAnalysis,
          currentPrice: a.currentPrice,
          status: a.status,
          priceChange: a.priceChange,
          priceChangePercent: a.priceChangePercent,
          createdAt: a.createdAt,
        }),
      );

      return PerformanceResponseDto.success({
        ...stats,
        recentAnalyses,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to calculate performance';
      return PerformanceResponseDto.failure(message);
    }
  }

  @Get('coordinator-runs/:symbol')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Evaluate past polymorphic coordinator runs for an asset using historical kline fill-tracking validation',
  })
  @ApiResponse({
    status: 200,
    description:
      'Array of high-fidelity tracking metrics showing filling stages, dynamic expirations, and true market outcomes.',
  })
  async getCoordinatorRunsEvaluation(
    @Param('symbol') symbol: string,
  ): Promise<CoordinatorRunEvaluation[]> {
    // Ensure symbol is upper-cased cleanly to match Binance conventions
    const normalizedSymbol = symbol.toUpperCase();
    return this.performanceService.evaluateCoordinatorRuns(normalizedSymbol);
  }

  /** @deprecated Backed by legacy TradeAnalysis rows. Use GET /analysis/performance/coordinator-runs/:symbol. */
  @Get(':coin')
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Legacy per-coin TradeAnalysis performance. Use /analysis/performance/coordinator-runs/:symbol.',
  })
  async getPerformanceByCoin(
    @Param('coin') coin: string,
    @Query() query: HistoryQueryDto,
  ): Promise<PerformanceResponseDto> {
    try {
      const { limit = 100, startDate, endDate } = query;
      const normalizedCoin = coin.toUpperCase();

      const where: Prisma.TradeAnalysisWhereInput = {
        coin: normalizedCoin,
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const analyses = await this.prismaService.tradeAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const analysesWithPerformance =
        await this.performanceService.calculatePerformance(analyses);
      const stats = this.performanceService.calculateWinRate(analysesWithPerformance);

      const recentAnalyses: PerformanceAnalysis[] = analysesWithPerformance.map(
        (a: AnalysisWithPerformance) => ({
          id: a.id,
          coin: a.coin,
          suggestion: a.suggestion,
          entryPrice: a.entryPrice,
          stopLoss: a.stopLoss,
          priceAtAnalysis: a.priceAtAnalysis,
          currentPrice: a.currentPrice,
          status: a.status,
          priceChange: a.priceChange,
          priceChangePercent: a.priceChangePercent,
          createdAt: a.createdAt,
        }),
      );

      return PerformanceResponseDto.success({
        ...stats,
        coin: normalizedCoin,
        recentAnalyses,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to calculate performance';
      return PerformanceResponseDto.failure(message);
    }
  }
}
