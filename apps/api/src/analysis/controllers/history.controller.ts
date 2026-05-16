import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HistoryQueryDto } from '../dto/history-query.dto';
import { HistoryResponseDto } from '../dto/history-response.dto';
import { Prisma } from '@prisma/client';

@Controller('analysis/history')
export class HistoryController {
  constructor(private readonly prismaService: PrismaService) {}

  @Get()
  async getHistory(@Query() query: HistoryQueryDto): Promise<HistoryResponseDto> {
    try {
      const { limit = 50, startDate, endDate } = query;

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

      const [analyses, total] = await Promise.all([
        this.prismaService.tradeAnalysis.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prismaService.tradeAnalysis.count({ where }),
      ]);

      return HistoryResponseDto.success({
        analyses,
        total,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch history';
      return HistoryResponseDto.failure(message);
    }
  }

  @Get(':coin')
  async getHistoryByCoin(
    @Param('coin') coin: string,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryResponseDto> {
    try {
      const { limit = 50, startDate, endDate } = query;
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

      const [analyses, total] = await Promise.all([
        this.prismaService.tradeAnalysis.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prismaService.tradeAnalysis.count({ where }),
      ]);

      return HistoryResponseDto.success({
        analyses,
        total,
        coin: normalizedCoin,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch history';
      return HistoryResponseDto.failure(message);
    }
  }
}
