import { Injectable, Logger } from '@nestjs/common';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../squeeze-breakout/squeeze-breakout.service';
import { ChecklistService } from '../analysis/services/checklist.service';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
import { EntryChecklistParams } from '../analysis/interfaces/checklist.types';
import { MarketRegimeResult } from '../market-regime/interfaces/market-regime.types';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';

/**
 * Single candle window used for the entire pipeline. Wide enough to
 * support every downstream service (regime needs ~250 for percentile
 * history, squeeze only looks at last 20, checklist needs >= 100).
 */
export const ANALYSIS_CANDLE_LIMIT = 250;

/**
 * AnalysisCoordinatorService
 *
 * Central orchestrator for the entire analysis pipeline. Single entry
 * point upstream of AI execution and strategy execution layers.
 *
 * Pipeline:
 *   1. Fetch candles ONCE from Binance.
 *   2. Build a shared `IndicatorContext` with every baseline indicator.
 *   3. Pass the context to:
 *        - `MarketRegimeService.classifyFromContext`
 *        - `SqueezeBreakoutService.calculateBreakoutTriggersFromContext`
 *          (COMPRESSION route only)
 *        - `ChecklistService.evaluateChecklist`
 *          (TRENDING / MEAN_REVERSION route only)
 *
 * No service downstream of the coordinator performs its own Binance
 * fetch or recomputes any indicator that already lives on the context.
 * This guarantees zero duplicate I/O and zero duplicate math per
 * `analyzeAsset` call.
 */
@Injectable()
export class AnalysisCoordinatorService {
  private readonly logger = new Logger(AnalysisCoordinatorService.name);

  constructor(
    private readonly marketRegimeService: MarketRegimeService,
    private readonly squeezeBreakoutService: SqueezeBreakoutService,
    private readonly checklistService: ChecklistService,
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
  ) {}

  /**
   * Analyze an asset through the full pipeline (one-shot, no streaming).
   *
   * @param symbol    Base symbol (e.g. 'BTC')
   * @param timeframe Candle interval (e.g. '1h')
   */
  async analyzeAsset(
    symbol: string,
    timeframe: string,
  ): Promise<CoordinatorAnalysisResult> {
    this.logger.log(`Starting analysis pipeline for ${symbol} ${timeframe}`);

    const candles = await this.binanceService.getCandles(
      symbol,
      timeframe as TimeInterval,
      ANALYSIS_CANDLE_LIMIT,
    );

    const context = this.indicatorsService.buildContext(
      symbol,
      timeframe,
      candles,
    );

    this.logger.debug('Step A: Classifying market regime...');
    const regimeResult = this.marketRegimeService.classifyFromContext(context);
    this.logger.debug(`Market regime: ${regimeResult.regime}`);

    return this.routeFromRegime(context, timeframe, regimeResult);
  }

  /**
   * Route a pre-classified regime to its strategy (squeeze breakout vs
   * confluence checklist) and build the final `CoordinatorAnalysisResult`.
   *
   * Public so the SSE controller can interleave progress emissions
   * between candle fetch / regime classification / strategy routing
   * without re-running any work.
   */
  routeFromRegime(
    context: IndicatorContext,
    timeframe: string,
    regimeResult: MarketRegimeResult,
  ): CoordinatorAnalysisResult {
    if (regimeResult.regime === 'COMPRESSION') {
      this.logger.debug('Routing to SQUEEZE_BREAKOUT strategy...');

      const squeezeSetup =
        this.squeezeBreakoutService.calculateBreakoutTriggersFromContext(context);

      return {
        symbol: context.symbol,
        timeframe,
        regimeResult,
        strategyRoute: 'SQUEEZE_BREAKOUT',
        squeezeSetup,
        checklistResult: null,
        shouldInvokeAI: true,
        reasoning:
          `Market classified as COMPRESSION (BB width ${regimeResult.metrics.bandWidth.toFixed(3)}% ` +
          `at ${
            regimeResult.metrics.bandWidthPercentile !== null
              ? regimeResult.metrics.bandWidthPercentile.toFixed(1)
              : '?'
          }th percentile). ` +
          `Activating squeeze breakout strategy with breakout levels. AI execution enabled.`,
      };
    }

    this.logger.debug('Routing to CONFLUENCE_CHECKLIST strategy...');

    const checklistInputs = this.buildChecklistInputs(context, regimeResult);
    const checklistResult =
      this.checklistService.evaluateChecklist(checklistInputs);

    const shouldInvokeAI = checklistResult.status !== 'WATCHING';

    this.logger.debug(
      `Checklist status: ${checklistResult.status} => shouldInvokeAI: ${shouldInvokeAI}`,
    );

    return {
      symbol: context.symbol,
      timeframe,
      regimeResult,
      strategyRoute: 'CONFLUENCE_CHECKLIST',
      squeezeSetup: null,
      checklistResult,
      shouldInvokeAI,
      reasoning:
        `Market classified as ${regimeResult.regime} (ADX: ${regimeResult.metrics.adx.toFixed(2)}). ` +
        `Evaluated confluence checklist: ${checklistResult.status} (${checklistResult.totalScore}/100). ` +
        `AI execution ${shouldInvokeAI ? 'ENABLED' : 'DISABLED'}.`,
    };
  }

