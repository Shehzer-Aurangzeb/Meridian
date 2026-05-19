import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HistoryQueryDto } from '../dto/history-query.dto';

const COIN_PATTERN = /^[A-Z0-9]{2,15}$/;

@ApiTags('history')
@Controller('analysis/history')
export class HistoryController {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Paginated coordinator-run history for a single asset.
   * Backs the FE history page (charts, recent triggers, status timeline).
   */
  @Get(':coin')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get paginated coordinator-run history for an asset',
    description:
      'Returns recent CoordinatorRun records for the given coin, ordered by ' +
      'createdAt desc. Sourced from the streaming pipeline persistence layer.',
  })
  @ApiParam({ name: 'coin', example: 'BTC', description: 'Base asset symbol' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-05-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-05-17' })
  @ApiResponse({ status: 200, description: 'History records returned.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 404, description: 'No history found for symbol.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getHistoryByCoin(
    @Param('coin') coin: string,
    @Query() query: HistoryQueryDto,
  ) {
    const symbol = (coin ?? '').trim().toUpperCase();
    if (!COIN_PATTERN.test(symbol)) {
      throw new HttpException('Invalid coin symbol', HttpStatus.BAD_REQUEST);
    }

    const { limit = 50, startDate, endDate } = query;

    const where: Prisma.CoordinatorRunWhereInput = { symbol };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    try {
      const [runs, total] = await Promise.all([
        this.prismaService.coordinatorRun.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            symbol: true,
            timeframe: true,
            regime: true,
            strategyRoute: true,
            checklistStatus: true,
            totalScore: true,
            shouldInvokeAI: true,
            aiAction: true,
            aiConfidence: true,
            durationMs: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
        this.prismaService.coordinatorRun.count({ where }),
      ]);

      if (total === 0) {
        throw new HttpException(
          `No history found for ${symbol}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: { symbol, total, count: runs.length, runs },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Failed to fetch history';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
