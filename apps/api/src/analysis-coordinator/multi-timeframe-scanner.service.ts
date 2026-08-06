import { Injectable, Logger } from '@nestjs/common';

import { ClaudeService } from '../ai/ai.service';
import {
  ClaudeAnalysisResponse,
  ClaudeTradeAnalysis,
  isTradeSignal,
} from '../ai/interfaces/claude-response.types';
import { LeverageService } from '../risk-management/services/leverage.service';
import { PositionSizingService } from '../risk-management/services/position-sizing.service';
import { AnalysisCoordinatorService } from './analysis-coordinator.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import {
  ExecutionHorizon,
  MacroBias,
  MultiTimeframeScanResult,
  PortfolioScanDto,
  RiskProfile,
} from './dto/portfolio-scan.dto';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';

/**
 * Smart-TTL mapping: how long a signal on a given execution timeframe is
 * considered actionable before it should be re-scanned. Tuned to roughly
 * 4-8 candles of that timeframe.
 */
const TTL_BY_TIMEFRAME_MS: Record<'15m' | '1h' | '4h' | '1d', number> = {
  '15m': 4 * 60 * 60 * 1000,        //  4h
  '1h': 12 * 60 * 60 * 1000,        // 12h
  '4h': 48 * 60 * 60 * 1000,        // 48h
  '1d': 7 * 24 * 60 * 60 * 1000,    //  7d
};

/**
 * Default risk parameters used by the scanner when sizing a position from a
 * Claude trade signal. Aligned with Miraj's 1-2% per-trade rule and the
 * existing `LeverageService` heuristics.
 */
/**
 * How many of the five conditions a horizon must meet before the scanner
 * spends a Claude call on it.
 *
 * This is the SCANNER'S cost policy, not a verdict from the pipeline. The
 * coordinator no longer decides whether an analysis is worth having — it
 * describes, and callers choose what to pay for. The scanner needs a cap
 * because it runs three coordinator passes per coin and would otherwise
 * make a Claude call for every one.
 *
 * Deliberately owned here so it is visibly a budget decision. Set to 0 to
 * narrate every scan.
 */
const SCANNER_MIN_CONDITIONS = 3;

const SCANNER_RISK_DEFAULTS = {
  riskPercentage: 1.5,
  experienceLevel: 'intermediate' as const,
  riskTolerance: 'moderate' as const,
};

/**
 * MultiTimeframeScannerService
 *
 * Aggregate scanner layered on top of the single-timeframe
 * `AnalysisCoordinatorService`. Runs three coordinator passes in parallel
 * (1d / 4h / 1h), distils:
 *
 *  - **Macro bias** from the 1d pass (the directional anchor).
 *  - **Execution horizon** preferring the 1h pass, falling back to 4h.
 *  - **AI insight** by re-using the coordinator payload on the chosen
 *    execution timeframe whenever the scanner deems it worth narrating.
 *  - **Risk profile** sized against `walletBalance` whenever Claude
 *    returns an actionable LONG/SHORT.
 *
 * If neither sub-daily horizon meets the entry gate, the scanner
 * short-circuits before touching Claude / risk to avoid wasting AI tokens
 * on non-trades.
 */
@Injectable()
export class MultiTimeframeScannerService {
  private readonly logger = new Logger(MultiTimeframeScannerService.name);

  constructor(
    private readonly coordinator: AnalysisCoordinatorService,
    private readonly claudeService: ClaudeService,
    private readonly positionSizing: PositionSizingService,
    private readonly leverageService: LeverageService,
    private readonly persistence: CoordinatorPersistenceService,
  ) {}

  // ════════════════════════════════════════════════════════════════════
  //  Public entry point
  // ════════════════════════════════════════════════════════════════════

