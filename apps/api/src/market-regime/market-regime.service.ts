import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { TimeInterval } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
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
 * Two entry points:
 *   - `classifyMarketRegime(symbol, timeframe)` — legacy convenience:
 *     fetches its own candles and builds an `IndicatorContext` internally.
 *     Kept for direct callers that don't yet share a context.
 *   - `classifyFromContext(ctx)` — preferred path used by
 *     `AnalysisCoordinatorService`. Pure transform on a pre-built
 *     context, no I/O, no re-computation.
 *
 * Mathematically identical between the two paths.
 */
@Injectable()
export class MarketRegimeService {
  private readonly logger = new Logger(MarketRegimeService.name);

  /**
   * How many historical band-width samples the COMPRESSION percentile is
   * measured over. A DECLARED CHOICE, not an accident of the fetch size.
   *
   * This used to be "however many samples `bandWidthSeries` happened to
   * contain", i.e. `candles - interval + 1 - 1`. Both the percentile rank
   * AND the 15th-percentile cutoff (`sorted[idx]`) scale with that length,
   * so raising the candle limit from 250 to 1000 silently moved the
   * COMPRESSION verdict with nothing in the code or output explaining why.
   *
   * 200 samples: comfortably enough to estimate a 15th percentile, and
   * available with headroom at the 250-candle default fetch
   * (BB(20) over 250 closes yields ~230 samples).
   *
   * Below this we do NOT quietly compute over fewer — that is the behaviour
   * being removed. We take the explicit fallback path instead, and say so.
   */
  private static readonly BANDWIDTH_PERCENTILE_LOOKBACK = 200;

  // Default candle window. Must be large enough to supply
  // BANDWIDTH_PERCENTILE_LOOKBACK samples: BB(20) over 250 closes yields
  // ~230, leaving ~30 of headroom over the 200 required.
  public static readonly REGIME_CANDLE_LIMIT = 250;

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
   * Convenience wrapper: fetches candles, builds an `IndicatorContext`,
   * and delegates to `classifyFromContext`. Use this only when the caller
   * does not already have a shared context.
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

    const context = this.indicatorsService.buildContext(
      symbol,
      timeframe,
      candles,
    );

    return this.classifyFromContext(context);
  }

  /**
   * Classify the market regime from a pre-built `IndicatorContext`.
   *
   * Pure synchronous transform — no I/O, no recomputation. This is the
   * preferred entry point from `AnalysisCoordinatorService`, which
   * builds the context once and shares it across all downstream
   * services.
   *
   * Rules (evaluated in order):
   *   1. COMPRESSION    -> BB-width is in the bottom 15% of its historical
   *                       range. If we don't yet have enough history we
   *                       fall back to the strict rule: bandWidth < 1.5%.
   *   2. TRENDING       -> ADX(14) > 25.
   *   3. MEAN_REVERSION -> Otherwise (ADX <= 25 and not compressed).
   */
  classifyFromContext(context: IndicatorContext): MarketRegimeResult {
    const { symbol, timeframe, candles, bandWidth, bandWidthSeries, adx, rsi, atr, bollingerBands } =
      context;

    if (candles.length < 30) {
      throw new Error(
        `Insufficient candle data to classify regime for ${symbol} ${timeframe}: got ${candles.length}`,
      );
    }

    // Historical bandwidth distribution. Excludes the current sample so the
    // percentile answers "where am I relative to the past?", and is capped to
    // an explicit lookback so neither the rank nor the cutoff depends on how
    // many candles the caller happened to fetch.
    const available = bandWidthSeries.slice(0, -1);
    const lookback = MarketRegimeService.BANDWIDTH_PERCENTILE_LOOKBACK;
    const historical = available.slice(-lookback);

    const hasReliableHistory = historical.length >= lookback;

    if (!hasReliableHistory) {
      this.logger.warn(
        `${symbol} ${timeframe}: only ${historical.length} band-width samples available, ` +
          `need ${lookback} — percentile suppressed, falling back to the absolute ` +
          `${MarketRegimeService.COMPRESSION_FALLBACK_PCT}% threshold`,
      );
    }

    let bandWidthPercentile: number | null = null;
    let bandWidthThreshold: number;
    let isCompressed: boolean;

    if (hasReliableHistory) {
      bandWidthPercentile = this.indicatorsService.percentileRank(
        bandWidth,
        historical as number[],
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
        ? `BB width ${bandWidth.toFixed(3)}% at ${bandWidthPercentile?.toFixed(1)}th percentile ` +
          `(<= 15th, cutoff ${bandWidthThreshold.toFixed(3)}%) measured over ${historical.length} samples`
        : `BB width ${bandWidth.toFixed(3)}% < ${MarketRegimeService.COMPRESSION_FALLBACK_PCT}% ` +
          `(percentile needs ${lookback} samples, only ${historical.length} available)`;
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
        bandWidthLookback: lookback,
        bandWidthSamples: historical.length,
        bollingerBands,
      },
    };
  }
}
