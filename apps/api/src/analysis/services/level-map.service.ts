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
 * Timeframes the level map is built from, highest first.
 *
 * The playbook walks 12h → 4h → 1h: "STEP 1: Fibonacci Level Marking
 * (HTF — 12 Hour)", "STEP 2: Add Support/Resistance (4h Chart)",
 * "STEP 3: Add Support/Resistance (1h Chart)" (p51-52).
 *
 * S/R is also taken from 12h, which the playbook does not spell out — its
 * STEP 2/3 name only 4h and 1h. Included because the 12h candles are
 * already fetched for the Fibonacci anchor, HTF levels are the strongest
 * ones a trader marks, and STEP 4 returns to 12h for trendlines. Stated
 * rather than silent so it can be reverted if it proves noisy.
 */
export const LEVEL_TIMEFRAMES: Timeframe[] = [
  TIMEFRAMES.TWELVE_HOUR,
  TIMEFRAMES.FOUR_HOUR,
  TIMEFRAMES.ONE_HOUR,
];

/**
 * Timeframe whose swing range anchors the Fibonacci grid.
 *
 * The playbook's own anchor is 12h, but it also says "Weekly timeframe
 * acceptable too" (p51) — so this is a real choice inside its latitude, not
 * a fact. Hardcoded to 12h and surfaced in the output so it is never
 * implicit.
 */
export const FIB_ANCHOR_TIMEFRAME: Timeframe = TIMEFRAMES.TWELVE_HOUR;

/**
 * Timeframe whose ATR sets stop distance.
 *
 * This must be DECLARED, not inherited from whatever timeframe a caller
 * happened to ask about, because it dominates risk/reward completely.
 * Measured across BTC/ETH/SOL with identical zones, varying only this:
 *
 *   1d ATR -> blended R 0.09-0.67    (unusable)
 *   4h ATR -> blended R 0.22-1.76
 *   1h ATR -> blended R 0.41-3.61
 *
 * The reason is scale mismatch: confluence zones here sit ~0.4% apart while
 * a 1d ATR is ~2.4% of price, so ATR swamps the zone geometry and risk
 * becomes ATR, making R little more than target-distance / ATR. A number
 * that moves 10x on an argument nobody chose deliberately is not a property
 * of the setup.
 *
 * 4h is the choice: it is the playbook's own swing timeframe (p9, "4-hour:
 * Swing trading"), it sits between the level timeframes rather than outside
 * them, and it keeps stops wide enough not to be wicked out while leaving R
 * meaningful. It is surfaced in the output so it is never implicit.
 *
 * Note the tempting fix — fewer, stronger zones — was measured and makes R
 * WORSE (minSources 2 -> 3 took BTC long from 0.32R to 0.09R), because the
 * intermediate zones being removed are the targets.
 */
export const ATR_TIMEFRAME: Timeframe = TIMEFRAMES.FOUR_HOUR;

export interface LevelMap {
  symbol: string;
  /** Latest close of the lowest timeframe — the freshest candle-derived price. */
  spot: number;
  anchor: { timeframe: Timeframe; low: number; high: number } | null;
  fib: FibLevel[];
  /** ATR from `ATR_TIMEFRAME`, which is what stop distance is built from. */
  atr: number;
  atrTimeframe: Timeframe;
  marks: MarkedLevel[];
  zones: ConfluenceZone[];
  /** How many S/R levels each timeframe contributed. */
  perTimeframe: Array<{ timeframe: Timeframe; levels: number }>;
}

/**
 * LevelMapService
 *
 * Builds the multi-timeframe level map the analyst reports on: S/R from
 * each timeframe plus the playbook's quarter Fibonacci, then the confluence
 * zones where those marks agree.
 *
 * This is the piece that makes confluence mean something. Within a single
 * timeframe, agreement is mostly an artifact of one detector run twice; the
 * signal a trader actually looks for is a 4h level landing on a 12h Fib.
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
    // Each timeframe is cached independently, so parallel costs one round
    // trip rather than three.
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

    const byTimeframe = new Map<Timeframe, Candle[]>(
      series.map((s) => [s.timeframe, s.candles]),
    );

    // Freshest candle-derived price: the lowest timeframe closes most often.
    // Deliberately not the live ticker — every number in the map must come
    // from the same candles the levels do, so distances stay reproducible.
    const lowest = LEVEL_TIMEFRAMES[LEVEL_TIMEFRAMES.length - 1];
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
          // Source identity is what makes confluence independent: METHOD +
          // TIMEFRAME, and NOTHING per-level. Including the touch count here
          // would make two adjacent 12h resistances read as two sources and
          // clear minSources on their own. Touch counts travel in
          // `touchCount` for display instead.
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

    // ATR on its own declared timeframe, fetched separately when it is not
    // already one of the level timeframes.
    const atrCandles =
      byTimeframe.get(ATR_TIMEFRAME) ??
      (await this.binanceService.getCandles(
        symbol,
        ATR_TIMEFRAME as TimeInterval,
        CANDLE_LIMITS[ATR_TIMEFRAME],
      ));
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
