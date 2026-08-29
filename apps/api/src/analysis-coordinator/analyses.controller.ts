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
import { AnalystNarrationService } from '../ai/analyst-narration.service';
import { AnalysisRecord, AnalyzeService } from './analyze.service';
import { AnalysisStatusService, resultsFor, StoredResult } from './analysis-status.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { analysisFreshness, Freshness } from './freshness';
import { PlanResult } from './outcome';
import { OutcomeScorerService } from './outcome-scorer.service';
import { buildVerdict, Verdict } from './verdict';

export type { AnalysisStatus } from './analysis-status.service';

/** A saved narration, kept in the `aiPayload` column. */
export interface SavedNarration {
  text: string;
  citedPrices: number[];
  model: string;
  narratedAt: string;
}

function readNarration(payload: unknown): SavedNarration | null {
  const value = payload as Partial<SavedNarration> | null;
  return typeof value?.text === 'string' ? (value as SavedNarration) : null;
}

/**
 * Analyses older than this were built by a planner with known bugs, so they are
 * SHOWN but left out of every total. `?days=` overrides it; nothing hides them.
 */
export const RESULTS_EPOCH = new Date('2026-08-16T00:00:00Z');

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

function validSymbol(raw: string | undefined): string | null {
  const coin = (raw ?? '').trim().toUpperCase();
  return SYMBOL_PATTERN.test(coin) ? coin : null;
}

/** Where the list starts. A day window if asked for, else the epoch. */
function windowStart(days: string | undefined): Date {
  const n = Number(days);
  return new Date(
    Number.isFinite(n) && n > 0 ? Date.now() - n * 86_400_000 : RESULTS_EPOCH.getTime(),
  );
}

/** Nonsense limits fall back to the default rather than clamping to 1 row. */
function pageSize(limit: string | undefined): number {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 50;
}

/**
 *   POST /analyses?symbol=BTC   run one analysis and save it
 *   GET  /analyses              list saved analyses, newest first
 *   GET  /analyses/:id          one analysis in full
 *   POST /analyses/:id/narrate  write (or return) Claude's read of it
 */
@ApiTags('analyses')
@Controller('analyses')
export class AnalysesController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly persistence: CoordinatorPersistenceService,
    private readonly prisma: PrismaService,
    private readonly status: AnalysisStatusService,
    private readonly narrator: AnalystNarrationService,
    private readonly scorer: OutcomeScorerService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Run an analysis for one symbol and persist it' })
  async run(@Query('symbol') symbol: string): Promise<{ id: string; analysis: AnalysisRecord }> {
    const coin = validSymbol(symbol);
    if (!coin) throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);

    const analysis = await this.analyzeService.analyze(coin);
    const { id } = await this.persistence.persistAnalysis(analysis);
    // Score it here, or the row reads "not scored" until the next run — no read
    // path scores anything any more.
    await this.scorer.scoreUnresolved({ ids: [id] });
    return { id, analysis };
  }

  @Get()
  @ApiOperation({ summary: 'List saved analyses, newest first' })
  async list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('days') days?: string,
  ): Promise<{
    count: number;
    analyses: unknown[];
    truncated: boolean;
    from: string;
    epoch: string;
  }> {
    const where: Prisma.CoordinatorRunWhereInput = {};
    if (symbol) {
      const coin = validSymbol(symbol);
      if (!coin) throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);
      where.symbol = coin;
    }

    const from = windowStart(days);
    where.createdAt = { gte: from };
    const take = pageSize(limit);

    // The payloads are large and only needed to build `status`.
    const wantStatus = status === 'true' || status === '1';
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
        coordinatorPayload: wantStatus,
        outcomePayload: wantStatus,
        scoredAt: wantStatus,
      },
    });

    // A full page means there may be more. Say so, rather than let a total
    // quietly describe only part of the data.
    const truncated = analyses.length === take;
    const window = { from: from.toISOString(), epoch: RESULTS_EPOCH.toISOString() };

    if (!wantStatus) return { count: analyses.length, analyses, truncated, ...window };

    const statuses = await this.status.build(analyses);
    return {
      count: analyses.length,
      truncated,
      ...window,
      analyses: analyses.map(({ coordinatorPayload, outcomePayload, scoredAt, ...row }) => ({
        ...row,
        status: statuses.get(row.id) ?? null,
      })),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One saved analysis with its current freshness and outcome' })
  async detail(@Param('id') id: string): Promise<{
    id: string;
    createdAt: Date;
    currentPrice: number;
    freshness: Freshness;
    outcomes: StoredResult[];
    verdict: Verdict;
    narration: SavedNarration | null;
    analysis: AnalysisRecord;
  }> {
    const row = await this.prisma.coordinatorRun.findUnique({
      where: { id },
      select: {
        id: true,
        symbol: true,
        createdAt: true,
        coordinatorPayload: true,
        outcomePayload: true,
        scoredAt: true,
        aiPayload: true,
      },
    });
    if (!row) throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);

    const analysis = row.coordinatorPayload as unknown as AnalysisRecord;

    // Excluding this row, or it is compared against itself and never goes stale.
    const shared = (await this.status.perSymbol([row.symbol], row.id)).get(row.symbol)!;
    const newest = shared.newest?.coordinatorPayload as unknown as AnalysisRecord | undefined;
    const currentPrice = shared.price;
    const freshness = analysisFreshness(
      analysis,
      currentPrice,
      newest?.map ? { map: newest.map } : null,
    );
    // One result per plan, in plan order — the detail page renders them side by side.
    const outcomes = resultsFor(row.outcomePayload, analysis.plans ?? []);

    return {
      id: row.id,
      createdAt: row.createdAt,
      currentPrice,
      freshness,
      outcomes,
      verdict: buildVerdict(analysis, freshness, outcomes as unknown as PlanResult[], currentPrice),
      narration: readNarration(row.aiPayload),
      analysis,
    };
  }

  /** Costs money the first time and nothing after, so the answer is saved. */
  @Post(':id/narrate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Write (or return) Claude's read of this analysis" })
  async narrate(@Param('id') id: string): Promise<SavedNarration> {
    const row = await this.prisma.coordinatorRun.findUnique({
      where: { id },
      select: { id: true, coordinatorPayload: true, aiPayload: true },
    });
    if (!row) throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);

    const cached = readNarration(row.aiPayload);
    if (cached) return cached;

    const analysis = row.coordinatorPayload as unknown as AnalysisRecord;

    let narration;
    try {
      narration = await this.narrator.narrate({
        map: analysis.map,
        plans: analysis.plans,
        regime: analysis.regime,
        checklists: analysis.checklists,
        regimeTimeframe: analysis.timeframes.regime,
      });
    } catch (err) {
      // The analysis is fine without it, so this is "missing", not "failed".
      throw new HttpException(
        err instanceof Error ? err.message : 'Narration failed',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const saved: SavedNarration = {
      text: narration.text,
      citedPrices: narration.citedPrices,
      model: narration.model,
      narratedAt: new Date().toISOString(),
    };

    await this.prisma.coordinatorRun.update({
      where: { id: row.id },
      data: { aiPayload: saved as unknown as Prisma.InputJsonValue, shouldInvokeAI: true },
    });

    return saved;
  }
}
