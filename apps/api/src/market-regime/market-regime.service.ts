import { Injectable } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { TimeInterval } from '../common/types/candle.types';
import {
  MarketRegime,
  MarketRegimeResult,
} from './interfaces/market-regime.types';

/**
 * MarketRegimeService
 *
 * Acts as the "Master Switch" that classifies the current market state
 * (compression / trending / mean-reversion) so downstream strategy logic
 * can pick the appropriate playbook.
 *
 * This service is intentionally an orchestrator: it fetches candles via
 * BinanceService and applies pure indicator math from IndicatorsService.
 * Keeping the classification rules here (and out of IndicatorsService)
 * preserves the single-responsibility boundary between
 *   - pure math (IndicatorsService)
 *   - market I/O (BinanceService)
 *   - strategy classification (this service)
 */
@Injectable()
export class MarketRegimeService {
  // Minimum number of historical band-width samples required before we
  // trust the percentile-based COMPRESSION rule. Below this we fall back
  // to the strict < 1.5% absolute threshold.
  private static readonly BANDWIDTH_PERCENTILE_MIN_SAMPLES = 50;

  // Default candle window. Large enough to build a reliable BB-width
  // distribution (~230 BB(20) samples).
  private static readonly REGIME_CANDLE_LIMIT = 250;

  // ADX threshold above which the market is considered trending.
  private static readonly ADX_TREND_THRESHOLD = 25;

  // Percentile cutoff (0-1) defining "bottom X% of historical range".
  private static readonly COMPRESSION_PERCENTILE = 0.15;

  // Fallback strict bandwidth threshold (% of middle band) when there is
  // insufficient history to compute a reliable percentile.
  private static readonly COMPRESSION_FALLBACK_PCT = 1.5;

  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
  ) {}

  /**
   * Classify the current market regime for a given symbol / timeframe.
   *
   * Rules (evaluated in order):
   *   1. COMPRESSION    -> BB-width is in the bottom 15% of its historical
   *                       range. If we don't yet have enough history we
   *                       fall back to the strict rule: bandWidth < 1.5%.
   *   2. TRENDING       -> ADX(14) > 25.
   *   3. MEAN_REVERSION -> Otherwise (ADX <= 25 and not compressed).
   */
  async classifyMarketRegime(
    symbol: string,
    timeframe: string,
  ): Promise<MarketRegimeResult> {
    const candles = await this.binanceService.getCandles(
      symbol,
      timeframe as TimeInterval,
      MarketRegimeService.REGIME_CANDLE_LIMIT,
    );

    if (candles.length < 30) {
      throw new Error(
        `Insufficient candle data to classify regime for ${symbol} ${timeframe}: got ${candles.length}`,
      );
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // Core indicators.
    const rsi = this.indicatorsService.calculateRSI(closes);
    const bollingerBands = this.indicatorsService.calculateBollingerBands(closes);
    const atr = this.indicatorsService.calculateATR(highs, lows, closes);
    const adx = this.indicatorsService.calculateADX(highs, lows, closes);

    // Current bandwidth (% of middle band).
    const bandWidth = this.indicatorsService.calculateBandWidth(bollingerBands);

    // Historical bandwidth distribution (excludes the current sample so the
    // percentile reflects "where am I relative to the past?").
    const bandWidthSeries =
      this.indicatorsService.calculateBandWidthSeries(closes);
    const historical = bandWidthSeries.slice(0, -1);

    const hasReliableHistory =
      historical.length >= MarketRegimeService.BANDWIDTH_PERCENTILE_MIN_SAMPLES;

    let bandWidthPercentile: number | null = null;
    let bandWidthThreshold: number;
    let isCompressed: boolean;

    if (hasReliableHistory) {
      bandWidthPercentile = this.indicatorsService.percentileRank(
        bandWidth,
        historical,
      );
      const sorted = [...historical].sort((a, b) => a - b);
      const idx = Math.max(
        0,
        Math.min(
          sorted.length - 1,
          Math.floor(MarketRegimeService.COMPRESSION_PERCENTILE * (sorted.length - 1)),
        ),
      );
      bandWidthThreshold = sorted[idx];
      isCompressed = bandWidth <= bandWidthThreshold;
    } else {
      bandWidthThreshold = MarketRegimeService.COMPRESSION_FALLBACK_PCT;
      isCompressed = bandWidth < MarketRegimeService.COMPRESSION_FALLBACK_PCT;
    }

    let regime: MarketRegime;
    let reason: string;

    if (isCompressed) {
      regime = 'COMPRESSION';
      reason = hasReliableHistory
        ? `BB width ${bandWidth.toFixed(3)}% at ${bandWidthPercentile?.toFixed(1)}th percentile (<= 15th, cutoff ${bandWidthThreshold.toFixed(3)}%)`
        : `BB width ${bandWidth.toFixed(3)}% < ${MarketRegimeService.COMPRESSION_FALLBACK_PCT}% (historical percentile unavailable)`;
    } else if (adx.adx > MarketRegimeService.ADX_TREND_THRESHOLD) {
      regime = 'TRENDING';
      reason = `ADX ${adx.adx.toFixed(2)} > ${MarketRegimeService.ADX_TREND_THRESHOLD} (+DI ${adx.pdi.toFixed(2)}, -DI ${adx.mdi.toFixed(2)})`;
    } else {
      regime = 'MEAN_REVERSION';
      reason = `ADX ${adx.adx.toFixed(2)} <= ${MarketRegimeService.ADX_TREND_THRESHOLD} and BB width not compressed`;
    }

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      regime,
      reason,
      metrics: {
        adx: adx.adx,
        pdi: adx.pdi,
        mdi: adx.mdi,
        rsi,
        atr,
        bandWidth,
        bandWidthPercentile,
        bandWidthThreshold,
        bollingerBands,
      },
    };
  }
}
