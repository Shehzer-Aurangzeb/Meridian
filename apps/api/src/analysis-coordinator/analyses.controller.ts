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
import { AnalysesStats, AnalysisStatsService } from './analysis-stats.service';
import { Bucket, BUCKETS, bucketWhere } from './buckets';
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

/**
 * Rows per page. 20 because that is what the history page renders before you
 * scroll; asking for more ships bytes nobody reads. The 1000 ceiling stays for
 * the dashboard, which still counts rows in one go.
 */
const DEFAULT_PAGE = 20;

/** Nonsense limits fall back to the default rather than clamping to 1 row. */
function pageSize(limit: string | undefined): number {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : DEFAULT_PAGE;
}

/**
 * A place in the list: a timestamp plus an id.
 *
 * The id is not decoration. Three analyses are saved in the same batch and can
 * share a `createdAt` to the millisecond; without a tiebreak the page boundary
 * lands in the middle of them and a row is repeated or skipped.
 */
function encodeCursor(row: { createdAt: Date; netR: number | null; id: string }, sort: SortKey): string {
  const value = SORTS[sort].field === 'netR' ? String(row.netR) : row.createdAt.toISOString();
  return `${value}_${row.id}`;
}

/** Everything strictly past the cursor, in whatever order the list is using. */
function afterCursor(raw: string, sort: SortKey): Prisma.CoordinatorRunWhereInput {
  const at = raw.indexOf('_');
  const id = raw.slice(at + 1);
  const { field, dir } = SORTS[sort];
  const raw0 = raw.slice(0, at);
  const value: Date | number = field === 'netR' ? Number(raw0) : new Date(raw0);
  const bad =
    at < 0 || !id || (value instanceof Date ? Number.isNaN(value.getTime()) : Number.isNaN(value));
  if (bad) throw new HttpException('Invalid cursor', HttpStatus.BAD_REQUEST);

  // Past the cursor's value, OR level with it but past its id.
  const past = dir === 'desc' ? { lt: value } : { gt: value };
  const tie = dir === 'desc' ? { lt: id } : { gt: id };
  return { OR: [{ [field]: past }, { [field]: value, id: tie }] };
}

/**
 * How the list is ordered, and what a cursor therefore means.
 *
 * `best`/`worst` only include rows that HAVE an R. Sorting 145 rows with no
 * plan by their result is meaningless, and it keeps the cursor free of nulls.
 */
const SORTS = {
  newest: { dir: 'desc', field: 'createdAt' },
  oldest: { dir: 'asc', field: 'createdAt' },
  best: { dir: 'desc', field: 'netR' },
  worst: { dir: 'asc', field: 'netR' },
} as const;

export type SortKey = keyof typeof SORTS;

function orderFor(sort: SortKey): Prisma.CoordinatorRunOrderByWithRelationInput[] {
  const { field, dir } = SORTS[sort];
  return [{ [field]: dir }, { id: dir }];
}

/**
 *   POST /analyses?symbol=BTC   run one analysis and save it
 *   GET  /analyses              one page of analyses, newest first
 *   GET  /analyses/stats        counts and net R across the whole window
 *   GET  /analyses/:id          one analysis in full
 *   POST /analyses/:id/narrate  write (or return) Claude's read of it
 *
 * `stats` is declared before `:id` on purpose — Nest matches in order, and the
 * other way round every request for it reads an analysis called "stats".
 */
@ApiTags('analyses')
@Controller('analyses')
export class AnalysesController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly persistence: CoordinatorPersistenceService,
    private readonly prisma: PrismaService,
    private readonly status: AnalysisStatusService,
    private readonly statsService: AnalysisStatsService,
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

  /** The filters both the list and the scoreboard share. */
  private windowWhere(symbol?: string, days?: string): Prisma.CoordinatorRunWhereInput {
    const where: Prisma.CoordinatorRunWhereInput = { createdAt: { gte: windowStart(days) } };
    if (symbol) {
      const coin = validSymbol(symbol);
      if (!coin) throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);
      where.symbol = coin;
    }
    return where;
  }

  @Get()
  @ApiOperation({ summary: 'One page of saved analyses, newest first' })
  async list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('days') days?: string,
    @Query('cursor') cursor?: string,
    @Query('bucket') bucket?: string,
    @Query('sort') sort?: string,
  ): Promise<{
    count: number;
    analyses: unknown[];
    /** Pass back as `?cursor=` for the next page. Null when there are no more. */
    nextCursor: string | null;
    from: string;
    epoch: string;
  }> {
    const from = windowStart(days);
    const where = this.windowWhere(symbol, days);
    const take = pageSize(limit);

    if (sort && !(sort in SORTS)) {
      throw new HttpException('Unknown sort', HttpStatus.BAD_REQUEST);
    }
    const order = (sort ?? 'newest') as SortKey;

    // Filtering happens in SQL, not in the browser: with paging, a filter
    // applied after the fact only ever sees the page it was given.
    const filters: Prisma.CoordinatorRunWhereInput[] = [];
    if (bucket && bucket !== 'all') {
      if (!BUCKETS.includes(bucket as Bucket)) {
        throw new HttpException('Unknown bucket', HttpStatus.BAD_REQUEST);
      }
      filters.push(bucketWhere(bucket as Bucket));
    }
    // Ranking by result is meaningless for a row that never opened.
    if (SORTS[order].field === 'netR') filters.push({ netR: { not: null } });
    if (cursor) filters.push(afterCursor(cursor, order));
    if (filters.length > 0) where.AND = filters;

    const wantStatus = status === 'true' || status === '1';
    if (wantStatus) await this.scorer.refreshOpen();

    // One extra row, purely to learn whether another page exists.
    const rows = await this.prisma.coordinatorRun.findMany({
      where,
      orderBy: orderFor(order),
      take: take + 1,
      select: {
        id: true,
        netR: true,
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

    const page = rows.slice(0, take);
    const nextCursor =
      rows.length > take && page.length > 0 ? encodeCursor(page[page.length - 1], order) : null;
    const window = { from: from.toISOString(), epoch: RESULTS_EPOCH.toISOString() };

    if (!wantStatus) {
      return {
        count: page.length,
        analyses: page.map(({ netR, ...row }) => row),
        nextCursor,
        ...window,
      };
    }

    const statuses = await this.status.build(page);
    return {
      count: page.length,
      nextCursor,
      ...window,
      analyses: page.map(({ coordinatorPayload, outcomePayload, scoredAt, netR, ...row }) => ({
        ...row,
        status: statuses.get(row.id) ?? null,
      })),
    };
  }

  /**
   * The scoreboard, over the WHOLE window rather than the page on screen.
   *
   * Separate from the list so the numbers appear without waiting for rows, and
   * so a page of 20 does not have to become a page of 603 to be counted.
   */
  @Get('stats')
  @ApiOperation({ summary: 'Counts and net R across every analysis in the window' })
  async stats(
    @Query('symbol') symbol?: string,
    @Query('days') days?: string,
  ): Promise<AnalysesStats> {
    await this.scorer.refreshOpen();
    return this.statsService.build(
      this.windowWhere(symbol, days),
      RESULTS_EPOCH,
      windowStart(days),
    );
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
