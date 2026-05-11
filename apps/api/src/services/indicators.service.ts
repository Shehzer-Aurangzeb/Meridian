import { Injectable } from '@nestjs/common';
import { RSI, BollingerBands, ATR } from 'technicalindicators';
import { Candle } from '../types/candle.types';
import {
  IndicatorResults,
  BollingerBandsResult,
  SupportResistanceResult,
} from '../types/indicator.types';

@Injectable()
export class IndicatorsService {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param closes - Array of closing prices
   * @param period - RSI period (default 14)
   * @returns Latest RSI value
   */
  calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) {
      throw new Error(
        `Insufficient data for RSI calculation. Need at least ${period + 1} candles, got ${closes.length}`,
      );
    }

    const rsiValues = RSI.calculate({
      values: closes,
      period,
    });

    if (rsiValues.length === 0) {
      throw new Error('RSI calculation returned no values');
    }

    const latestRSI = rsiValues[rsiValues.length - 1];
    if (latestRSI === undefined || isNaN(latestRSI)) {
      throw new Error('RSI calculation returned invalid value');
    }

    return latestRSI;
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

    const bbValues = BollingerBands.calculate({
      values: closes,
      period,
      stdDev,
    });

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

    const atrValues = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });

    if (atrValues.length === 0) {
      throw new Error('ATR calculation returned no values');
    }

    const latestATR = atrValues[atrValues.length - 1];
    if (latestATR === undefined || isNaN(latestATR)) {
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
}
