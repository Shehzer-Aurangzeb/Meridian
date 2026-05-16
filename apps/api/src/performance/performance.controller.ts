import { Controller, Get, Param, Query } from '@nestjs/common';
import { PerformanceService, AnalysisWithPerformance } from './performance.service';
import { PrismaService } from '../prisma/prisma.service';
import { PerformanceResponseDto, PerformanceAnalysis } from './dto/performance-response.dto';
import { HistoryQueryDto } from '../analysis/dto/history-query.dto';
import { Prisma } from '@prisma/client';

@Controller('analysis/performance')
export class PerformanceController {
  constructor(
    private readonly performanceService: PerformanceService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
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

  @Get(':coin')
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
