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
import { PlanOutcome, PlanResult } from './outcome';
import { OutcomeScorerService } from './outcome-scorer.service';
import { buildVerdict, leadPlan, Verdict } from './verdict';
import { AnalystNarrationService } from '../ai/analyst-narration.service';
import { TradePlan } from '../analysis/services/trade-plan.service';

/** A saved narration, stored in the `aiPayload` Json column. */
export interface SavedNarration {
  text: string;
  citedPrices: number[];
  model: string;
  narratedAt: string;
}

/**
 * What became of one analysis, for the history cards. Uses the same code as
 * the detail page, so a card can never disagree with the page it opens.
 */
export interface AnalysisStatus {
  direction: 'long' | 'short' | null;
  outcome: PlanOutcome | null;
  /** Result in R before fees. Null until the trade opens. */
  r: number | null;
  /** After fees. This is the number the scoreboard adds up. */
  netR: number | null;
  freshness: Freshness;
  /** ISO string: read back out of the stored outcome, never re-parsed. */
  filledAt: string | null;
  /** How many targets price reached, in order. */
  targetsHit: number;
  currentPrice: number;
  /**
   * When this outcome was worked out. Null means nothing has scored it yet.
   *
   * It matters for OPEN trades and only for them: their `netR` is a MARK at
   * the last close the scorer saw, so between job runs it is up to the
   * schedule's interval out of date. Every other outcome is finished and this
   * is just provenance.
   */
  scoredAt: string | null;
  /** Just the prices a card draws. The full plan is far larger and unused here. */
  plan: {
    entries: number[];
    averageEntry: number;
    stop: number;
    targets: number[];
    riskPercent: number;
    blendedR: number;
  } | null;
}

/** `aiPayload` is null until someone asks Claude to read the analysis. */
function readNarration(payload: unknown): SavedNarration | null {
  const value = payload as Partial<SavedNarration> | null;
  return typeof value?.text === 'string' ? (value as SavedNarration) : null;
}

/**
 * A plan's stored result, as it comes back out of JSONB. Identical to
 * `PlanResult` except that `filledAt` is the ISO string Postgres stored, not a
 * Date — nothing here parses it, it is passed straight back out.
 */
type StoredResult = Omit<PlanResult, 'filledAt'> & { filledAt: string | null };

/**
 * Read the stored results off a row.
 *
 * Null means the scoring job has not reached this row yet — a new analysis
 * between its POST and the write that follows, or a row whose candle window
 * could not be fetched. Both are honestly "not scored", which is the badge
 * UNSCOREABLE already carries, so that is what they get.
 */
function storedResults(payload: unknown, plans: TradePlan[]): StoredResult[] | null {
  return Array.isArray(payload) && payload.length === plans.length
    ? (payload as StoredResult[])
    : null;
}

const NOT_SCORED = (direction: 'long' | 'short'): StoredResult => ({
  direction,
  outcome: 'UNSCOREABLE',
  r: null,
  netR: null,
  filledAt: null,
  targetsHit: 0,
  legsFilled: 0,
  filledFraction: 0,
  barsHeld: 0,
});

/**
 * Analyses before this date were built by an older version of the planner that
 * had known bugs, so averaging them together with new ones describes neither.
 *
 * This is the DEFAULT start of the list, not a filter you cannot turn off:
 * `?days=` overrides it and gets exactly what it asks for, and every response
 * reports where this boundary sits. Older rows are meant to be SHOWN but left
 * out of the totals.
 *
 * TODO: a date is a rough stand-in for "which version of the code made this
 * row". The proper fix is a version column written with each analysis, which
 * needs a database migration.
 */
export const RESULTS_EPOCH = new Date('2026-08-16T00:00:00Z');

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

/**
 * The API the website and the scheduled runs both use.
 *
 *   POST /analyses?symbol=BTC   run one analysis and save it
 *   GET  /analyses              list saved analyses, newest first
 *   GET  /analyses/:id          one analysis in full
 *
 * All of it requires a login or the scheduler's key.
 */
