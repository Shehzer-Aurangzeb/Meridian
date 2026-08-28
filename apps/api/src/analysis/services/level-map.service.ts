import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../../market-data/market-data.service';
import { Candle, TimeInterval } from '../../common/types/candle.types';
import {
  CANDLE_LIMITS,
  Timeframe,
  TIMEFRAMES,
} from '../../common/constants/timeframes';
import {
  ConfluenceZone,
  FibLevel,
  MarkedLevel,
} from '../interfaces/support-resistance.types';
import { SupportResistanceService } from './support-resistance.service';
import { IndicatorsService } from '../../indicators/indicators.service';

/**
 * The chart timeframes levels are marked on, SLOWEST FIRST. Slower charts
 * carry the stronger levels, and each mark says which chart it came from.
 *
 * The order is load-bearing twice over: `buildFrom` reads spot off the LAST
 * entry (the fastest chart), and the marks are laid down in this order, which
 * decides which one wins a tie inside the greedy grouping walk.
 */
export const LEVEL_TIMEFRAMES: Timeframe[] = [
  TIMEFRAMES.TWELVE_HOUR,
  TIMEFRAMES.FOUR_HOUR,
  TIMEFRAMES.ONE_HOUR,
];

/**
 * Which chart the Fibonacci grid is measured from. A real choice, not a fact,
 * so it is reported in the output rather than left implicit.
 */
export const FIB_ANCHOR_TIMEFRAME: Timeframe = TIMEFRAMES.TWELVE_HOUR;

/**
 * Which chart's volatility (ATR) sets how far the stop sits past the zone.
 *
 * Stated here on purpose rather than following whatever chart the caller
 * asked about, because it changes the reward-to-risk of every plan by up to
 * ten times. A daily reading is far wider than the gap between zones, which
 * would swamp the plan's own shape; 4h is wide enough not to be caught by a
 * brief spike, and is reported in the output.
 */
export const ATR_TIMEFRAME: Timeframe = TIMEFRAMES.FOUR_HOUR;

export interface LevelMap {
  symbol: string;
  /** The most recent closing price, from the fastest chart. */
  spot: number;
  anchor: { timeframe: Timeframe; low: number; high: number } | null;
  fib: FibLevel[];
  /** Recent volatility, used to set stop distance. */
  atr: number;
  atrTimeframe: Timeframe;
  marks: MarkedLevel[];
  zones: ConfluenceZone[];
  /** How many S/R levels each timeframe contributed. */
  perTimeframe: Array<{ timeframe: Timeframe; levels: number }>;
}

/**
 * Builds the map of important price levels: support and resistance from each
 * chart, plus Fibonacci levels, then the ZONES where several of those land on
 * top of each other.
 *
 * Agreement across DIFFERENT charts is the point. Two levels found the same
 * way on the same chart is not evidence of anything.
 */
@Injectable()
export class LevelMapService {
  private readonly logger = new Logger(LevelMapService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly supportResistanceService: SupportResistanceService,
    private readonly indicatorsService: IndicatorsService,
  ) {}

  async build(symbol: string): Promise<LevelMap> {
    // Fetched together; each chart is cached separately.
    const series = await Promise.all(
      LEVEL_TIMEFRAMES.map(async (timeframe) => ({
        timeframe,
        candles: await this.binanceService.getCandles(
          symbol,
          timeframe as TimeInterval,
          CANDLE_LIMITS[timeframe],
        ),
      })),
    );

    // Volatility comes from its own chart, fetched only if not already loaded.
    const atrCandles =
      series.find((s) => s.timeframe === ATR_TIMEFRAME)?.candles ??
      (await this.binanceService.getCandles(
        symbol,
        ATR_TIMEFRAME as TimeInterval,
        CANDLE_LIMITS[ATR_TIMEFRAME],
      ));

    return this.buildFrom(symbol, series, atrCandles);
  }

  /**
   * The map itself, built from price data the caller already has.
   *
   * Kept separate from fetching so the backtest can rebuild the map as it
   * stood at any past moment by handing in a shortened history.
   */
  buildFrom(
    symbol: string,
    series: Array<{ timeframe: Timeframe; candles: Candle[] }>,
    atrCandles: Candle[],
  ): LevelMap {
    const byTimeframe = new Map<Timeframe, Candle[]>(
      series.map((s) => [s.timeframe, s.candles]),
    );

    // Deliberately the last closing price, not the live ticker: every number
    // in the map must come from the same data, or distances cannot be checked.
    //
    // Taken from the series HANDED IN rather than from LEVEL_TIMEFRAMES, so a
    // caller running a subset of charts gets that subset's fastest close. The
    // list is slowest-first by contract; see LEVEL_TIMEFRAMES above.
    const lowest = series[series.length - 1]?.timeframe;
    if (!lowest) throw new Error(`No series for ${symbol}; cannot build a level map`);
    const lowestCandles = byTimeframe.get(lowest) ?? [];
    if (lowestCandles.length === 0) {
      throw new Error(`No candles for ${symbol} ${lowest}; cannot build a level map`);
    }
    const spot = lowestCandles[lowestCandles.length - 1].close;

    // ── Fibonacci, anchored to one timeframe's swing range ──────────────
    const anchorCandles = byTimeframe.get(FIB_ANCHOR_TIMEFRAME) ?? [];
    const swings = this.supportResistanceService.fibAnchors(anchorCandles);
    const anchor = swings
      ? { timeframe: FIB_ANCHOR_TIMEFRAME, low: swings.low, high: swings.high }
      : null;
    const fib = swings
      ? this.supportResistanceService.fibLevels(swings.low, swings.high)
      : [];

    // ── S/R per timeframe ───────────────────────────────────────────────
    const perTimeframe: LevelMap['perTimeframe'] = [];
    const marks: MarkedLevel[] = [];

    for (const { timeframe, candles } of series) {
      const levels = this.supportResistanceService.levelsFromCandles(
        candles,
        timeframe,
        spot,
      );
      perTimeframe.push({ timeframe, levels: levels.length });

      for (const level of levels) {
        marks.push({
          price: level.price,
          type: level.type,
          // A "source" is the method plus the chart, and nothing else. If it
          // included per-level detail, two levels found the same way on the
          // same chart would count as two independent sources.
          source: `${timeframe} ${level.type}`,
          touchCount: level.touchCount,
        });
      }
    }

    for (const level of fib) {
      marks.push({
        price: level.price,
        type: level.type,
        source: `${level.ratio} Fib (${FIB_ANCHOR_TIMEFRAME})`,
      });
    }

    const zones = this.supportResistanceService.findConfluenceZones(marks, spot);

    const atr = this.indicatorsService.buildContext(
      symbol,
      ATR_TIMEFRAME,
      atrCandles,
    ).atr;

    this.logger.debug(
      `${symbol}: ${marks.length} marks across ${LEVEL_TIMEFRAMES.join('/')} ` +
        `=> ${zones.length} confluence zone(s)`,
    );

    return {
      symbol,
      spot,
      anchor,
      fib,
      atr,
      atrTimeframe: ATR_TIMEFRAME,
      marks,
      zones,
      perTimeframe,
    };
  }
}
