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
import { costR, PlanOutcome, PlanResult, scorePlans } from './outcome';
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
  ): Promise<{ count: number; analyses: unknown[]; truncated: boolean }> {
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
    const windowDays = Number(days);
    if (Number.isFinite(windowDays) && windowDays > 0) {
      where.createdAt = { gte: new Date(Date.now() - windowDays * 86_400_000) };
    }

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

    if (!wantStatus) return { count: analyses.length, analyses, truncated };

    const statuses = await this.statusBySymbol(analyses);
    return {
      count: analyses.length,
      truncated,
      analyses: analyses.map(({ coordinatorPayload, ...row }) => ({
        ...row,
        status: statuses.get(row.id) ?? null,
      })),
    };
  }

  /**
   * Score every row on the page.
   *
   * The expensive inputs are per SYMBOL, not per analysis: the live price, the
   * candles to replay against, and whichever analysis is newest for that coin.
   * Fifty-three rows across ten coins is ten price calls and ten candle calls,
   * shared — which is why a status column is affordable at all and opening
   * fifty-three detail pages is not.
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
          const [price, candles, newest] = await Promise.all([
            this.binance.getCurrentPrice(coin).catch(() => NaN),
            this.binance
              .getCandlesPaged(coin, OUTCOME_TIMEFRAME, OUTCOME_CANDLES)
              .catch(() => [] as Candle[]),
            this.prisma.coordinatorRun.findFirst({
              where: { symbol: coin },
              orderBy: { createdAt: 'desc' },
              select: { coordinatorPayload: true },
            }),
          ]);
          return [coin, { price, candles, newest }] as const;
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
          plan: null,
        });
        continue;
      }

      // Score only the lead plan — the card shows one line, and scoring both
      // then discarding one is work for a number nobody reads.
      const [scored] = scorePlans(
        [lead],
        shared.candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
        row.createdAt,
        now,
      );

      out.set(row.id, {
        direction: scored.direction,
        outcome: scored.outcome,
        r: scored.r,
        netR: scored.r === null ? null : scored.r - costR(lead.riskPercent),
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
      // intraday is not missed by a coarser candle. 720 = 30 days, which is
      // well past the 24h in which every backtested fill happened.
      this.binance
        .getCandlesPaged(row.symbol, OUTCOME_TIMEFRAME, OUTCOME_CANDLES)
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
