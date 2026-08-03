import { Injectable, Logger } from '@nestjs/common';
import { CoordinatorRun, TradeAnalysis } from '@prisma/client';
import { BinanceService } from '../market-data/market-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { Candle, TimeInterval } from '../common/types/candle.types';
import {
  ClaudeAnalysisResponse,
  ClaudeTradeAnalysis,
  isTradeSignal,
} from '../ai/interfaces/claude-response.types';

export type AnalysisStatus = 'correct' | 'failed' | 'pending' | 'neutral';

/**
 * Lifecycle status assigned to a CoordinatorRun by `evaluateCoordinatorRuns`.
 *
 *  PENDING_FILL     limit entry not yet hit; TTL window still open
 *  EXPIRED_UNFILLED TTL elapsed before entry was touched         → write-off
 *  OPEN             entry filled, neither SL nor TP1 reached     → in-flight
 *  TARGET_HIT       entry filled and TP1 reached                 → 'correct'
 *  STOPPED_OUT      entry filled and SL reached                  → 'failed'
 */
export type CoordinatorRunStatus =
  | 'PENDING_FILL'
  | 'EXPIRED_UNFILLED'
  | 'OPEN'
  | 'TARGET_HIT'
  | 'STOPPED_OUT';

export interface CoordinatorRunEvaluation {
  id: string;
  symbol: string;
  timeframe: string;
  action: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  createdAt: Date;
  expiresAt: Date | null;
  entryFilledAt: Date | null;
  status: CoordinatorRunStatus;
  /** UI-friendly bucket aligned with the legacy AnalysisStatus contract. */
  performanceStatus: AnalysisStatus;
}

export interface AnalysisWithPerformance extends TradeAnalysis {
  currentPrice: number | null;
  status: AnalysisStatus;
  priceChange: number | null;
  priceChangePercent: number | null;
}

export interface WinRateStats {
  winRate: number;
  totalAnalyzed: number;
  correct: number;
  failed: number;
  pending: number;
  neutral: number;
}

/**
 * Whitelist of Binance kline intervals this evaluator understands. Any
 * `CoordinatorRun.timeframe` value outside this set is skipped (status
 * pinned to the run's current state, no kline fetch attempted).
 */
const SUPPORTED_TIMEFRAMES: ReadonlySet<TimeInterval> = new Set<TimeInterval>([
  '15m',
  '1h',
  '4h',
  '1d',
]);

/**
 * Candle pull size for the evaluation window. 500 candles covers the
 * widest TTL/timeframe combination we use (1d × 7 days = 7 candles, 1h ×
 * 12 hours = 12 candles, 4h × 48 hours = 12 candles, 15m × 4 hours = 16
 * candles) plus comfortable headroom for filled positions trading out.
 */