@ApiTags('analyses')
@Controller('analyses')
export class AnalysesController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly persistence: CoordinatorPersistenceService,
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
    private readonly narrator: AnalystNarrationService,
    private readonly scorer: OutcomeScorerService,
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
    // Score it now, on this write path. Without it the row would show "Not
    // scored" until the next scheduled run — read paths no longer score
    // anything, so a row nobody has scored has nothing to show.
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
    /** The date range actually used, so nothing has to be guessed. */
    from: string;
    /**
     * Where the old-planner boundary sits. Rows older than this should be
     * shown but not counted, and the count that was left out stated.
     */
    epoch: string;
  }> {
    const where: Prisma.CoordinatorRunWhereInput = {};
    if (symbol) {
      const coin = symbol.trim().toUpperCase();
      if (!SYMBOL_PATTERN.test(coin)) {
        throw new HttpException('Invalid symbol', HttpStatus.BAD_REQUEST);
      }
      where.symbol = coin;
    }

    // Asking for a date range is honest in a way a row limit is not: a limit
    // silently drops the oldest rows and makes any total wrong.
    const windowDays = Number(days);
    const from =
      Number.isFinite(windowDays) && windowDays > 0
        ? Date.now() - windowDays * 86_400_000
        : RESULTS_EPOCH.getTime();
    where.createdAt = { gte: new Date(from) };

    // Nonsense values fall back to the default rather than being squashed to
    // 1, which would read as "there is one analysis".
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 50;
    // The full analysis is left out of the response — fifty of them is a large
    // download nobody reads. It is still loaded here to score each row.
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

    // Exactly as many rows came back as were asked for, so there may be more.
    // Say so, rather than let a total quietly describe only part of the data.
    const truncated = analyses.length === take;

    const window = { from: new Date(from).toISOString(), epoch: RESULTS_EPOCH.toISOString() };
    if (!wantStatus) return { count: analyses.length, analyses, truncated, ...window };

    const statuses = await this.statusBySymbol(analyses);
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

  /**
   * Work out how every row on the page turned out.
   *
   * ZERO candle fetching. Every outcome was scored once by OutcomeScorerService
   * and stored on the row; this reads it back. What is still worked out here is
   * only what depends on the CURRENT price — freshness — and that is one price
   * lookup per coin, not one price history per row.
   *
   * This used to fetch a 98-bar window for every row, anchored to that row's
   * own createdAt, so nothing could be shared or cached: 603 rows meant 603
   * network requests and 92% of a 32-second response.
   */
  private async statusBySymbol(
    rows: Array<{
      id: string;
      symbol: string;
      createdAt: Date;
      coordinatorPayload: unknown;
      outcomePayload: unknown;
      scoredAt: Date | null;
    }>,
  ): Promise<Map<string, AnalysisStatus>> {
    const symbols = [...new Set(rows.map((r) => r.symbol))];

    const perSymbol = new Map(
      await Promise.all(
        symbols.map(async (coin) => {
          // A failure here must not take the page down: the row still shows,
          // just without a result.
          const [price, newest] = await Promise.all([
            this.binance.getCurrentPrice(coin).catch(() => NaN),
            this.prisma.coordinatorRun.findFirst({
              where: { symbol: coin },
              orderBy: { createdAt: 'desc' },
              select: { coordinatorPayload: true },
            }),
          ]);
          return [coin, { price, newest }] as const;
        }),
      ),
    );

    const out = new Map<string, AnalysisStatus>();
    for (const row of rows) {
      const analysis = row.coordinatorPayload as AnalysisRecord | null;
      const shared = perSymbol.get(row.symbol);
      if (!analysis?.plans || !analysis?.map || !shared) continue;

      const newest = shared.newest?.coordinatorPayload as AnalysisRecord | undefined;
      const freshness = analysisFreshness(
        analysis,
        shared.price,
        newest?.map ? { map: newest.map } : null,
      );

      const lead = leadPlan(analysis.plans);
      if (!lead) {
        out.set(row.id, {
          direction: null,
          outcome: null,
          r: null,
          netR: null,
          freshness,
          filledAt: null,
          targetsHit: 0,
          currentPrice: shared.price,
          scoredAt: row.scoredAt?.toISOString() ?? null,
          plan: null,
        });
        continue;
      }

      // Only the lead plan: the card shows one line. The stored array holds one
      // result per plan in plan order, so this picks the same one the old code
      // scored on its own.
      const stored = storedResults(row.outcomePayload, analysis.plans);
      const scored = stored?.[analysis.plans.indexOf(lead)] ?? NOT_SCORED(lead.direction);

      out.set(row.id, {
        direction: scored.direction,
        outcome: scored.outcome,
        r: scored.r,
        // Taken straight from the scorer. Working it out again here is how the
        // card and the summary ended up showing two different numbers.
        netR: scored.netR,
        freshness,
        filledAt: scored.filledAt,
        targetsHit: scored.targetsHit,
        currentPrice: shared.price,
        scoredAt: row.scoredAt?.toISOString() ?? null,
        plan: {
          entries: lead.entries.map((e) => e.price),
          averageEntry: lead.averageEntry,
          stop: lead.stop,
          targets: lead.targets.map((t) => t.price),
          riskPercent: lead.riskPercent,
          blendedR: lead.blendedR,
        },
      });
    }
    return out;
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
        aiPayload: true,
      },
    });
    if (!row) {
      throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);
    }

    const analysis = row.coordinatorPayload as unknown as AnalysisRecord;

    // Both of these depend on the CURRENT price, so they cannot be stored. The
    // outcomes can, and are — no candles are fetched on this path either.
    const [currentPrice, newestRow] = await Promise.all([
      this.binance.getCurrentPrice(row.symbol),
      this.prisma.coordinatorRun.findFirst({
        where: { symbol: row.symbol, id: { not: row.id } },
        orderBy: { createdAt: 'desc' },
        select: { coordinatorPayload: true },
      }),
    ]);

    const newest = newestRow?.coordinatorPayload as unknown as AnalysisRecord | undefined;

    const freshness = analysisFreshness(
      analysis,
      currentPrice,
      newest?.map ? { map: newest.map } : null,
    );
    // One result per plan, in plan order, exactly as the page renders them.
    const outcomes =
      storedResults(row.outcomePayload, analysis.plans ?? []) ??
      (analysis.plans ?? []).map((p) => NOT_SCORED(p.direction));

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

  /**
   * A written explanation of an analysis, produced once and kept.
   *
   * Only when someone asks, not on every scheduled run — most analyses are
   * never opened. It cannot change the analysis: every number already exists
   * before this runs, and the whole text is thrown away if it quotes a price
   * that nothing computed.
   */
  @Post(':id/narrate')
  // One a minute: each call costs money and the answer is saved anyway.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Write (or return) Claude's read of this analysis" })
  async narrate(@Param('id') id: string): Promise<SavedNarration> {
    const row = await this.prisma.coordinatorRun.findUnique({
      where: { id },
      select: { id: true, coordinatorPayload: true, aiPayload: true },
    });
    if (!row) {
      throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);
    }

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
      // Whatever went wrong, the analysis itself is fine — the explanation is
      // an optional extra, so report it as missing rather than as a failure.
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
      data: {
        aiPayload: saved as unknown as Prisma.InputJsonValue,
        shouldInvokeAI: true,
      },
    });

    return saved;
  }
}
