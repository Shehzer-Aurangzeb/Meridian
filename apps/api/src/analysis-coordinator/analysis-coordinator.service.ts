import { Injectable, Logger } from '@nestjs/common';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../squeeze-breakout/squeeze-breakout.service';
import { ChecklistService } from '../analysis/services/checklist.service';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { SupportResistanceService } from '../analysis/services/support-resistance.service';
import { Timeframe } from '../common/constants/timeframes';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
import { EntryChecklistParams } from '../analysis/interfaces/checklist.types';
import { MarketRegimeResult } from '../market-regime/interfaces/market-regime.types';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';

/** One candle window for the whole pipeline. Regime needs the most, ~250. */
export const ANALYSIS_CANDLE_LIMIT = 250;

/**
 * Runs the analysis end to end: fetch price history once, measure once, then
 * route to the approach that matches the market.
 *
 * Nothing downstream fetches or recalculates, so a number cannot come out
 * differently in two places.
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
    private readonly supportResistanceService: SupportResistanceService,
  ) {}

  /** Run the whole thing for one coin. */
  async analyzeAsset(
    symbol: string,
    timeframe: string,
    direction?: 'long' | 'short',
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

    return this.routeFromRegime(context, timeframe, regimeResult, direction);
  }

  /** Applies the approach that matches the market type. */
  routeFromRegime(
    context: IndicatorContext,
    timeframe: string,
    regimeResult: MarketRegimeResult,
    direction?: 'long' | 'short',
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
        reasoning:
          `Market classified as COMPRESSION (BB width ${regimeResult.metrics.bandWidth.toFixed(3)}% ` +
          `at ${
            regimeResult.metrics.bandWidthPercentile !== null
              ? regimeResult.metrics.bandWidthPercentile.toFixed(1)
              : '?'
          }th percentile). ` +
          `Activating squeeze breakout strategy with breakout levels.`,
      };
    }

    this.logger.debug('Routing to CONFLUENCE_CHECKLIST strategy...');

    const checklistInputs = this.buildChecklistInputs(context, regimeResult, direction);
    const checklistResult =
      this.checklistService.evaluateChecklist(checklistInputs);

    // Describes what it sees; never decides the analysis was not worth doing.
    // An earlier version did, and stayed silent on 99.6% of bars.
    this.logger.debug(
      `Checklist ${checklistResult.conditionsMet}/5 conditions met`,
    );

    return {
      symbol: context.symbol,
      timeframe,
      regimeResult,
      strategyRoute: 'CONFLUENCE_CHECKLIST',
      squeezeSetup: null,
      checklistResult,
      reasoning:
        `Market classified as ${regimeResult.regime} (ADX: ${regimeResult.metrics.adx.toFixed(2)}). ` +
        `Evaluated confluence checklist for ${checklistResult.tradeType} ` +
        `(direction ${direction ? 'supplied by caller' : 'derived from trend'}): ` +
        `${checklistResult.conditionsMet}/5 conditions met.`,
    };
  }

  /** What the entry checklist needs, reusing measurements already taken. */
  private buildChecklistInputs(
    context: IndicatorContext,
    regimeResult: MarketRegimeResult,
    direction?: 'long' | 'short',
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

    // A close, because everything it is compared against is a close.
    const currentPrice = closes[closes.length - 1];

    // Support / resistance derived from the same candle series.
    const candlesArr = candles as ReadonlyArray<Candle> as Candle[];
    const { support, resistance } =
      this.indicatorsService.identifySupportResistance(candlesArr);

    // Structure from price vs the S/R midpoint and trailing 20-bar pivots.
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

    // Nearest level, from real turning points rather than a fixed grid.
    const levels = this.supportResistanceService.levelsFromCandles(
      candlesArr,
      context.timeframe as Timeframe,
      currentPrice,
    );
    const nearestLevel =
      levels.length > 0
        ? levels.reduce((best, l) =>
            Math.abs(l.distancePercent) < Math.abs(best.distancePercent) ? l : best,
          )
        : null;

    // Direction is an INPUT when the caller knows it. Guessing it here is how
    // support arrivals came to be scored as shorts, which can never pass.
    const tradeType = direction ?? this.deriveTradeType(regimeResult, marketStructure);

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
            // The raw count, not `strength`. The checklist thresholds count
            // tests; `strength` is a score that rounds a held level up.
            touchCount: nearestLevel.touchCount,
            volumeAtTouch: volumes.slice(-20) as number[],
          }
        : null,
      volumeAtNearestLevel: volumes[volumes.length - 1],
    };
  }

  /**
   * Guesses a direction from the trend: highs and lows first, then which side
   * of the trend measure is stronger, else up.
   *
   * A poor guess whenever direction comes from something other than trend —
   * arriving at support is a buy whatever the trend says. Pass it in instead.
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
