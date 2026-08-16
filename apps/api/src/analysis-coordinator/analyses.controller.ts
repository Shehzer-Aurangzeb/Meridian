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
import {
  OUTCOME_WINDOW_HOURS,
  PlanOutcome,
  PlanResult,
  scorePlans,
} from './outcome';
import { buildVerdict, leadPlan, Verdict } from './verdict';
import { AnalystNarrationService } from '../ai/analyst-narration.service';
import { Candle, TimeInterval } from '../common/types/candle.types';

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
  filledAt: Date | null;
  /** How many targets price reached, in order. */
  targetsHit: number;
  currentPrice: number;
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
 * The price history each analysis is judged against: hourly bars starting at
 * the analysis itself, long enough to cover the fill and hold windows. The
 * extra 2 bars allow for the part-formed hour at each end.
 */
const OUTCOME_TIMEFRAME: TimeInterval = '1h';
const OUTCOME_CANDLES = OUTCOME_WINDOW_HOURS + 2;

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

/**
 * How many price-history requests to send at once. Each row needs its own, and
 * a page can hold up to 1000 — sending them all together gets the exchange to
 * block us.
 */
const OUTCOME_FETCH_CONCURRENCY = 8;

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
      analyses: analyses.map(({ coordinatorPayload, ...row }) => ({
        ...row,
        status: statuses.get(row.id) ?? null,
      })),
    };
  }

  /**
   * Work out how every row on the page turned out.
   *
   * The current price is looked up once per coin. The price HISTORY cannot be
   * shared, because each analysis is judged from its own moment in time — so
   * that is one request per row. They are small and cached.
   */
  private async statusBySymbol(
    rows: Array<{ id: string; symbol: string; createdAt: Date; coordinatorPayload: unknown }>,
  ): Promise<Map<string, AnalysisStatus>> {
    const symbols = [...new Set(rows.map((r) => r.symbol))];
    const now = Date.now();

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

    // One history request per row, a few at a time. A row whose history cannot
    // be loaded is marked unscoreable rather than judged against the wrong
    // stretch of time.
    const perRow = new Map<string, Candle[]>();
    for (let i = 0; i < rows.length; i += OUTCOME_FETCH_CONCURRENCY) {
      const batch = await Promise.all(
        rows.slice(i, i + OUTCOME_FETCH_CONCURRENCY).map(async (row) => {
          const candles = await this.binance
            .getCandlesFrom(
              row.symbol,
              OUTCOME_TIMEFRAME,
              row.createdAt.getTime(),
              OUTCOME_CANDLES,
            )
            .catch(() => [] as Candle[]);
          return [row.id, candles] as const;
        }),
      );
      for (const [id, candles] of batch) perRow.set(id, candles);
    }

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
          plan: null,
        });
        continue;
      }

      // Only the lead plan: the card shows one line.
      const [scored] = scorePlans(
        [lead],
        (perRow.get(row.id) ?? []).filter(
          (c) => c.time.getTime() > row.createdAt.getTime(),
        ),
        row.createdAt,
        now,
      );

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
    outcomes: PlanResult[];
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
        aiPayload: true,
      },
    });
    if (!row) {
      throw new HttpException('Analysis not found', HttpStatus.NOT_FOUND);
    }

    const analysis = row.coordinatorPayload as unknown as AnalysisRecord;

    // Everything the page needs, fetched together: the current price, the
    // newest analysis for this coin, and the price history since this one.
    const [currentPrice, newestRow, candles] = await Promise.all([
      this.binance.getCurrentPrice(row.symbol),
      this.prisma.coordinatorRun.findFirst({
        where: { symbol: row.symbol, id: { not: row.id } },
        orderBy: { createdAt: 'desc' },
        select: { coordinatorPayload: true },
      }),
      // Hourly bars, so a stop or target touched during the day is not missed.
      // Starting at the analysis, not at now.
      this.binance
        .getCandlesFrom(
          row.symbol,
          OUTCOME_TIMEFRAME,
          row.createdAt.getTime(),
          OUTCOME_CANDLES,
        )
        .catch(() => [] as Candle[]),
    ]);

    const newest = newestRow?.coordinatorPayload as unknown as AnalysisRecord | undefined;

    const freshness = analysisFreshness(
      analysis,
      currentPrice,
      newest?.map ? { map: newest.map } : null,
    );
    // Strictly after the analysis: the hour already in progress when it was
    // taken must not be allowed to open the trade after the fact.
    const outcomes = scorePlans(
      analysis.plans,
      candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
      row.createdAt,
      Date.now(),
    );

    return {
      id: row.id,
      createdAt: row.createdAt,
      currentPrice,
      freshness,
      outcomes,
      verdict: buildVerdict(analysis, freshness, outcomes, currentPrice),
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