  /**
   * Build the checklist input payload from the shared `IndicatorContext`.
   *
   * Pure synchronous transform: no I/O, no recomputation of any series
   * already present on the context. Only the per-request bits the
   * checklist needs on top of the baseline indicators (support /
   * resistance, market structure, nearest level) are derived here.
   *
   * Mathematically identical to the previous `gatherChecklistInputs`
   * implementation — only the data source changed (shared context
   * instead of a duplicate Binance fetch + indicator recomputation).
   */
  private buildChecklistInputs(
    context: IndicatorContext,
    regimeResult: MarketRegimeResult,
  ): EntryChecklistParams {
    const {
      candles,
      closes,
      highs,
      lows,
      volumes,
      rsi,
      rsiHistory,
      bollingerBands,
      bandWidth,
      qqe,
    } = context;

    if (closes.length < 100) {
      throw new Error(
        `Insufficient candles for checklist input gathering: got ${closes.length}, need 100+`,
      );
    }

    // Last candle close. Indicators are computed on closes, so the price
    // anchor must match them.
    //
    // This previously passed `bollingerBands.middle` (the 20-SMA), which
    // silently broke three of the five checklist conditions: BB proximity
    // is measured as (price - lower) / (upper - lower), and the bands are
    // symmetric about the middle, so feeding it the middle scored exactly
    // 50% on every single run against a 10% threshold — condition 3 could
    // never pass. Market structure and S/R proximity were anchored to a
    // lagging average rather than price.
    const currentPrice = closes[closes.length - 1];

    // Support / resistance derived from the same candle series.
    const candlesArr = candles as ReadonlyArray<Candle> as Candle[];
    const { support, resistance } =
      this.indicatorsService.identifySupportResistance(candlesArr);

    // Infer market structure from price position vs the S/R midpoint
    // and trailing 20-candle pivots. Logic preserved verbatim from the
    // legacy `gatherChecklistInputs` implementation.
    let marketStructure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown' = 'unknown';
    if (support !== null && resistance !== null) {
      const mid = (support + resistance) / 2;
      const lastIdx = highs.length - 1;
      const pivotIdx = Math.max(0, lastIdx - 20);

      if (currentPrice > mid && highs[lastIdx] > highs[pivotIdx]) {
        marketStructure = 'HH/HL';
      } else if (currentPrice < mid && lows[lastIdx] < lows[pivotIdx]) {
        marketStructure = 'LH/LL';
      } else {
        marketStructure = 'ranging';
      }
    }

    // Nearest key level + volume context.
    const keyLevels = this.indicatorsService.identifyKeyLevels(
      candlesArr,
      currentPrice,
    );
    const nearestLevel = this.indicatorsService.findNearestLevel(
      keyLevels,
      currentPrice,
    );

    const tradeType = this.deriveTradeType(regimeResult, marketStructure);

    return {
      tradeType,
      rsi,
      rsiHistory: rsiHistory as number[],
      qqeColor: qqe.color,
      previousQQEColor: qqe.previousColor,
      currentPrice,
      bollingerBands,
      bandWidth,
      marketStructure,
      nearestLevel: nearestLevel
        ? {
            price: nearestLevel.price,
            type: nearestLevel.type,
            strength: nearestLevel.strength,
            volumeAtTouch: volumes.slice(-20) as number[],
          }
        : null,
      volumeAtNearestLevel: volumes[volumes.length - 1],
    };
  }

  /**
   * Derive long/short bias from regime DI spread + observed market
   * structure. Priority:
   *   1. Market structure (HH/HL → long, LH/LL → short) — strongest signal
   *   2. DI spread (+DI vs -DI) — directional trend tiebreaker
   *   3. Fallback to 'long' when neither is conclusive
   */
  private deriveTradeType(
    regimeResult: MarketRegimeResult,
    marketStructure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown',
  ): 'long' | 'short' {
    if (marketStructure === 'HH/HL') return 'long';
    if (marketStructure === 'LH/LL') return 'short';

    const { pdi, mdi } = regimeResult.metrics;
    if (pdi > mdi) return 'long';
    if (mdi > pdi) return 'short';
    return 'long';
  }
}
