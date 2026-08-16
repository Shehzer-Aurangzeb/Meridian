import { Injectable } from '@nestjs/common';
import {
  adxLatest,
  atrLatest,
  bollingerSeries,
  emaSeries,
  rsiSeries as rsiSeriesOf,
} from './series';
import { Candle } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
import {
  IndicatorResults,
  BollingerBandsResult,
  SupportResistanceResult,
  QQEResult,
  ADXResult,
} from './interfaces/indicator.types';

@Injectable()
export class IndicatorsService {
  /** Momentum, 0-100. High means price has risen hard recently, low the opposite. */
  calculateRSI(closes: number[], period: number = 14): number {
    const rsiValues = this.calculateRSISeries(closes, period);
    return rsiValues[rsiValues.length - 1];
  }

  /**
   * The whole momentum history, not just the latest. The checklist compares
   * today's reading against its own recent range, which needs the series.
   */
  calculateRSISeries(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) {
      throw new Error(
        `Insufficient data for RSI calculation. Need at least ${period + 1} candles, got ${closes.length}`,
      );
    }

    const rsiValues = rsiSeriesOf(closes, period);

    if (rsiValues.length === 0) {
      throw new Error('RSI calculation returned no values');
    }

    const latestRSI = rsiValues[rsiValues.length - 1];
    if (latestRSI === undefined || isNaN(latestRSI)) {
      throw new Error('RSI calculation returned invalid value');
    }

