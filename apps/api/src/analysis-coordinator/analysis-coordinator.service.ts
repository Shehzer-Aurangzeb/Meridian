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

/**
 * Single candle window used for the entire pipeline. Wide enough to
 * support every downstream service (regime needs ~250 for percentile
 * history, squeeze only looks at last 20, checklist needs >= 100).
 */
export const ANALYSIS_CANDLE_LIMIT = 250;

/**
 * Runs the analysis end to end:
 *
 *   1. fetch the price history once
 *   2. work out every measurement from it, once
 *   3. decide what kind of market this is, then apply the matching approach
 *
 * Nothing further down fetches its own data or recalculates anything, so a
 * number cannot come out differently in two places.
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

  /**
   * Picks the approach that matches the market type and applies it. Separate
   * so a caller can report progress between steps without repeating work.
   */
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

    // Nothing is filtered out here. This describes what it sees; it does not
    // decide whether the analysis was worth doing. An earlier version made
    // that judgement and stayed silent on 99.6% of the bars it looked at.
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

  /**
   * Gathers what the entry checklist needs, reusing measurements already
   * taken and adding only the few extras it needs on top.
   */
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

    // The last closing price. Every measurement is based on closing prices,
    // so the price compared against them has to be one too.
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

    // The nearest important level, found the same way the rest of the app
    // finds them — from actual turning points in price, not a fixed grid.
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

    // Direction is an INPUT when the caller knows it. A confirmation filter
    // must be told which side it is confirming; deciding for itself and then
    // vetoing is how support-zone arrivals came to be evaluated as shorts,
    // where `rsi >= 60` and the UPPER Bollinger band can never pass.
    // Falls back to trend-derived direction only when the caller has no view.
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
            strength: nearestLevel.strength,
            volumeAtTouch: volumes.slice(-20) as number[],
          }
        : null,
      volumeAtNearestLevel: volumes[volumes.length - 1],
    };
  }

  /**
   * Guesses a direction from the trend, in order:
   *   1. the pattern of highs and lows — rising means up, falling means down
   *   2. which side of the trend measure is stronger
   *   3. otherwise, up
   */
  /**
   * Only used when the caller does not say which direction it means. It is a
   * guess, and a poor one whenever the direction comes from something other
   * than the trend — arriving at support is a buy whatever the trend says.
   * Pass the direction in wherever possible.
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