const CANDLE_FETCH_LIMIT = 500;

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private readonly MINIMUM_AGE_HOURS = 1;

  constructor(
    private readonly binanceService: BinanceService,
    private readonly prisma: PrismaService,
  ) {}

  async calculatePerformance(
    analyses: TradeAnalysis[],
  ): Promise<AnalysisWithPerformance[]> {
    if (analyses.length === 0) {
      return [];
    }

    // ─── Batch price resolution ──────────────────────────────────────
    // Deduplicate coins so we issue at most one network call per symbol,
    // then resolve them all concurrently. A rejected fetch maps to
    // `null` so a single failing symbol cannot fail the whole batch.
    const uniqueCoins = [...new Set(analyses.map((a) => a.coin))];

    const priceResults = await Promise.all(
      uniqueCoins.map((coin) =>
        this.binanceService
          .getCurrentPrice(coin)
          .then((price) => [coin, price] as const)
          .catch(() => [coin, null] as const),
      ),
    );

    const priceMap = new Map<string, number | null>(priceResults);

    // ─── O(1) lookup per analysis — no I/O inside the loop ───────────
    return analyses.map((analysis) => {
      const currentPrice = priceMap.get(analysis.coin) ?? null;

      const status = this.determineStatus(analysis, currentPrice);
      const priceChange =
        currentPrice !== null ? currentPrice - analysis.priceAtAnalysis : null;
      const priceChangePercent =
        currentPrice !== null && analysis.priceAtAnalysis > 0
          ? ((currentPrice - analysis.priceAtAnalysis) /
              analysis.priceAtAnalysis) *
            100
          : null;

      return {
        ...analysis,
        currentPrice,
        status,
        priceChange,
        priceChangePercent,
      };
    });
  }

  private determineStatus(
    analysis: TradeAnalysis,
    currentPrice: number | null,
  ): AnalysisStatus {
    if (analysis.suggestion === 'WAIT') {
      return 'neutral';
    }

    const ageInHours =
      (Date.now() - new Date(analysis.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < this.MINIMUM_AGE_HOURS) {
      return 'pending';
    }

    if (currentPrice === null) {
      return 'pending';
    }

    if (analysis.suggestion === 'LONG') {
      if (currentPrice < analysis.stopLoss) {
        return 'failed';
      }
      return currentPrice >= analysis.entryPrice ? 'correct' : 'failed';
    }

    if (analysis.suggestion === 'SHORT') {
      if (currentPrice > analysis.stopLoss) {
        return 'failed';
      }
      return currentPrice <= analysis.entryPrice ? 'correct' : 'failed';
    }

    return 'neutral';
  }

  calculateWinRate(analysesWithPerformance: AnalysisWithPerformance[]): WinRateStats {
    let correct = 0;
    let failed = 0;
    let pending = 0;
    let neutral = 0;

    for (const analysis of analysesWithPerformance) {
      switch (analysis.status) {
        case 'correct':
          correct++;
          break;
        case 'failed':
          failed++;
          break;
        case 'pending':
          pending++;
          break;
        case 'neutral':
          neutral++;
          break;
      }
    }

    const totalAnalyzed = correct + failed;
    const winRate = totalAnalyzed > 0 ? (correct / totalAnalyzed) * 100 : 0;

    return {
      winRate: Math.round(winRate * 10) / 10,
      totalAnalyzed,
      correct,
      failed,
      pending,
      neutral,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  //  Smart-TTL CoordinatorRun evaluator
  // ════════════════════════════════════════════════════════════════════

  /**
   * Walk every actionable (LONG/SHORT) CoordinatorRun for `symbol` and
   * resolve its lifecycle status against historical candles.
   *
   * Two-phase pipeline per run:
   *   1. **Fill detection** — if `entryFilledAt` is null, scan candles in
   *      `[createdAt, min(now, expiresAt)]` for the first wick that
   *      crosses `entryPrice`. If found, persist `entryFilledAt`. If not
   *      and the TTL has elapsed, the run is flagged `EXPIRED_UNFILLED`.
   *   2. **Outcome detection** — once filled (either previously or just
   *      now), continue scanning from `entryFilledAt` onward. First wick
   *      that touches SL → `STOPPED_OUT`; first wick that touches TP1 →
   *      `TARGET_HIT`. Until either fires, the run stays `OPEN`.
   *
   * Candles are fetched once per run on the run's own timeframe and
   * filtered in-memory — `BinanceService.getCandles` doesn't accept a
   * time-window, so we pull a bounded window of recent candles and slice
   * it locally. A run with an unsupported timeframe, an unparseable
   * aiPayload, or no available klines is left in its existing state
   * (PENDING_FILL or OPEN).
   */
  async evaluateCoordinatorRuns(
    symbol: string,
  ): Promise<CoordinatorRunEvaluation[]> {
    const normalizedSymbol = symbol.toUpperCase().trim();

    const runs = await this.prisma.coordinatorRun.findMany({
      where: {
        symbol: normalizedSymbol,
        aiAction: { in: ['LONG', 'SHORT'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (runs.length === 0) {
      return [];
    }

    return Promise.all(runs.map((run) => this.evaluateSingleRun(run)));
  }

  private async evaluateSingleRun(
    run: CoordinatorRun,
  ): Promise<CoordinatorRunEvaluation> {
    // ── Extract the trade spec (entry / SL / TP1) from aiPayload ─────
    const trade = this.extractTradeAnalysis(run.aiPayload);
    if (!trade) {
      this.logger.warn(
        `Skipping run ${run.id} | reason=aiPayload missing or not a trade signal`,
      );
      return this.buildEvaluation(run, null, 'PENDING_FILL');
    }

    const entryPrice = trade.entry.price;
    const stopLoss = trade.stopLoss.price;
    const takeProfit1 = trade.takeProfit.tp1.price;

    if (
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(stopLoss) ||
      !Number.isFinite(takeProfit1)
    ) {
      this.logger.warn(
        `Skipping run ${run.id} | reason=non-finite entry/SL/TP price`,
      );
      return this.buildEvaluation(run, trade, 'PENDING_FILL');
    }

    // ── Timeframe must map to a Binance interval we can fetch ────────
    const interval = run.timeframe as TimeInterval;
    if (!SUPPORTED_TIMEFRAMES.has(interval)) {
      this.logger.debug(
        `Skipping run ${run.id} | reason=unsupported timeframe '${run.timeframe}'`,
      );
      return this.buildEvaluation(
        run,
        trade,
        run.entryFilledAt ? 'OPEN' : 'PENDING_FILL',
      );
    }

    // ── Candles (single fetch, filtered in-memory) ───────────────────
    let candles: Candle[];
    try {
      candles = await this.binanceService.getCandles(
        run.symbol,
        interval,
        CANDLE_FETCH_LIMIT,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Candle fetch failed for run ${run.id} (${run.symbol} ${interval}) | ${message}`,
      );
      return this.buildEvaluation(
        run,
        trade,
        run.entryFilledAt ? 'OPEN' : 'PENDING_FILL',
      );
    }

    const now = Date.now();
    const createdAtMs = run.createdAt.getTime();
    const expiresAtMs = run.expiresAt?.getTime() ?? null;

    // ── Phase 1: fill detection (only if not already filled) ─────────
    let entryFilledAt: Date | null = run.entryFilledAt;

    if (entryFilledAt === null) {
      const fillWindowEnd =
        expiresAtMs !== null ? Math.min(now, expiresAtMs) : now;
      const fillCandidates = candles.filter((c) => {
        const t = c.time.getTime();
        return t >= createdAtMs && t <= fillWindowEnd;
      });

      const firstFill = this.findFirstFillCandle(
        fillCandidates,
        trade.action,
        entryPrice,
      );

      if (firstFill) {
        entryFilledAt = firstFill.time;
        await this.persistEntryFilledAt(run.id, entryFilledAt);
      } else if (expiresAtMs !== null && now > expiresAtMs) {
        // Window closed without a fill → terminal EXPIRED_UNFILLED.
        return this.buildEvaluation(run, trade, 'EXPIRED_UNFILLED', {
          entryPrice,
          stopLoss,
          takeProfit1,
          entryFilledAt: null,
        });
      } else {
        // Still inside the TTL window — keep waiting.
        return this.buildEvaluation(run, trade, 'PENDING_FILL', {
          entryPrice,
          stopLoss,
          takeProfit1,
          entryFilledAt: null,
        });
      }
    }

    // ── Phase 2: outcome detection on filled position ────────────────
    // TTL constraint is dropped here on purpose — once the entry is hit
    // the trade is live until it touches SL or TP, regardless of TTL.
    const filledAtMs = entryFilledAt.getTime();
    const outcomeCandles = candles.filter(
      (c) => c.time.getTime() >= filledAtMs,
    );

    const outcome = this.findFirstOutcomeCandle(
      outcomeCandles,
      trade.action,
      stopLoss,
      takeProfit1,
    );

    return this.buildEvaluation(run, trade, outcome, {
      entryPrice,
      stopLoss,
      takeProfit1,
      entryFilledAt,
    });
  }

  /**
   * First candle in `candles` whose wick crosses the limit-entry price
   * for the given action. LONG fills require `low <= entryPrice`; SHORT
   * fills require `high >= entryPrice`.
   */
  private findFirstFillCandle(
    candles: Candle[],
    action: 'LONG' | 'SHORT',
    entryPrice: number,
  ): Candle | null {
    for (const c of candles) {
      if (action === 'LONG' && c.low <= entryPrice) return c;
      if (action === 'SHORT' && c.high >= entryPrice) return c;
    }
    return null;
  }

  /**
   * Walk post-fill candles in chronological order; first wick to touch
   * SL or TP1 wins. When the same candle straddles both levels we treat
   * it conservatively as `STOPPED_OUT` (no intra-candle ordering
   * information available from the kline payload).
   */
  private findFirstOutcomeCandle(
    candles: Candle[],
    action: 'LONG' | 'SHORT',
    stopLoss: number,
    takeProfit1: number,
  ): 'TARGET_HIT' | 'STOPPED_OUT' | 'OPEN' {
    for (const c of candles) {
      if (action === 'LONG') {
        const hitSL = c.low <= stopLoss;
        const hitTP = c.high >= takeProfit1;
        if (hitSL) return 'STOPPED_OUT';
        if (hitTP) return 'TARGET_HIT';
      } else {
        const hitSL = c.high >= stopLoss;
        const hitTP = c.low <= takeProfit1;
        if (hitSL) return 'STOPPED_OUT';
        if (hitTP) return 'TARGET_HIT';
      }
    }
    return 'OPEN';
  }

  private async persistEntryFilledAt(
    runId: string,
    filledAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.coordinatorRun.update({
        where: { id: runId },
        data: { entryFilledAt: filledAt },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(
        `Failed to persist entryFilledAt for run ${runId} | ${message}`,
      );
    }
  }

  /**
   * Runtime-safe narrowing of `aiPayload` (Prisma JsonValue) into a
   * `ClaudeTradeAnalysis`. Returns null for null / WAIT / malformed
   * payloads — callers treat that as "skip".
   */
  private extractTradeAnalysis(
    aiPayload: CoordinatorRun['aiPayload'],
  ): ClaudeTradeAnalysis | null {
    if (aiPayload === null || typeof aiPayload !== 'object') {
      return null;
    }
    const candidate = aiPayload as unknown as ClaudeAnalysisResponse;
    if (!isTradeSignal(candidate)) {
      return null;
    }
    if (
      typeof candidate.entry?.price !== 'number' ||
      typeof candidate.stopLoss?.price !== 'number' ||
      typeof candidate.takeProfit?.tp1?.price !== 'number'
    ) {
      return null;
    }
    return candidate;
  }

  private buildEvaluation(
    run: CoordinatorRun,
    trade: ClaudeTradeAnalysis | null,
    status: CoordinatorRunStatus,
    overrides?: {
      entryPrice?: number;
      stopLoss?: number;
      takeProfit1?: number;
      entryFilledAt?: Date | null;
    },
  ): CoordinatorRunEvaluation {
    return {
      id: run.id,
      symbol: run.symbol,
      timeframe: run.timeframe,
      action: (trade?.action ?? (run.aiAction as 'LONG' | 'SHORT')) ?? 'LONG',
      entryPrice: overrides?.entryPrice ?? trade?.entry.price ?? Number.NaN,
      stopLoss: overrides?.stopLoss ?? trade?.stopLoss.price ?? Number.NaN,
      takeProfit1:
        overrides?.takeProfit1 ?? trade?.takeProfit.tp1.price ?? Number.NaN,
      createdAt: run.createdAt,
      expiresAt: run.expiresAt,
      entryFilledAt: overrides?.entryFilledAt ?? run.entryFilledAt,
      status,
      performanceStatus: this.mapCoordinatorStatus(status),
    };
  }

  /** Collapse the rich lifecycle status onto the legacy 4-state union. */
  private mapCoordinatorStatus(status: CoordinatorRunStatus): AnalysisStatus {
    switch (status) {
      case 'TARGET_HIT':
        return 'correct';
      case 'STOPPED_OUT':
      case 'EXPIRED_UNFILLED':
        return 'failed';
      case 'PENDING_FILL':
      case 'OPEN':
        return 'pending';
    }
  }
}