    return rsiValues;
  }

  /**
   * A band around the average price that widens when the market is volatile
   * and narrows when it is quiet.
   */
  calculateBollingerBands(
    closes: number[],
    period: number = 20,
    stdDev: number = 2,
  ): BollingerBandsResult {
    if (closes.length < period) {
      throw new Error(
        `Insufficient data for Bollinger Bands calculation. Need at least ${period} candles, got ${closes.length}`,
      );
    }

    const bbValues = bollingerSeries(closes, period, stdDev);

    if (bbValues.length === 0) {
      throw new Error('Bollinger Bands calculation returned no values');
    }

    const latest = bbValues[bbValues.length - 1];
    if (
      !latest ||
      latest.upper === undefined ||
      latest.middle === undefined ||
      latest.lower === undefined
    ) {
      throw new Error('Bollinger Bands calculation returned invalid values');
    }

    return {
      upper: latest.upper,
      middle: latest.middle,
      lower: latest.lower,
    };
  }

  /** How far price typically moves in one bar. Used to size stop distance. */
  calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14,
  ): number {
    if (
      highs.length < period + 1 ||
      lows.length < period + 1 ||
      closes.length < period + 1
    ) {
      throw new Error(
        `Insufficient data for ATR calculation. Need at least ${period + 1} candles, got ${Math.min(highs.length, lows.length, closes.length)}`,
      );
    }

    const latestATR = atrLatest(highs, lows, closes, period);
    if (isNaN(latestATR)) {
      throw new Error('ATR calculation returned invalid value');
    }

    return latestATR;
  }

  /** Prices that have repeatedly stopped a move up or down. */
  identifySupportResistance(
    candles: Candle[],
    lookback: number = 20,
  ): SupportResistanceResult {
    if (candles.length === 0) {
      return { support: null, resistance: null };
    }

    // Use the last N candles for analysis
    const recentCandles = candles.slice(-lookback);

    if (recentCandles.length === 0) {
      return { support: null, resistance: null };
    }

    // Find lowest low (support) and highest high (resistance)
    const lows = recentCandles.map((c) => c.low);
    const highs = recentCandles.map((c) => c.high);

    const support = Math.min(...lows);
    const resistance = Math.max(...highs);

    return { support, resistance };
  }

  /**
   * Analyze a timeframe with all indicators
   * @param candles - Array of candle data
   * @returns Complete indicator analysis
   */
  analyzeTimeframe(candles: Candle[]): IndicatorResults {
    if (candles.length < 21) {
      throw new Error(
        `Insufficient candle data for analysis. Need at least 21 candles, got ${candles.length}`,
      );
    }

    // Extract price arrays from candles
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // Calculate all indicators
    const rsi = this.calculateRSI(closes);
    const bollingerBands = this.calculateBollingerBands(closes);
    const atr = this.calculateATR(highs, lows, closes);
    const { support, resistance } = this.identifySupportResistance(candles);

    return {
      rsi,
      bollingerBands,
      atr,
      support,
      resistance,
    };
  }

  /**
   * Calculate QQE (Quantitative Qualitative Estimation)
   * This is a proxy implementation based on RSI momentum and smoothing
   * Green = bullish momentum, Red = bearish momentum
   */
  calculateQQE(closes: number[], period: number = 14): QQEResult {
    if (closes.length < period * 2) {
      return {
        color: 'neutral',
        value: 50,
        previousColor: 'neutral',
        trend: 'flat',
      };
    }

    // Calculate RSI values
    const rsiValues = rsiSeriesOf(closes, period);

    if (rsiValues.length < 5) {
      return {
        color: 'neutral',
        value: 50,
        previousColor: 'neutral',
        trend: 'flat',
      };
    }

    // Smooth RSI with EMA (QQE uses smoothed RSI)
    const smoothingPeriod = 5;
    const smoothedRSI = emaSeries(rsiValues, smoothingPeriod);

    if (smoothedRSI.length < 2) {
      return {
        color: 'neutral',
        value: rsiValues[rsiValues.length - 1],
        previousColor: 'neutral',
        trend: 'flat',
      };
    }

    const currentSmoothedRSI = smoothedRSI[smoothedRSI.length - 1];
    const previousSmoothedRSI = smoothedRSI[smoothedRSI.length - 2];
    const olderSmoothedRSI = smoothedRSI.length > 2 ? smoothedRSI[smoothedRSI.length - 3] : previousSmoothedRSI;

    // Determine trend
    let trend: 'rising' | 'falling' | 'flat' = 'flat';
    const trendThreshold = 0.5;

    if (currentSmoothedRSI - previousSmoothedRSI > trendThreshold) {
      trend = 'rising';
    } else if (previousSmoothedRSI - currentSmoothedRSI > trendThreshold) {
      trend = 'falling';
    }

    // Determine previous trend for color transition
    let previousTrend: 'rising' | 'falling' | 'flat' = 'flat';
    if (previousSmoothedRSI - olderSmoothedRSI > trendThreshold) {
      previousTrend = 'rising';
    } else if (olderSmoothedRSI - previousSmoothedRSI > trendThreshold) {
      previousTrend = 'falling';
    }

    // Determine color based on RSI value and trend
    // Green (bullish) when RSI is rising or above 50 with upward momentum
    // Red (bearish) when RSI is falling or below 50 with downward momentum
    let color: 'green' | 'red' | 'neutral' = 'neutral';
    let previousColor: 'green' | 'red' | 'neutral' = 'neutral';

    if (currentSmoothedRSI > 50 && trend === 'rising') {
      color = 'green';
    } else if (currentSmoothedRSI < 50 && trend === 'falling') {
      color = 'red';
    } else if (trend === 'rising') {
      color = 'green';
    } else if (trend === 'falling') {
      color = 'red';
    }

    if (previousSmoothedRSI > 50 && previousTrend === 'rising') {
      previousColor = 'green';
    } else if (previousSmoothedRSI < 50 && previousTrend === 'falling') {
      previousColor = 'red';
    } else if (previousTrend === 'rising') {
      previousColor = 'green';
    } else if (previousTrend === 'falling') {
      previousColor = 'red';
    }

    return {
      color,
      value: currentSmoothedRSI,
      previousColor,
      trend,
    };
  }

  /**
   * Calculate Bollinger Band width as a percentage
   * Used to detect squeeze (low volatility) vs expansion
   */
  calculateBandWidth(bands: BollingerBandsResult): number {
    const width = bands.upper - bands.lower;
    return (width / bands.middle) * 100;
  }


  /**
   * Trend strength, and which way it points. Above about 25 counts as a real
   * trend. Needs roughly twice the period in bars before it settles.
   */
  calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14,
  ): ADXResult {
    const minRequired = period * 2 + 1;
    if (
      highs.length < minRequired ||
      lows.length < minRequired ||
      closes.length < minRequired
    ) {
      throw new Error(
        `Insufficient data for ADX calculation. Need at least ${minRequired} candles, got ${Math.min(highs.length, lows.length, closes.length)}`,
      );
    }

    const latest = adxLatest(highs, lows, closes, period);
    if (isNaN(latest.adx) || isNaN(latest.pdi) || isNaN(latest.mdi)) {
      throw new Error('ADX calculation returned invalid values');
    }

    // DX is the pre-smoothed directional index for the latest bar.
    const diSum = latest.pdi + latest.mdi;
    const dx = diSum === 0 ? 0 : (Math.abs(latest.pdi - latest.mdi) / diSum) * 100;

    return {
      adx: latest.adx,
      pdi: latest.pdi,
      mdi: latest.mdi,
      dx,
    };
  }

  /**
   * Calculate a rolling series of Bollinger Band widths (as percentages of
   * the middle band) over the supplied closes. Used to derive the historical
   * percentile distribution required by the regime classifier.
   */
  calculateBandWidthSeries(
    closes: number[],
    period: number = 20,
    stdDev: number = 2,
  ): number[] {
    if (closes.length < period) return [];

    const bbSeries = bollingerSeries(closes, period, stdDev);
    const widths: number[] = [];
    for (const bb of bbSeries) {
      if (
        bb &&
        bb.upper !== undefined &&
        bb.lower !== undefined &&
        bb.middle !== undefined &&
        bb.middle !== 0 &&
        !isNaN(bb.upper) &&
        !isNaN(bb.lower) &&
        !isNaN(bb.middle)
      ) {
        widths.push(((bb.upper - bb.lower) / bb.middle) * 100);
      }
    }
    return widths;
  }

  /**
   * Compute the percentile rank (0-100) of `value` within `series`,
   * using the inclusive (<=) definition.
   */
  percentileRank(value: number, series: number[]): number {
    if (series.length === 0) return 0;
    let countLE = 0;
    for (const v of series) if (v <= value) countLE++;
    return (countLE / series.length) * 100;
  }

  /**
   * Works out every measurement once, from one set of price bars, so the rest
   * of the analysis can share them instead of recalculating.
   *
   * Throws if there are too few bars to measure anything reliably.
   */
  buildContext(
    symbol: string,
    timeframe: string,
    candles: Candle[],
  ): IndicatorContext {
    if (candles.length < 30) {
      throw new Error(
        `Insufficient candles to build IndicatorContext for ${symbol} ${timeframe}: ` +
          `got ${candles.length}, need at least 30`,
      );
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const rsiSeries = this.calculateRSISeries(closes);
    const rsi = rsiSeries[rsiSeries.length - 1];
    const bollingerBands = this.calculateBollingerBands(closes);
    const bandWidth = this.calculateBandWidth(bollingerBands);
    const bandWidthSeries = this.calculateBandWidthSeries(closes);
    const atr = this.calculateATR(highs, lows, closes);
    const adx = this.calculateADX(highs, lows, closes);
    const qqe = this.calculateQQE(closes);

    // Recent momentum readings, so the checklist can judge today's against
    // its own recent range rather than against a fixed threshold.
    const rsiHistory = rsiSeries.slice(-100);

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      candles,
      closes,
      highs,
      lows,
      volumes,
      rsi,
      rsiHistory,
      adx,
      atr,
      bollingerBands,
      bandWidth,
      bandWidthSeries,
      qqe,
    };
  }
}
