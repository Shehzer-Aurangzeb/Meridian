import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { AnalysisRecord, AnalyzeService } from './analyze.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { analysisFreshness, Freshness } from './freshness';
import { PlanResult, scorePlans } from './outcome';
import { Candle, TimeInterval } from '../common/types/candle.types';

/** Outcome replay series: 1h wicks, 30 days — see the detail route. */
const OUTCOME_TIMEFRAME: TimeInterval = '1h';
const OUTCOME_CANDLES = 720;

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

/**
 * The API the frontend and the scheduler both use.
 *
 *   POST /analyses?symbol=BTC   run one analysis and save it
 *   GET  /analyses              list saved analyses (newest first)
 *   GET  /analyses/:id          one analysis, with its freshness
 *
 * Every route here is protected by the global AuthGuard: a session token from
 * the frontend, or the API key from the scheduler.
 */
@ApiTags('analyses')
@Controller('analyses')
export class AnalysesController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly persistence: CoordinatorPersistenceService,
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Run an analysis for one symbol and persist it' })
  async run(@Query('symbol') symbol: string): Promise<{
    id: string;
    analysis: AnalysisRecord;
  }> {
    const coin = (symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(coin)) {
      throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);
    }

    const analysis = await this.analyzeService.analyze(coin);
    const { id } = await this.persistence.persistAnalysis(analysis);
    return { id, analysis };
  }

  @Get()
  @ApiOperation({ summary: 'List saved analyses, newest first' })
  async list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
  ): Promise<{ count: number; analyses: unknown[] }> {
    const where: Prisma.CoordinatorRunWhereInput = {};
    if (symbol) {
      const coin = symbol.trim().toUpperCase();
      if (!SYMBOL_PATTERN.test(coin)) {
        throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);
      }
      where.symbol = coin;
    }

    // Anything not a positive number falls back to the default. Clamping
    // instead would turn `?limit=-5` into a single row, which reads as "there
    // is one analysis" rather than "that limit was nonsense".
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    // Payload deliberately excluded — a list of 50 full level maps is a large
    // response nobody reads. The detail route serves it.
    const analyses = await this.prisma.coordinatorRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        symbol: true,
        timeframe: true,
        regime: true,
        strategyRoute: true,
        durationMs: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    return { count: analyses.length, analyses };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One saved analysis with its current freshness and outcome',
  })
  async detail(@Param('id') id: string): Promise<{
    id: string;
    createdAt: Date;
    currentPrice: number;
    freshness: Freshness;
    outcomes: PlanResult[];
    analysis: AnalysisRecord;
  }> {
    const row = await this.prisma.coordinatorRun.findUnique({
      where: { id },
      select: { id: true, symbol: true, createdAt: true, coordinatorPayload: true },
    });
    if (!row) {
      throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);
    }

    const analysis = row.coordinatorPayload as unknown as AnalysisRecord;
    if (!analysis?.plans || !analysis?.map) {
      // Rows written before AnalyzeService existed hold a regime-leg-only
      // payload. Say so rather than reporting a freshness computed from
      // nothing.
      throw new HttpException(
        'This row predates the level map and has no plans to score',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Everything the two verdicts need, in one round of I/O: the price the
    // chart wants anyway, the newest analysis for this symbol, and the
    // candles since this one was taken.
    const [currentPrice, newestRow, candles] = await Promise.all([
      this.binance.getCurrentPrice(row.symbol),
      this.prisma.coordinatorRun.findFirst({
        where: { symbol: row.symbol, id: { not: row.id } },
        orderBy: { createdAt: 'desc' },
        select: { coordinatorPayload: true },
      }),
      // 1h is the finest series paged cheaply, so a stop or target touched
      // intraday is not missed by a coarser candle. 720 = 30 days, which is
      // well past the 24h in which every backtested fill happened.
      this.binance
        .getCandlesPaged(row.symbol, OUTCOME_TIMEFRAME, OUTCOME_CANDLES)
        .catch(() => [] as Candle[]),
    ]);

    const newest = newestRow?.coordinatorPayload as unknown as AnalysisRecord | undefined;

    return {
      id: row.id,
      createdAt: row.createdAt,
      currentPrice,
      freshness: analysisFreshness(
        analysis,
        currentPrice,
        newest?.map ? { map: newest.map } : null,
      ),
      // Strictly after the analysis: a candle already forming when it was
      // taken must not be allowed to "fill" a plan retroactively.
      outcomes: scorePlans(
        analysis.plans,
        candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
        row.createdAt,
        Date.now(),
      ),
      analysis,
    };
  }
}
