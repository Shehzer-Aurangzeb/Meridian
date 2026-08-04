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
  ExtendedIndicatorResults,
  BollingerBandsResult,
  SupportResistanceResult,
  QQEResult,
  KeyLevel,
  ADXResult,
} from './interfaces/indicator.types';

@Injectable()
export class IndicatorsService {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param closes - Array of closing prices
   * @param period - RSI period (default 14)
   * @returns Latest RSI value
   */
  calculateRSI(closes: number[], period: number = 14): number {
    const rsiValues = this.calculateRSISeries(closes, period);
    return rsiValues[rsiValues.length - 1];
  }

  /**
   * Calculate the full RSI series (not just the latest value).
   *
   * The checklist needs a trailing window of *RSI* values to compute a
   * relative-momentum Z-score. `RSI.calculate` already produces the whole
   * series, so exposing it costs nothing over `calculateRSI`.
   *
   * @param closes - Array of closing prices
   * @param period - RSI period (default 14)
   * @returns RSI values, oldest first. Last element is guaranteed finite.
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
   * Calculate Bollinger Bands
   * @param closes - Array of closing prices
   * @param period - Moving average period (default 20)
   * @param stdDev - Standard deviation multiplier (default 2)
   * @returns Latest Bollinger Bands values (upper, middle, lower)
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

  /**
   * Calculate ATR (Average True Range)
   * @param highs - Array of high prices
   * @param lows - Array of low prices
   * @param closes - Array of closing prices
   * @param period - ATR period (default 14)
   * @returns Latest ATR value
   */
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

  /**
   * Identify support and resistance levels
   * @param candles - Array of candle data
   * @param lookback - Number of candles to look back (default 20)
   * @returns Support and resistance levels
   */
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
   * Identify key support and resistance levels with strength metrics
   * Strength is measured by how many times price has tested the level
   */
  identifyKeyLevels(candles: Candle[], currentPrice: number, tolerance: number = 0.5): KeyLevel[] {
    if (candles.length < 20) {
      return [];
    }

    const levels: Map<number, { type: 'support' | 'resistance'; touches: number }> = new Map();

    // Round price to create price zones (0.5% tolerance)
    const roundToZone = (price: number): number => {
      const zone = currentPrice * (tolerance / 100);
      return Math.round(price / zone) * zone;
    };

    // Find swing highs and lows
    for (let i = 2; i < candles.length - 2; i++) {
      const current = candles[i];

      // Swing high (resistance)
      if (
        current.high > candles[i - 1].high &&
        current.high > candles[i - 2].high &&
        current.high > candles[i + 1].high &&
        current.high > candles[i + 2].high
      ) {
        const zone = roundToZone(current.high);
        const existing = levels.get(zone);
        if (existing && existing.type === 'resistance') {
          existing.touches++;
        } else {
          levels.set(zone, { type: 'resistance', touches: 1 });
        }
      }

      // Swing low (support)
      if (
        current.low < candles[i - 1].low &&
        current.low < candles[i - 2].low &&
        current.low < candles[i + 1].low &&
        current.low < candles[i + 2].low
      ) {
        const zone = roundToZone(current.low);
        const existing = levels.get(zone);
        if (existing && existing.type === 'support') {
          existing.touches++;
        } else {
          levels.set(zone, { type: 'support', touches: 1 });
        }
      }
    }

    // Convert to array and calculate distance
    const keyLevels: KeyLevel[] = [];
    levels.forEach((data, price) => {
      const distance = ((price - currentPrice) / currentPrice) * 100;
      keyLevels.push({
        price,
        type: data.type,
        strength: data.touches,
        distance,
      });
    });

    // Sort by strength (descending) then distance (ascending)
    return keyLevels.sort((a, b) => {
      if (b.strength !== a.strength) return b.strength - a.strength;
      return Math.abs(a.distance) - Math.abs(b.distance);
    });
  }

  /**
   * Find nearest support or resistance level
   */
  findNearestLevel(
    keyLevels: KeyLevel[],
    currentPrice: number,
    type: 'support' | 'resistance' | 'any' = 'any',
  ): KeyLevel | null {
    const filtered =
      type === 'any' ? keyLevels : keyLevels.filter((l) => l.type === type);

    if (filtered.length === 0) return null;

    // Find nearest by distance
    return filtered.reduce((nearest, level) => {
      const nearestDist = Math.abs(nearest.distance);
      const levelDist = Math.abs(level.distance);
      return levelDist < nearestDist ? level : nearest;
    });
  }

  /**
   * Extended timeframe analysis with QQE, band width, and key levels
   */
  analyzeTimeframeExtended(candles: Candle[]): ExtendedIndicatorResults {
    // Get basic indicators
    const basic = this.analyzeTimeframe(candles);

    // Extract closes for QQE
    const closes = candles.map((c) => c.close);
    const currentPrice = closes[closes.length - 1];

    // Calculate extended indicators
    const qqe = this.calculateQQE(closes);
    const bandWidth = this.calculateBandWidth(basic.bollingerBands);
    const keyLevels = this.identifyKeyLevels(candles, currentPrice);

    return {
      ...basic,
      qqe,
      bandWidth,
      keyLevels,
    };
  }

  /**
   * Calculate ADX (Average Directional Index) with +DI / -DI.
   *
   * Uses Wilder's smoothing via `trading-signals` (see ./series.ts).
   * Requires roughly 2 * period candles to produce a stable value.
   *
   * @param highs  - Array of high prices
   * @param lows   - Array of low prices
   * @param closes - Array of closing prices
   * @param period - ADX period (default 14)
   * @returns Latest ADX, +DI, -DI and DX values
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
   * Build an `IndicatorContext` from a candle series.
   *
   * Computes every baseline indicator needed by downstream strategy
   * services (regime classifier, squeeze breakout, checklist) exactly
   * once, so the coordinator can share a single context object across
   * the entire analysis pipeline.
   *
   * Pure function: no I/O, no caching, no side effects. The returned
   * object is mathematically identical to what each service would have
   * computed on its own from the same candle dataset.
   *
   * @param symbol    Base symbol (uppercased for the context).
   * @param timeframe Candle interval used for the fetch.
   * @param candles   Raw OHLCV series (already fetched by BinanceService).
   *
   * @throws If the supplied candle series is too small to compute the
   *         core indicators (RSI / BB / ADX require >= 30 candles).
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

    // Trailing window of RSI values, used by the checklist to Z-score the
    // current RSI against its own recent distribution.
    //
    // This previously held the last 100 *closes*, so the checklist computed
    // (rsi - mean(price)) / stdDev(price) — for BTC at ~$100k that yields
    // Z ≈ -66 every run, which made every LONG pass condition 1 for free
    // and every SHORT fail it.
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
