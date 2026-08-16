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
 * What became of one analysis, for the history cards.
 *
 * Everything here is already computed elsewhere — this is the detail route's
 * work done for a whole page at once, not a second opinion. Same `leadPlan`,
 * same `scorePlans`, same `analysisFreshness`, so a card can never disagree
 * with the page it opens.
 */
export interface AnalysisStatus {
  direction: 'long' | 'short' | null;
  outcome: PlanOutcome | null;
  /** Gross R, marked to market while OPEN. Null until a fill. */
  r: number | null;
  /** After the round-trip cost — the number the scoreboard sums. */
  netR: number | null;
  freshness: Freshness;
  filledAt: Date | null;
  /** How many targets the replay reached, in order. Drives the ticks. */
  targetsHit: number;
  currentPrice: number;
  /**
   * The lead plan's geometry, projected rather than embedded. The full plan is
   * ~2.5KB and fifty of them is a response nobody reads; these eight numbers
   * are what a card draws.
   */
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
 * Outcome replay series: 1h wicks, anchored at the analysis and exactly as long
 * as the scoring window.
 *
 * It used to be "the most recent 720", which for an analysis older than 30 days
 * is a window the plan's entry was never in — the recorded fill went invisible
 * and a later touch of the same price could manufacture a new one. `+2` is slack
 * for the partially-formed bar at each end.
 */
const OUTCOME_TIMEFRAME: TimeInterval = '1h';
const OUTCOME_CANDLES = OUTCOME_WINDOW_HOURS + 2;

/**
 * The oldest analysis the list will return.
 *
 * Everything before this was produced by a planner with known bugs — the target
 * ladder weighted a one-target plan at 33% of size, and the entry checklist was
 * scored once per bar instead of per direction. Those plans are now scored
 * correctly, which is exactly the problem: a correct score of a bad plan mixes
 * two different strategies into one scoreboard and neither number means
 * anything.
 *
 * What it is NOT is a filter you cannot turn off. It sets the DEFAULT window
 * and it is reported on every response; `?days=` overrides it freely and gets
 * exactly the span it asked for. The first version of this clamped `days` to
 * the epoch, which meant no request could show the older rows and no caller
 * could tell whether they had been hidden or deleted. A boundary you cannot
 * see past is not a boundary, it is a silent deletion.
 *
 * The consumer's job is to keep those rows OUT OF THE AGGREGATE while still
 * showing them: mixing two planners in one expectancy is the actual harm, and
 * hiding the rows was never what fixed it.
 *
 * A timestamp is a proxy for "which code produced this row", and a weak one —
 * deploys are not instant and rollbacks exist. The honest version is an
 * `algoVersion` column written with each analysis. That needs a migration; if
 * this app ever has a second user, do it.
 */
export const RESULTS_EPOCH = new Date('2026-08-16T00:00:00Z');

/**
 * How many outcome windows to fetch at once.
 *
 * One Binance request per row, and `limit` goes to 1000 — firing that as a
 * single burst is how an IP gets rate-limited off the exchange. Each window is
 * a single page, so a page of 50 rows is 7 short rounds.
 */
const OUTCOME_FETCH_CONCURRENCY = 8;

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
    /** The window actually applied, so nothing about it has to be inferred. */
    from: string;
    /**
     * The planner boundary. Rows older than this were built by code with known
     * bugs: show them, do not count them, and say how many were left out.
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

    // A window is honest in a way a row cap is not: `?days=30` returns thirty
    // days or says it could not, where a bare limit of 200 silently drops the
    // oldest analyses and makes any total computed from the response wrong.
    // The epoch is the DEFAULT window, not a ceiling on what can be asked for.
    // `?days=365` returns a year, pre-epoch rows included, and the response
    // says where the boundary sits so the caller can keep them out of its
    // totals rather than out of its list.
    const windowDays = Number(days);
    const from =
      Number.isFinite(windowDays) && windowDays > 0
        ? Date.now() - windowDays * 86_400_000
        : RESULTS_EPOCH.getTime();
    where.createdAt = { gte: new Date(from) };

    // Anything not a positive number falls back to the default. Clamping
    // instead would turn `?limit=-5` into a single row, which reads as "there
    // is one analysis" rather than "that limit was nonsense".
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 50;
    // Payload deliberately excluded from the RESPONSE — a list of 50 full
    // level maps is a large body nobody reads. `?status=true` still reads it
    // server-side to score each row; at ~3.5KB a payload that is 180KB for
    // every analysis ever run, so the read is not the expensive part.
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

    // The caller asked for a window and got exactly `take` rows back, so there
    // may be more it cannot see. Say so rather than let a scoreboard built on
    // this response quietly describe a subset.
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
   * Score every row on the page.
   *
   * The price and the newest-analysis lookup are per SYMBOL and shared. The
   * REPLAY SERIES is not: each analysis is scored against the window that
   * starts at that analysis, so it is one fetch per row.
   *
   * That is more requests than the single shared series it replaces, and it is
   * the price of the badge being right — a shared "most recent 720" cannot
   * serve rows taken weeks apart. Each window is small (98 bars) and cached by
   * (symbol, start, length), so repeated loads of the same page are free.
   */
  private async statusBySymbol(
    rows: Array<{ id: string; symbol: string; createdAt: Date; coordinatorPayload: unknown }>,
  ): Promise<Map<string, AnalysisStatus>> {
    const symbols = [...new Set(rows.map((r) => r.symbol))];
    const now = Date.now();

    const perSymbol = new Map(
      await Promise.all(
        symbols.map(async (coin) => {
          // A failure here must not take the page down: a coin Binance cannot
          // serve loses its status, not its row.
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

    // One window per row, in bounded batches. A row whose candles cannot be
    // fetched scores UNSCOREABLE rather than being scored against someone
    // else's window.
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

      // Score only the lead plan — the card shows one line, and scoring both
      // then discarding one is work for a number nobody reads.
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
        // Straight from the scorer, which charges the round trip on the size
        // actually acquired. Re-deriving it here is what let the card and the
        // verdict print two different numbers for one trade.
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
      // intraday is not missed by a coarser candle. Anchored at the analysis,
      // not at now — see OUTCOME_CANDLES.
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
    // Strictly after the analysis: a candle already forming when it was taken
    // must not be allowed to "fill" a plan retroactively.
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
   * Claude's read of an analysis, written once and kept.
   *
   * On demand rather than on every scheduled run: at thirty analyses a day
   * that is thirty model calls for the two or three anyone opens. The result
   * is cached in `aiPayload`, so a second visit costs nothing and the text
   * never changes under you.
   *
   * Narration cannot alter the analysis. Every number was computed before
   * this runs, and `PriceProvenanceError` discards the whole text if Claude
   * cites a price nothing produced — a missing read is strictly better than
   * an invented level.
   */
  @Post(':id/narrate')
  // One a minute: each call is a paid model request, and the answer is cached
  // anyway, so there is no legitimate reason to hammer it.
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
      // A missing key, a refusal, or an invented price. All three mean "no
      // narration", and none of them says anything about the analysis — so
      // report it as the optional extra it is, not as a broken analysis.
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
