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

const COIN_PATTERN = /^[A-Z0-9]{2,15}$/;

/**
 * @deprecated Controller not consumed by frontend. Validation data is shown via history page.
 * Retained for potential admin/debugging dashboards.
 */
@ApiTags('validation')
@Controller('analysis/validate')
export class ValidationController {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * @deprecated Not consumed by frontend. Use history page instead.
   * Summary validation profile for recent historical trade triggers.
   * Aggregates CoordinatorRun records (per-symbol) for the FE validation panel.
   */
  @Get(':coin')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    deprecated: true,
    summary: 'Summary validation profile for recent triggers of an asset',
    description:
      'Aggregates the most recent CoordinatorRun records for the given coin: ' +
      'counts by AI action, average confidence, average duration, error rate, ' +
      'and a compact list of the latest triggers.',
  })
  @ApiParam({ name: 'coin', example: 'BTC' })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 100,
    description: 'Window size of recent runs to summarise (1-500).',
  })
  @ApiResponse({ status: 200, description: 'Validation profile returned.' })
  @ApiResponse({ status: 400, description: 'Invalid coin or limit.' })
  @ApiResponse({ status: 404, description: 'No runs found for symbol.' })
  async validateRecentTriggers(
    @Param('coin') coin: string,
    @Query('limit') limitRaw?: string,
  ) {
    const symbol = (coin ?? '').trim().toUpperCase();
    if (!COIN_PATTERN.test(symbol)) {
      throw new HttpException('Invalid coin symbol', HttpStatus.BAD_REQUEST);
    }

    const limit = this.parseLimit(limitRaw);

    try {
      const where: Prisma.CoordinatorRunWhereInput = { symbol };
      const runs = await this.prismaService.coordinatorRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          timeframe: true,
          regime: true,
          strategyRoute: true,
          // Historical only — no longer written. Kept so past rows still
          // report what the system said at the time. Null on new rows.
          checklistStatus: true,
          totalScore: true,
          shouldInvokeAI: true,
          aiAction: true,
          aiConfidence: true,
          durationMs: true,
          errorMessage: true,
          createdAt: true,
        },
      });

      if (runs.length === 0) {
        throw new HttpException(
          `No runs found for ${symbol}`,
          HttpStatus.NOT_FOUND,
        );
      }

      const actionCounts: Record<string, number> = {};
      const regimeCounts: Record<string, number> = {};
      const routeCounts: Record<string, number> = {};
      let aiInvocations = 0;
      let errorCount = 0;
      let durationSum = 0;
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (const run of runs) {
        const action = run.aiAction ?? 'NONE';
        actionCounts[action] = (actionCounts[action] ?? 0) + 1;
        regimeCounts[run.regime] = (regimeCounts[run.regime] ?? 0) + 1;
        routeCounts[run.strategyRoute] =
          (routeCounts[run.strategyRoute] ?? 0) + 1;
        if (run.shouldInvokeAI) aiInvocations++;
        if (run.errorMessage) errorCount++;
        durationSum += run.durationMs;
        if (run.aiConfidence !== null) {
          confidenceSum += run.aiConfidence;
          confidenceCount++;
        }
      }

      return {
        success: true,
        data: {
          symbol,
          window: runs.length,
          summary: {
            actionCounts,
            regimeCounts,
            routeCounts,
            aiInvocationRate: round(aiInvocations / runs.length),
            errorRate: round(errorCount / runs.length),
            avgDurationMs: Math.round(durationSum / runs.length),
            avgAiConfidence:
              confidenceCount > 0
                ? round(confidenceSum / confidenceCount)
                : null,
          },
          recentTriggers: runs,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Validation summary failed';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private parseLimit(raw?: string): number {
    if (raw === undefined || raw === '') return 100;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
      throw new HttpException(
        'Invalid limit. Must be an integer between 1 and 500.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return parsed;
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
