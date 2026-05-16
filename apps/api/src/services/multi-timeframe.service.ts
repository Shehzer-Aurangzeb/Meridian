import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { BinanceService } from './binance.service';
import { IndicatorsService } from './indicators.service';
import { ChecklistService } from './checklist.service';
import { SupportResistanceService } from './support-resistance.service';
import { Candle, TimeInterval } from '../types/candle.types';
import { IndicatorResults, ExtendedIndicatorResults, KeyLevel } from '../types/indicator.types';
import {
  Timeframe,
  ANALYSIS_TIMEFRAMES,
  CANDLE_LIMITS,
  HTF_TIMEFRAMES,
  LTF_TIMEFRAMES,
  RSI_THRESHOLDS,
  MIN_SWING_POINTS,
  TradeType,
} from '../constants/timeframes';
import {
  TimeframeAnalysis,
  HTFBiasResult,
  LTFEntryResult,
  MultiTimeframeAnalysisResult,
  AnalysisOptions,
  SwingPoint,
  MarketStructureAnalysis,
  MarketStructure,
  MarketStructurePattern,
  Bias,
  EntrySignal,
  EntryChecklist,
} from '../types/multi-timeframe.types';
import { EntryChecklistResult, EntryChecklistParams } from '../types/checklist.types';
import { SupportResistanceLevel } from '../types/support-resistance.types';

@Injectable()
export class MultiTimeframeService {
  private readonly logger = new Logger(MultiTimeframeService.name);