  async scanAssetWithRisk(
    dto: PortfolioScanDto,
  ): Promise<MultiTimeframeScanResult> {
    const startedAt = Date.now();
    const { coin, walletBalance } = dto;
    this.logger.log(
      `Scanner start | coin=${coin} | walletBalance=${walletBalance}`,
    );

    // ── 1. Parallel coordinator passes across the three timeframes ────
    const [macroResult, structureResult, entryResult] = await Promise.all([
      this.coordinator.analyzeAsset(coin, '1d'),
      this.coordinator.analyzeAsset(coin, '4h'),
      this.coordinator.analyzeAsset(coin, '1h'),
    ]);

    // ── 2. Distil macro bias from the 1d pass ─────────────────────────
    const macroBias = this.deriveMacroBias(macroResult);

    // ── 3. Pick the execution horizon (1h preferred, 4h fallback) ─────
    const entryHorizon = this.buildExecutionHorizon(entryResult, '1h');
    const structureHorizon = this.buildExecutionHorizon(structureResult, '4h');

    const isActive = (h: ExecutionHorizon): boolean => h.worthNarrating;

    let executionHorizon: ExecutionHorizon;
    let executionPayload: CoordinatorAnalysisResult;

    if (isActive(entryHorizon)) {
      executionHorizon = entryHorizon;
      executionPayload = entryResult;
    } else if (isActive(structureHorizon)) {
      executionHorizon = structureHorizon;
      executionPayload = structureResult;
    } else {
      // Neither horizon is a setup — short-circuit, surface the 1h view
      // as the canonical execution horizon, skip Claude + risk entirely.
      // TTL still reflects the *displayed* horizon (1h ⇒ 12h) so the UI
      // countdown is meaningful even on "no-trade" results.
      this.logger.log(
        `Scanner short-circuit | coin=${coin} | reason=neither 1h nor 4h met the entry gate`,
      );
      const watchingExpiresAt = this.computeExpiresAt(entryHorizon.timeframe);
      return {
        coin,
        walletBalance,
        macroBias,
        executionHorizon: entryHorizon,
        riskProfile: null,
        aiInsight: null,
        expiresAt: watchingExpiresAt.toISOString(),
      };
    }

    this.logger.debug(
      `Scanner chose ${executionHorizon.timeframe} as execution horizon ` +
        `(status=${executionHorizon.status}, route=${executionHorizon.strategyRoute})`,
    );

    // ── 4. AI insight ────────────────────────────────────────────────
    const aiInsight: ClaudeAnalysisResponse | null =
      executionHorizon.worthNarrating
        ? await this.claudeService.analyzeWithChecklist(executionPayload)
        : null;

    // ── 5. Risk profile (only when Claude returns an actionable trade) ─
    const riskProfile = this.buildRiskProfileIfTradable(
      aiInsight,
      executionPayload,
      walletBalance,
    );

    // ── 6. Smart TTL — derived from the chosen execution horizon ──────
    const expiresAt = this.computeExpiresAt(executionHorizon.timeframe);

    // ── 7. Fire-and-forget persistence of the execution-horizon run ───
    //    with the smart-TTL expiry attached so cleanup jobs + the UI
    //    countdown have a single source of truth.
    this.persistence.persist({
      coordinatorResult: executionPayload,
      aiResponse: aiInsight,
      durationMs: Date.now() - startedAt,
      expiresAt,
    });

    return {
      coin,
      walletBalance,
      macroBias,
      executionHorizon,
      riskProfile,
      aiInsight,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  //  Smart-TTL
  // ════════════════════════════════════════════════════════════════════

  /**
   * Map an execution-horizon timeframe to a wall-clock expiry timestamp.
   *
   * Today the scanner only ever picks `'4h'` or `'1h'` as the execution
   * horizon, but the mapping covers `'15m'` and `'1d'` too so the helper
   * can be reused if the horizon set is expanded later. Any unrecognised
   * timeframe falls back to the 1h bucket (12h TTL) and is logged so we
   * notice the drift.
   */
  private computeExpiresAt(
    timeframe: ExecutionHorizon['timeframe'],
  ): Date {
    const ttl = TTL_BY_TIMEFRAME_MS[timeframe] ?? TTL_BY_TIMEFRAME_MS['1h'];
    if (!(timeframe in TTL_BY_TIMEFRAME_MS)) {
      this.logger.warn(
        `Unknown execution timeframe '${timeframe}' — defaulting TTL to 12h`,
      );
    }
    return new Date(Date.now() + ttl);
  }

  // ════════════════════════════════════════════════════════════════════
  //  Synthesis helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Collapse the 1d coordinator pass into a single directional bias.
   *
   * Priority:
   *  1. Checklist `tradeType` when the market-structure condition
   *     actually passed — that means the coordinator's structural
   *     reading (HH/HL or LH/LL) confirmed the tested direction.
   *  2. Directional Index spread (PDI vs MDI) as a fallback for
   *     COMPRESSION-classified days where no checklist is run, or when
   *     structure was ranging / unknown.
   */
  private deriveMacroBias(macro: CoordinatorAnalysisResult): MacroBias {
    const { regimeResult, checklistResult } = macro;

    if (checklistResult && checklistResult.marketStructure.passed) {
      return {
        timeframe: '1d',
        regime: regimeResult.regime,
        bias: checklistResult.tradeType,
      };
    }

    const { pdi, mdi } = regimeResult.metrics;
    if (pdi > mdi) {
      return { timeframe: '1d', regime: regimeResult.regime, bias: 'long' };
    }
    if (mdi > pdi) {
      return { timeframe: '1d', regime: regimeResult.regime, bias: 'short' };
    }

    return { timeframe: '1d', regime: regimeResult.regime, bias: 'neutral' };
  }

  /**
   * Project a coordinator pass onto the `ExecutionHorizon` shape.
   *
   * Status mapping:
   *  - CONFLUENCE_CHECKLIST → SETUP / NO_SETUP from the entry gate.
   *  - SQUEEZE_BREAKOUT     → `PENDING_BREAKOUT` (gating happens at the
   *    AI layer; the scanner always narrates a squeeze).
   *  - UNKNOWN / missing    → `NO_SETUP` so the caller short-circuits.
   */
  private buildExecutionHorizon(
    result: CoordinatorAnalysisResult,
    timeframe: '4h' | '1h',
  ): ExecutionHorizon {
    if (result.strategyRoute === 'SQUEEZE_BREAKOUT') {
      return {
        timeframe,
        strategyRoute: 'SQUEEZE_BREAKOUT',
        status: 'PENDING_BREAKOUT',
        conditionsMet: null,
        // Squeeze setups have no condition count; the envelope itself is the
        // description, so the scanner always narrates them.
        worthNarrating: true,
        squeezeSetup: result.squeezeSetup,
        checklistResult: null,
      };
    }

    return {
      timeframe,
      strategyRoute: 'CONFLUENCE_CHECKLIST',
      status: result.checklistResult?.passed ? 'SETUP' : 'NO_SETUP',
      conditionsMet: result.checklistResult?.conditionsMet ?? null,
      worthNarrating:
        (result.checklistResult?.conditionsMet ?? 0) >= SCANNER_MIN_CONDITIONS,
      squeezeSetup: null,
      checklistResult: result.checklistResult,
    };
  }

  /**
   * Compute a sized risk profile from a Claude LONG/SHORT verdict.
   * Returns null whenever Claude responds with WAIT or aiInsight is null.
   *
   * Pipeline:
   *  1. Ask `LeverageService` for the recommended leverage given the
   *     execution timeframe, checklist score, ATR, current price, and
   *     stop-loss distance.
   *  2. Pass the resulting leverage into `PositionSizingService` to size
   *     the position, derive margin, and compute liquidation.
   *  3. Merge both services' warnings so the caller sees every caveat.
   */
  private buildRiskProfileIfTradable(
    aiInsight: ClaudeAnalysisResponse | null,
    executionPayload: CoordinatorAnalysisResult,
    walletBalance: number,
  ): RiskProfile | null {
    if (!aiInsight || !isTradeSignal(aiInsight)) {
      return null;
    }

    const trade = aiInsight as ClaudeTradeAnalysis;
    const entryPrice = trade.entry?.price;
    const stopLossPrice = trade.stopLoss?.price;

    if (
      typeof entryPrice !== 'number' ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0 ||
      typeof stopLossPrice !== 'number' ||
      !Number.isFinite(stopLossPrice) ||
      stopLossPrice <= 0
    ) {
      this.logger.warn(
        `Skipping risk sizing — invalid entry/stop on AI verdict for ` +
          `${executionPayload.symbol} ${executionPayload.timeframe} ` +
          `(entry=${entryPrice}, stop=${stopLossPrice})`,
      );
      return null;
    }

    const stopLossPercentage =
      (Math.abs(entryPrice - stopLossPrice) / entryPrice) * 100;

    // null when the squeeze route ran and there is no checklist to count.
    const conditionsMet = executionPayload.checklistResult?.conditionsMet ?? null;
    const atr = executionPayload.regimeResult.metrics.atr;

    // ── 1. Leverage recommendation ───────────────────────────────────
    const leverageRec = this.leverageService.recommendLeverage({
      timeframe: executionPayload.timeframe,
      conditionsMet,
      atr,
      currentPrice: entryPrice,
      stopLossPercentage,
      experienceLevel: SCANNER_RISK_DEFAULTS.experienceLevel,
      riskTolerance: SCANNER_RISK_DEFAULTS.riskTolerance,
    });

    // ── 2. Position sizing ───────────────────────────────────────────
    const sizing = this.positionSizing.calculatePositionSize({
      accountBalance: walletBalance,
      riskPercentage: SCANNER_RISK_DEFAULTS.riskPercentage,
      entryPrice,
      stopLoss: stopLossPrice,
      leverage: leverageRec.recommended,
    });

    return {
      positionSize: sizing.positionSize,
      marginRequired: sizing.margin,
      recommendedLeverage: leverageRec.recommended,
      liquidationPrice: sizing.liquidationPrice,
      stopLossPrice,
      warnings: [...sizing.warnings, ...leverageRec.warnings],
    };
  }
}
