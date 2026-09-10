import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { TimeInterval } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
import {
  MarketRegime,
  MarketRegimeResult,
} from './interfaces/market-regime.types';
import { classifyWithHysteresis, REGIME_HYSTERESIS } from './regime-hysteresis';
import { TIMEFRAME_MS } from '../common/replay/plan-replay';
import { Timeframe } from '../common/constants/timeframes';

/**
 * One bar's regime label, with the time of the bar it belongs to.
 *
 * Carries the time because a caller asking "when did the state change" cannot
 * recover it from an index: the series drops the indicator warm-up, so its
 * indices do not line up with the candles it came from.
 */
export interface LabelledBar {
  time: Date;
  regime: MarketRegime;
  reason: string;
  bandWidthPercentile: number;
}

/** The current regime and how long it has held. */
export interface RegimeState {
  regime: MarketRegime;
  /** Bars the label has held, including the current one. */
  ageBars: number;
  /** The same age in hours, from the timeframe of the series. */
  ageHours: number;
  /** True when the age ran back to the start of the data and may be longer. */
  ageTruncated: boolean;
  reason: string;
  bandWidthPercentile: number;
}

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

  /**
   * The regime AND its age, derived by replaying the label forward across the
   * candles in the context.
   *
   * Age is computed rather than remembered. The alternative — storing the last
   * label and counting runs since — needs state that survives a restart, a gap
   * in the schedule and a redeploy, and is wrong in a different way after each
   * of them. Replaying is deterministic: the same candles always give the same
   * age, and a missed run costs nothing.
   *
   * That also makes the hysteresis honest. The dead band only means something
   * if the previous label was itself produced by the dead band, and a
   * forward walk is the only way to guarantee that.
   *
   * Cost is one ADX pass per bar, which is O(n^2) over the window. At the 250
   * candles this is called with, that is ~62,000 operations — cheaper than the
   * fetch that produced them.
   */
  labelSeries(context: IndicatorContext): LabelledBar[] {
    const { candles, closes, highs, lows, bandWidthSeries } = context;
    const lookback = REGIME_HYSTERESIS.bandWidthLookback;
    if (bandWidthSeries.length < lookback + 2) return [];

    // bandWidthSeries drops the Bollinger warm-up, so it is shorter than the
    // candles. Line them up by their common right edge, never by index 0.
    const offset = closes.length - bandWidthSeries.length;

    const out: LabelledBar[] = [];
    let previous: MarketRegime | null = null;

    for (let k = lookback; k < bandWidthSeries.length; k += 1) {
      const bar = k + offset;
      const adx = this.indicatorsService.calculateADX(
        highs.slice(0, bar + 1) as number[],
        lows.slice(0, bar + 1) as number[],
        closes.slice(0, bar + 1) as number[],
      );
      if (!Number.isFinite(adx.adx)) continue;
      const history = bandWidthSeries.slice(k - lookback, k) as number[];
      const label = classifyWithHysteresis(bandWidthSeries[k], adx.adx, history, previous);
      previous = label.regime;
      out.push({ time: candles[bar].time, ...label });
    }

    return out;
  }

  classifySeries(context: IndicatorContext): RegimeState | null {
    const { timeframe } = context;
    const series = this.labelSeries(context);
    if (series.length === 0) return null;

    const labels = series.map((b) => b.regime);
    const last = series[series.length - 1];

    let ageBars = 1;
    for (let i = labels.length - 2; i >= 0 && labels[i] === last.regime; i -= 1) ageBars += 1;

    const ms = TIMEFRAME_MS[timeframe as Timeframe] ?? TIMEFRAME_MS['1h'];
    return {
      regime: last.regime,
      ageBars,
      ageHours: (ageBars * ms) / 3_600_000,
      // The label may well have held before the data started; saying "72h" when
      // the window only covers 72h would be asserting something unmeasured.
      ageTruncated: ageBars === labels.length,
      reason: last.reason,
      bandWidthPercentile: last.bandWidthPercentile,
    };
  }

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
   *
   * `previous` turns the thresholds into dead bands — see `regime-hysteresis.ts`
   * for why, and for the measurements that sized them. Passing null gives the
   * un-hysteretic answer, which is the right thing at the start of a series and
   * the wrong thing everywhere else: without it the label flickers, and Bar 1c
   * measured a median run of nine hours with 16.8% of runs lasting one or two.
   *
   * Callers that want the label AND its age should use `classifySeries`, which
   * derives both from the candles rather than needing state carried between
   * runs.
   */
  classifyFromContext(
    context: IndicatorContext,
    previous: MarketRegime | null = null,
  ): MarketRegimeResult {
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
    let regime: MarketRegime;
    let reason: string;

    if (hasReliableHistory) {
      const decision = classifyWithHysteresis(
        bandWidth,
        adx.adx,
        historical as number[],
        previous,
      );
      bandWidthPercentile = decision.bandWidthPercentile;
      regime = decision.regime;
      reason = decision.reason;

      const sorted = [...historical].sort((a, b) => a - b);
      const idx = Math.max(
        0,
        Math.min(
          sorted.length - 1,
          Math.floor((REGIME_HYSTERESIS.compressionEnterPct / 100) * (sorted.length - 1)),
        ),
      );
      bandWidthThreshold = sorted[idx];
    } else {
      // Too little history for a percentile, so no dead band either — there is
      // nothing to measure the band against. Stated in the reason rather than
      // silently applying a different rule.
      bandWidthThreshold = MarketRegimeService.COMPRESSION_FALLBACK_PCT;
      if (bandWidth < MarketRegimeService.COMPRESSION_FALLBACK_PCT) {
        regime = 'COMPRESSION';
        reason =
          `BB width ${bandWidth.toFixed(3)}% < ${MarketRegimeService.COMPRESSION_FALLBACK_PCT}% ` +
          `(percentile needs ${lookback} samples, only ${historical.length} available — no hysteresis)`;
      } else if (adx.adx > REGIME_HYSTERESIS.adxEnter) {
        regime = 'TRENDING';
        reason = `ADX ${adx.adx.toFixed(2)} > ${REGIME_HYSTERESIS.adxEnter} (+DI ${adx.pdi.toFixed(2)}, -DI ${adx.mdi.toFixed(2)})`;
      } else {
        regime = 'MEAN_REVERSION';
        reason = `ADX ${adx.adx.toFixed(2)} <= ${REGIME_HYSTERESIS.adxEnter} and BB width not compressed`;
      }
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