  // Cache TTL in seconds (1 minute for analysis results)
  private readonly ANALYSIS_CACHE_TTL = 60;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly checklistService: ChecklistService,
    private readonly supportResistanceService: SupportResistanceService,
  ) {}

  /**
   * Main entry point: Perform complete multi-timeframe analysis
   */
  async analyzeMultipleTimeframes(
    options: AnalysisOptions,
  ): Promise<MultiTimeframeAnalysisResult> {
    const { symbol, tradeType, customTimeframes, includeDetailedChecklist = true } = options;
    const timeframes: Timeframe[] =
      customTimeframes || [...ANALYSIS_TIMEFRAMES[tradeType]];

    // Check cache first
    const cacheKey = this.generateAnalysisCacheKey(symbol, tradeType, includeDetailedChecklist);
    const cached = await this.cacheManager.get<MultiTimeframeAnalysisResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Analysis cache HIT: ${cacheKey}`);
      // Reconstruct Date objects
      return {
        ...cached,
        analyzedAt: new Date(cached.analyzedAt),
      };
    }

    this.logger.debug(`Analysis cache MISS: ${cacheKey}`);
    this.logger.log(
      `Starting multi-timeframe analysis for ${symbol} (${tradeType} mode)`,
    );

    // 1. Fetch candles for all timeframes in parallel
    const candlesByTimeframe = await this.fetchMultipleTimeframes(
      symbol,
      timeframes,
    );

    // 2. Get current price
    const currentPrice = await this.binanceService.getCurrentPrice(symbol);

    // 3. Analyze each timeframe (with extended indicators)
    const timeframeAnalysis: TimeframeAnalysis[] = [];
    for (const timeframe of timeframes) {
      const candles = candlesByTimeframe.get(timeframe);
      if (candles && candles.length > 20) {
        const analysis = this.analyzeTimeframe(
          timeframe,
          candles,
          currentPrice,
          includeDetailedChecklist,
        );
        timeframeAnalysis.push(analysis);
      } else {
        this.logger.warn(`Insufficient data for ${timeframe}`);
      }
    }

    // 4. Determine HTF bias
    const htfAnalyses = timeframeAnalysis.filter((a) =>
      HTF_TIMEFRAMES.includes(a.timeframe),
    );
    const htfBias = this.determineHTFBias(htfAnalyses);

    // 5. Find LTF entry
    const ltfAnalyses = timeframeAnalysis.filter((a) =>
      LTF_TIMEFRAMES.includes(a.timeframe),
    );
    const ltfEntry = this.findLTFEntry(ltfAnalyses, htfBias, currentPrice);

    // 6. Build legacy entry checklist
    const entryChecklist = this.buildEntryChecklist(
      timeframeAnalysis,
      htfBias,
      ltfEntry,
    );

    // 7. Build Miraj's 5-point checklist (if enabled)
    let fivePointChecklist: EntryChecklistResult | undefined;
    if (includeDetailedChecklist) {
      fivePointChecklist = this.buildFivePointChecklist(
        timeframeAnalysis,
        htfBias,
        ltfEntry,
        currentPrice,
      );
    }

    // 8. Generate trade suggestion (use 5-point checklist if available)
    const tradeSuggestion = this.generateTradeSuggestion(
      htfBias,
      ltfEntry,
      entryChecklist,
      fivePointChecklist,
    );

    const result: MultiTimeframeAnalysisResult = {
      symbol,
      analyzedAt: new Date(),
      currentPrice,
      timeframeAnalysis,
      htfBias,
      ltfEntry,
      entryChecklist,
      fivePointChecklist,
      tradeSuggestion,
    };

    // Cache the result
    await this.cacheManager.set(cacheKey, result, this.ANALYSIS_CACHE_TTL);

    return result;
  }

  /**
   * Generate cache key for analysis results
   */
  private generateAnalysisCacheKey(
    symbol: string,
    tradeType: TradeType,
    includeDetailedChecklist: boolean,
  ): string {
    return `mtf-analysis:${symbol}:${tradeType}:${includeDetailedChecklist}`;
  }

  /**
   * Fetch candles for multiple timeframes in parallel
   */
  async fetchMultipleTimeframes(
    symbol: string,
    timeframes: Timeframe[],
  ): Promise<Map<Timeframe, Candle[]>> {
    const results = new Map<Timeframe, Candle[]>();

    const fetchPromises = timeframes.map(async (tf) => {
      try {
        const limit = CANDLE_LIMITS[tf];
        const candles = await this.binanceService.getCandles(
          symbol,
          tf as TimeInterval,
          limit,
        );
        return { timeframe: tf, candles };
      } catch (error) {
        this.logger.error(`Failed to fetch ${tf} candles for ${symbol}`, error);
        return { timeframe: tf, candles: [] };
      }
    });

    const fetchResults = await Promise.all(fetchPromises);

    for (const { timeframe, candles } of fetchResults) {
      results.set(timeframe, candles);
    }

    return results;
  }

  /**
   * Analyze a single timeframe with indicators and market structure
   */
  analyzeTimeframe(
    timeframe: Timeframe,
    candles: Candle[],
    currentPrice: number,
    includeExtended: boolean = false,
  ): TimeframeAnalysis {
    // Calculate basic indicators
    const indicators = this.indicatorsService.analyzeTimeframe(candles);

    // Calculate extended indicators if needed (QQE, band width, key levels)
    let extendedIndicators: ExtendedIndicatorResults | undefined;
    if (includeExtended) {
      extendedIndicators = this.indicatorsService.analyzeTimeframeExtended(candles);
    }

    // Detect market structure
    const marketStructure = this.detectMarketStructure(candles);

    // Calculate key 50% level
    const key50Level = this.calculate50Level(candles);

    // Determine timeframe bias
    const { bias, confidence } = this.determineTimeframeBias(
      indicators,
      marketStructure,
      currentPrice,
      key50Level,
    );

    return {
      timeframe,
      indicators,
      extendedIndicators,
      marketStructure,
      bias,
      confidence,
      key50Level,
      currentPrice,
      candleCount: candles.length,
    };
  }

  /**
   * Detect market structure by identifying swing highs/lows
   * Looking for HH/HL (bullish) or LH/LL (bearish) patterns
   */
  detectMarketStructure(candles: Candle[]): MarketStructureAnalysis {
    const swingPoints = this.identifySwingPoints(candles);

    if (swingPoints.length < MIN_SWING_POINTS) {
      return {
        structure: 'unknown',
        pattern: 'unknown',
        swingPoints,
        lastHigherHigh: null,
        lastHigherLow: null,
        lastLowerHigh: null,
        lastLowerLow: null,
        trendStrength: 0,
      };
    }

    // Separate highs and lows
    const swingHighs = swingPoints.filter((p) => p.type === 'high');
    const swingLows = swingPoints.filter((p) => p.type === 'low');

    // Analyze for higher highs / higher lows (bullish)
    const higherHighCount = this.countConsecutiveHigherPivots(swingHighs);
    const higherLowCount = this.countConsecutiveHigherPivots(swingLows);

    // Analyze for lower highs / lower lows (bearish)
    const lowerHighCount = this.countConsecutiveLowerPivots(swingHighs);
    const lowerLowCount = this.countConsecutiveLowerPivots(swingLows);

    // Determine structure
    let structure: MarketStructure = 'ranging';
    let trendStrength = 0;

    const bullishScore = higherHighCount + higherLowCount;
    const bearishScore = lowerHighCount + lowerLowCount;

    if (bullishScore >= 3 && bullishScore > bearishScore) {
      structure = 'bullish';
      trendStrength = Math.min(100, bullishScore * 25);
    } else if (bearishScore >= 3 && bearishScore > bullishScore) {
      structure = 'bearish';
      trendStrength = Math.min(100, bearishScore * 25);
    }

    // Find last instances of each pattern
    const lastHigherHigh = this.findLastHigherPivot(swingHighs);
    const lastHigherLow = this.findLastHigherPivot(swingLows);
    const lastLowerHigh = this.findLastLowerPivot(swingHighs);
    const lastLowerLow = this.findLastLowerPivot(swingLows);

    // Convert structure to pattern for checklist
    const pattern: MarketStructurePattern = this.structureToPattern(structure);

    return {
      structure,
      pattern,
      swingPoints,
      lastHigherHigh,
      lastHigherLow,
      lastLowerHigh,
      lastLowerLow,
      trendStrength,
    };
  }

  /**
   * Convert MarketStructure to checklist pattern format
   */
  private structureToPattern(structure: MarketStructure): MarketStructurePattern {
    switch (structure) {
      case 'bullish':
        return 'HH/HL';
      case 'bearish':
        return 'LH/LL';
      case 'ranging':
        return 'ranging';
      default:
        return 'unknown';
    }
  }

  /**
   * Identify swing highs and lows in the candle data
   * Uses a 5-candle lookback (2 on each side)
   */
  private identifySwingPoints(candles: Candle[], lookback: number = 2): SwingPoint[] {
    const swingPoints: SwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];

      // Check for swing high
      let isSwingHigh = true;
      for (let j = 1; j <= lookback; j++) {
        if (
          candles[i - j].high >= current.high ||
          candles[i + j].high >= current.high
        ) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        swingPoints.push({
          type: 'high',
          price: current.high,
          index: i,
          time: current.time,
        });
      }

      // Check for swing low
      let isSwingLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (
          candles[i - j].low <= current.low ||
          candles[i + j].low <= current.low
        ) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        swingPoints.push({
          type: 'low',
          price: current.low,
          index: i,
          time: current.time,
        });
      }
    }

    // Sort by index
    return swingPoints.sort((a, b) => a.index - b.index);
  }

  /**
   * Count consecutive higher pivots (HH or HL pattern)
   */
  private countConsecutiveHigherPivots(pivots: SwingPoint[]): number {
    if (pivots.length < 2) return 0;

    let count = 0;
    for (let i = pivots.length - 1; i > 0; i--) {
      if (pivots[i].price > pivots[i - 1].price) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Count consecutive lower pivots (LH or LL pattern)
   */
  private countConsecutiveLowerPivots(pivots: SwingPoint[]): number {
    if (pivots.length < 2) return 0;

    let count = 0;
    for (let i = pivots.length - 1; i > 0; i--) {
      if (pivots[i].price < pivots[i - 1].price) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Find the last higher pivot in a series
   */
  private findLastHigherPivot(pivots: SwingPoint[]): SwingPoint | null {
    if (pivots.length < 2) return null;

    for (let i = pivots.length - 1; i > 0; i--) {
      if (pivots[i].price > pivots[i - 1].price) {
        return pivots[i];
      }
    }
    return null;
  }

  /**
   * Find the last lower pivot in a series
   */
  private findLastLowerPivot(pivots: SwingPoint[]): SwingPoint | null {
    if (pivots.length < 2) return null;

    for (let i = pivots.length - 1; i > 0; i--) {
      if (pivots[i].price < pivots[i - 1].price) {
        return pivots[i];
      }
    }
    return null;
  }

  /**
   * Calculate the 50% level of recent range (key level)
   */
  private calculate50Level(candles: Candle[], lookback: number = 50): number {
    const recentCandles = candles.slice(-lookback);
    const highs = recentCandles.map((c) => c.high);
    const lows = recentCandles.map((c) => c.low);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    return (highest + lowest) / 2;
  }

  /**
   * Determine bias for a single timeframe
   */
  private determineTimeframeBias(
    indicators: IndicatorResults,
    marketStructure: MarketStructureAnalysis,
    currentPrice: number,
    key50Level: number,
  ): { bias: Bias; confidence: number } {
    let bullishPoints = 0;
    let bearishPoints = 0;
    const totalPoints = 5;

    // 1. Market structure
    if (marketStructure.structure === 'bullish') {
      bullishPoints += 2;
    } else if (marketStructure.structure === 'bearish') {
      bearishPoints += 2;
    }

    // 2. Price relative to 50% level
    if (currentPrice > key50Level) {
      bullishPoints += 1;
    } else {
      bearishPoints += 1;
    }

    // 3. RSI
    if (indicators.rsi < RSI_THRESHOLDS.OVERSOLD) {
      bullishPoints += 1; // Oversold = potential bullish reversal
    } else if (indicators.rsi > RSI_THRESHOLDS.OVERBOUGHT) {
      bearishPoints += 1; // Overbought = potential bearish reversal
    } else if (indicators.rsi > 50) {
      bullishPoints += 0.5;
    } else {
      bearishPoints += 0.5;
    }

    // 4. Price relative to Bollinger Bands
    if (currentPrice < indicators.bollingerBands.lower) {
      bullishPoints += 1; // Near lower band = potential bounce
    } else if (currentPrice > indicators.bollingerBands.upper) {
      bearishPoints += 1; // Near upper band = potential drop
    } else if (currentPrice > indicators.bollingerBands.middle) {
      bullishPoints += 0.5;
    } else {
      bearishPoints += 0.5;
    }

    // Determine bias
    let bias: Bias;
    let confidence: number;

    if (bullishPoints > bearishPoints + 1) {
      bias = 'bullish';
      confidence = Math.min(100, (bullishPoints / totalPoints) * 100);
    } else if (bearishPoints > bullishPoints + 1) {
      bias = 'bearish';
      confidence = Math.min(100, (bearishPoints / totalPoints) * 100);
    } else {
      bias = 'neutral';
      confidence = 30;
    }

    return { bias, confidence };
  }

  /**
   * Aggregate HTF biases to determine overall market direction
   */
  determineHTFBias(htfAnalyses: TimeframeAnalysis[]): HTFBiasResult {
    if (htfAnalyses.length === 0) {
      return {
        bias: 'neutral',
        confidence: 0,
        reasoning: ['No HTF data available'],
        alignedTimeframes: [],
        conflictingTimeframes: [],
      };
    }

    const reasoning: string[] = [];
    const alignedTimeframes: Timeframe[] = [];
    const conflictingTimeframes: Timeframe[] = [];

    // Count biases
    let bullishCount = 0;
    let bearishCount = 0;
    let totalConfidence = 0;

    for (const analysis of htfAnalyses) {
      totalConfidence += analysis.confidence;

      if (analysis.bias === 'bullish') {
        bullishCount++;
        reasoning.push(
          `${analysis.timeframe} is bullish (${analysis.marketStructure.structure} structure, RSI: ${analysis.indicators.rsi.toFixed(1)})`,
        );
      } else if (analysis.bias === 'bearish') {
        bearishCount++;
        reasoning.push(
          `${analysis.timeframe} is bearish (${analysis.marketStructure.structure} structure, RSI: ${analysis.indicators.rsi.toFixed(1)})`,
        );
      } else {
        reasoning.push(`${analysis.timeframe} is neutral/ranging`);
      }
    }

    // Determine overall bias
    let bias: Bias;
    let confidence: number;

    const avgConfidence = totalConfidence / htfAnalyses.length;

    if (bullishCount > bearishCount && bullishCount >= htfAnalyses.length / 2) {
      bias = 'bullish';
      confidence = avgConfidence * (bullishCount / htfAnalyses.length);
      htfAnalyses
        .filter((a) => a.bias === 'bullish')
        .forEach((a) => alignedTimeframes.push(a.timeframe));
      htfAnalyses
        .filter((a) => a.bias !== 'bullish')
        .forEach((a) => conflictingTimeframes.push(a.timeframe));
    } else if (
      bearishCount > bullishCount &&
      bearishCount >= htfAnalyses.length / 2
    ) {
      bias = 'bearish';
      confidence = avgConfidence * (bearishCount / htfAnalyses.length);
      htfAnalyses
        .filter((a) => a.bias === 'bearish')
        .forEach((a) => alignedTimeframes.push(a.timeframe));
      htfAnalyses
        .filter((a) => a.bias !== 'bearish')
        .forEach((a) => conflictingTimeframes.push(a.timeframe));
    } else {
      bias = 'neutral';
      confidence = 30;
      reasoning.push('Mixed or conflicting signals across HTF');
    }

    return {
      bias,
      confidence: Math.round(confidence),
      reasoning,
      alignedTimeframes,
      conflictingTimeframes,
    };
  }

  /**
   * Find LTF entry signals that align with HTF bias
   */
  findLTFEntry(
    ltfAnalyses: TimeframeAnalysis[],
    htfBias: HTFBiasResult,
    currentPrice: number,
  ): LTFEntryResult {
    const noEntry: LTFEntryResult = {
      hasEntry: false,
      timeframe: null,
      signal: 'none',
      reasons: ['No valid entry signal found'],
      entryZone: null,
      suggestedStopLoss: null,
      riskRewardRatio: null,
    };

    // If HTF bias is neutral or weak, skip entries
    if (htfBias.bias === 'neutral' || htfBias.confidence < 50) {
      noEntry.reasons = ['HTF bias too weak or neutral for entry'];
      return noEntry;
    }

    // Check each LTF for entry signals
    for (const analysis of ltfAnalyses) {
      const signal = this.detectEntrySignal(
        analysis,
        htfBias.bias,
        currentPrice,
      );

      if (signal.signal !== 'none') {
        return signal;
      }
    }

    return noEntry;
  }

  /**
   * Detect specific entry signals on a timeframe
   */
  private detectEntrySignal(
    analysis: TimeframeAnalysis,
    htfBias: Bias,
    currentPrice: number,
  ): LTFEntryResult {
    const { indicators, marketStructure, timeframe } = analysis;
    const reasons: string[] = [];
    let signal: EntrySignal = 'none';
    let entryZone: { low: number; high: number } | null = null;
    let suggestedStopLoss: number | null = null;

    // Looking for long entries when HTF is bullish
    if (htfBias === 'bullish') {
      // 1. Pullback to support / lower BB
      if (
        currentPrice <= indicators.bollingerBands.lower * 1.01 &&
        indicators.rsi < 40
      ) {
        signal = 'pullback_to_support';
        reasons.push('Price at lower Bollinger Band with RSI < 40');
        entryZone = {
          low: indicators.bollingerBands.lower,
          high: indicators.bollingerBands.lower * 1.02,
        };
        suggestedStopLoss = indicators.bollingerBands.lower * 0.98;
      }

      // 2. RSI oversold bounce
      else if (indicators.rsi < RSI_THRESHOLDS.OVERSOLD) {
        signal = 'bollinger_bounce';
        reasons.push(`RSI oversold at ${indicators.rsi.toFixed(1)}`);
        entryZone = {
          low: currentPrice * 0.995,
          high: currentPrice * 1.005,
        };
        suggestedStopLoss = currentPrice * 0.97;
      }

      // 3. Higher low formation (market structure)
      else if (
        marketStructure.structure === 'bullish' &&
        marketStructure.lastHigherLow
      ) {
        const nearHigherLow =
          Math.abs(currentPrice - marketStructure.lastHigherLow.price) /
            currentPrice <
          0.015;
        if (nearHigherLow) {
          signal = 'pullback_to_support';
          reasons.push('Price near recent higher low in bullish structure');
          entryZone = {
            low: marketStructure.lastHigherLow.price,
            high: marketStructure.lastHigherLow.price * 1.01,
          };
          suggestedStopLoss = marketStructure.lastHigherLow.price * 0.985;
        }
      }
    }

    // Looking for short entries when HTF is bearish
    if (htfBias === 'bearish') {
      // 1. Pullback to resistance / upper BB
      if (
        currentPrice >= indicators.bollingerBands.upper * 0.99 &&
        indicators.rsi > 60
      ) {
        signal = 'pullback_to_resistance';
        reasons.push('Price at upper Bollinger Band with RSI > 60');
        entryZone = {
          low: indicators.bollingerBands.upper * 0.98,
          high: indicators.bollingerBands.upper,
        };
        suggestedStopLoss = indicators.bollingerBands.upper * 1.02;
      }

      // 2. RSI overbought rejection
      else if (indicators.rsi > RSI_THRESHOLDS.OVERBOUGHT) {
        signal = 'bollinger_bounce';
        reasons.push(`RSI overbought at ${indicators.rsi.toFixed(1)}`);
        entryZone = {
          low: currentPrice * 0.995,
          high: currentPrice * 1.005,
        };
        suggestedStopLoss = currentPrice * 1.03;
      }

      // 3. Lower high formation (market structure)
      else if (
        marketStructure.structure === 'bearish' &&
        marketStructure.lastLowerHigh
      ) {
        const nearLowerHigh =
          Math.abs(currentPrice - marketStructure.lastLowerHigh.price) /
            currentPrice <
          0.015;
        if (nearLowerHigh) {
          signal = 'pullback_to_resistance';
          reasons.push('Price near recent lower high in bearish structure');
          entryZone = {
            low: marketStructure.lastLowerHigh.price * 0.99,
            high: marketStructure.lastLowerHigh.price,
          };
          suggestedStopLoss = marketStructure.lastLowerHigh.price * 1.015;
        }
      }
    }

    // Calculate R:R if we have entry and stop loss
    let riskRewardRatio: number | null = null;
    if (signal !== 'none' && entryZone && suggestedStopLoss) {
      const risk = Math.abs(currentPrice - suggestedStopLoss);
      const potentialReward = risk * 2; // Targeting 2R minimum
      riskRewardRatio = 2;
    }

    return {
      hasEntry: signal !== 'none',
      timeframe: signal !== 'none' ? timeframe : null,
      signal,
      reasons: reasons.length > 0 ? reasons : ['No valid entry signal'],
      entryZone,
      suggestedStopLoss,
      riskRewardRatio,
    };
  }

  /**
   * Build the 5-point entry checklist (Miraj Strategy)
   */
  buildEntryChecklist(
    allAnalyses: TimeframeAnalysis[],
    htfBias: HTFBiasResult,
    ltfEntry: LTFEntryResult,
  ): EntryChecklist {
    let score = 0;

    // 1. HTF Bias Confirmed (strong trend on higher timeframes)
    const htfBiasConfirmed =
      htfBias.bias !== 'neutral' && htfBias.confidence >= 60;
    if (htfBiasConfirmed) score++;

    // 2. Market Structure Aligned
    const htfAnalyses = allAnalyses.filter((a) =>
      HTF_TIMEFRAMES.includes(a.timeframe),
    );
    const marketStructureAligned =
      htfAnalyses.filter(
        (a) =>
          (htfBias.bias === 'bullish' &&
            a.marketStructure.structure === 'bullish') ||
          (htfBias.bias === 'bearish' &&
            a.marketStructure.structure === 'bearish'),
      ).length >=
      htfAnalyses.length / 2;
    if (marketStructureAligned) score++;

    // 3. Key Level Identified
    const keyLevelIdentified =
      ltfEntry.entryZone !== null ||
      allAnalyses.some(
        (a) => a.indicators.support !== null || a.indicators.resistance !== null,
      );
    if (keyLevelIdentified) score++;

    // 4. LTF Confirmation
    const ltfConfirmation =
      ltfEntry.hasEntry && ltfEntry.signal !== 'none';
    if (ltfConfirmation) score++;

    // 5. RSI Condition Met (not extreme or divergence present)
    const ltfAnalyses = allAnalyses.filter((a) =>
      LTF_TIMEFRAMES.includes(a.timeframe),
    );
    const rsiConditionMet = ltfAnalyses.some((a) => {
      const rsi = a.indicators.rsi;
      if (htfBias.bias === 'bullish') {
        return rsi < 60; // Not overbought for longs
      } else if (htfBias.bias === 'bearish') {
        return rsi > 40; // Not oversold for shorts
      }
      return rsi > 40 && rsi < 60; // Neutral zone
    });
    if (rsiConditionMet) score++;

    return {
      htfBiasConfirmed,
      marketStructureAligned,
      keyLevelIdentified,
      ltfConfirmation,
      rsiConditionMet,
      score,
      passed: score >= 4,
    };
  }

  /**
   * Build Miraj's 5-point entry checklist
   */
  private buildFivePointChecklist(
    allAnalyses: TimeframeAnalysis[],
    htfBias: HTFBiasResult,
    ltfEntry: LTFEntryResult,
    currentPrice: number,
  ): EntryChecklistResult {
    // Determine trade type based on HTF bias
    const tradeType: 'long' | 'short' =
      htfBias.bias === 'bullish' ? 'long' : 'short';

    // Get primary LTF for entry (prefer 1h, fallback to 4h)
    const primaryLTF =
      allAnalyses.find((a) => a.timeframe === '1h' && a.extendedIndicators) ||
      allAnalyses.find((a) => a.timeframe === '4h' && a.extendedIndicators) ||
      allAnalyses.find((a) => a.extendedIndicators);

    // Get HTF for market structure (prefer daily, fallback to 12h)
    const htfAnalysis =
      allAnalyses.find((a) => a.timeframe === '1d') ||
      allAnalyses.find((a) => a.timeframe === '12h') ||
      allAnalyses.find((a) => HTF_TIMEFRAMES.includes(a.timeframe));

    // Build checklist params
    const params: EntryChecklistParams = {
      tradeType,
      rsi: primaryLTF?.indicators.rsi ?? 50,
      qqeColor: primaryLTF?.extendedIndicators?.qqe.color ?? 'neutral',
      previousQQEColor: primaryLTF?.extendedIndicators?.qqe.previousColor,
      currentPrice,
      bollingerBands: primaryLTF?.indicators.bollingerBands ?? {
        upper: currentPrice * 1.02,
        middle: currentPrice,
        lower: currentPrice * 0.98,
      },
      bandWidth: primaryLTF?.extendedIndicators?.bandWidth ?? 4,
      marketStructure: htfAnalysis?.marketStructure.pattern ?? 'unknown',
      nearestLevel: this.findNearestLevelFromAnalyses(
        allAnalyses,
        currentPrice,
        tradeType,
      ),
    };

    return this.checklistService.evaluateChecklist(params);
  }

  /**
   * Find nearest support/resistance level from all analyses
   */
  private findNearestLevelFromAnalyses(
    analyses: TimeframeAnalysis[],
    currentPrice: number,
    tradeType: 'long' | 'short',
  ): { price: number; type: 'support' | 'resistance'; strength: number } | null {
    // Collect all key levels from analyses with extended indicators
    const allLevels: KeyLevel[] = [];
    for (const analysis of analyses) {
      if (analysis.extendedIndicators?.keyLevels) {
        allLevels.push(...analysis.extendedIndicators.keyLevels);
      }
    }

    if (allLevels.length === 0) {
      // Fallback to basic support/resistance from any analysis
      const withSR = analyses.find(
        (a) => a.indicators.support !== null || a.indicators.resistance !== null,
      );
      if (withSR) {
        const targetType = tradeType === 'long' ? 'support' : 'resistance';
        const price =
          targetType === 'support'
            ? withSR.indicators.support
            : withSR.indicators.resistance;
        if (price !== null) {
          return { price, type: targetType, strength: 1 };
        }
      }
      return null;
    }

    // Filter by correct type for trade direction
    const targetType = tradeType === 'long' ? 'support' : 'resistance';
    const relevantLevels = allLevels.filter((l) => l.type === targetType);

    if (relevantLevels.length === 0) return null;

    // Find nearest with highest strength
    const sorted = relevantLevels.sort((a, b) => {
      // Prefer stronger levels
      if (b.strength !== a.strength) return b.strength - a.strength;
      // Then by proximity
      return Math.abs(a.distance) - Math.abs(b.distance);
    });

    return {
      price: sorted[0].price,
      type: sorted[0].type,
      strength: sorted[0].strength,
    };
  }

  /**
   * Generate final trade suggestion based on all analysis
   */
  private generateTradeSuggestion(
    htfBias: HTFBiasResult,
    ltfEntry: LTFEntryResult,
    checklist: EntryChecklist,
    fivePointChecklist?: EntryChecklistResult,
  ): { action: 'long' | 'short' | 'wait'; confidence: number; reasoning: string } {
    // Use 5-point checklist if available (more accurate)
    if (fivePointChecklist) {
      return this.generateSuggestionFromFivePoint(
        htfBias,
        ltfEntry,
        fivePointChecklist,
      );
    }

    // Fallback to legacy checklist
    // Don't trade if checklist not passed
    if (!checklist.passed) {
      return {
        action: 'wait',
        confidence: 0,
        reasoning: `Entry checklist score ${checklist.score}/5 - need at least 4 conditions met`,
      };
    }

    // Don't trade if no HTF bias
    if (htfBias.bias === 'neutral') {
      return {
        action: 'wait',
        confidence: 0,
        reasoning: 'HTF bias is neutral - waiting for clearer direction',
      };
    }

    // Don't trade if no entry signal
    if (!ltfEntry.hasEntry) {
      return {
        action: 'wait',
        confidence: htfBias.confidence * 0.5,
        reasoning: `HTF ${htfBias.bias} bias confirmed but waiting for LTF entry signal`,
      };
    }

    // Valid entry
    const action = htfBias.bias === 'bullish' ? 'long' : 'short';
    const confidence = Math.round(
      (htfBias.confidence * 0.6 + checklist.score * 8) / 2,
    );

    const reasoning = [
      `${htfBias.bias.toUpperCase()} bias on ${htfBias.alignedTimeframes.join(', ')}`,
      `Entry signal: ${ltfEntry.signal} on ${ltfEntry.timeframe}`,
      `Checklist: ${checklist.score}/5 conditions met`,
      ...ltfEntry.reasons,
    ].join('. ');

    return {
      action,
      confidence,
      reasoning,
    };
  }

  /**
   * Generate trade suggestion using Miraj's 5-point checklist (60+ points needed)
   */
  private generateSuggestionFromFivePoint(
    htfBias: HTFBiasResult,
    ltfEntry: LTFEntryResult,
    checklist: EntryChecklistResult,
  ): { action: 'long' | 'short' | 'wait'; confidence: number; reasoning: string } {
    // Need 60+ points (3/5 conditions) for trade signal
    if (!checklist.passed) {
      const failedConditions = checklist.conditions
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', ');

      return {
        action: 'wait',
        confidence: checklist.totalScore,
        reasoning: `5-Point Checklist: ${checklist.totalScore}/100 (need 60+). Failed: ${failedConditions}`,
      };
    }

    // HTF bias must be confirmed for trading
    if (htfBias.bias === 'neutral') {
      return {
        action: 'wait',
        confidence: checklist.totalScore * 0.5,
        reasoning: 'Checklist passed but HTF bias is neutral - waiting for trend direction',
      };
    }

    // Checklist passed with 60+ points
    const action = checklist.tradeType;
    const confidence = checklist.totalScore;

    const passedConditions = checklist.conditions
      .filter((c) => c.passed)
      .map((c) => c.name)
      .join(', ');

    const reasoning = [
      `5-Point Checklist: ${checklist.totalScore}/100 (${checklist.conditionsMet}/5 conditions)`,
      `Trade type: ${action.toUpperCase()}`,
      `Passed: ${passedConditions}`,
      ltfEntry.hasEntry ? `Entry signal: ${ltfEntry.signal}` : '',
    ]
      .filter(Boolean)
      .join('. ');

    return {
      action,
      confidence,
      reasoning,
    };
  }
}
