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
 * Decides what kind of market this is, which then decides which approach the
 * rest of the analysis takes:
 *
 *   COMPRESSION      quiet and coiled, price barely moving
 *   TRENDING         moving persistently in one direction
 *   MEAN_REVERSION   drifting sideways
 */
@Injectable()
export class MarketRegimeService {
  private readonly logger = new Logger(MarketRegimeService.name);

  /**
   * How many past readings "quiet" is measured against. Fixed on purpose: if
   * it followed however much data happened to be loaded, fetching more history
   * would silently change the answer.
   *
   * With fewer than this we use a simpler rule and say so, rather than quietly
   * measuring against a shorter history.
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

  /** Fetches its own data first. Use the version below if you already have it. */
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
   * The classification itself, from measurements already taken. Checked in
   * order:
   *
   *   1. quieter than 85% of its own history  -> COMPRESSION
   *   2. trend strength above 25              -> TRENDING
   *   3. otherwise                            -> MEAN_REVERSION
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
