import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { TimeInterval } from '../common/types/candle.types';
import { conesForHour, trailingBaseline, Cone, CoinFeatures } from './expected-move.math';
import {
  FEATURE_ORDER, BASELINE_WINDOW_HOURS, HORIZONS, ExpectedMoveHorizon,
} from './fitted';

export interface ExpectedMove {
  symbol: string;
  /** Keyed by horizon in hours. Values are fractions: 0.0062 is 62 bp. */
  cones: Record<number, Cone>;
  /**
   * False when the coin was priced without its cross-sectional tilt, which
   * happens only if the universe could not be assembled. The number is still a
   * forecast, from volatility clustering alone, and it is weaker.
   */
  hasTilt: boolean;
}

/**
 * How big the next move is likely to be — not which way.
 *
 * ─── What this is, and what it deliberately is not ───────────────────────
 * It emits a SIZE distribution and never a direction. Twenty pre-registered
 * tests closed the directional question: seven feature families over |t| = 3
 * worth 1-5 bp against a 14 bp round trip, and a magnitude gate showing that
 * even forecasting the size correctly does not make the direction payable.
 * Size is what survived, so size is what is served.
 *
 * ─── Why the universe, and not one coin ──────────────────────────────────
 * The tilt is ridge on eight indicators standardised ACROSS the coins present
 * in the same hour, so it says "this coin will move more than its neighbours",
 * not "the market is busy". That statement cannot be formed from one coin's
 * data, so the entry point takes the universe. A single-coin call still works
 * and returns the baseline alone with `hasTilt: false` rather than quietly
 * serving a weaker number as if it were the same thing.
 *
 * ─── The bars this passed ────────────────────────────────────────────────
 * On the 182-day holdout, ranking by predicted |move| into quintiles, realised
 * |move| in bp:
 *
 *    4h    55 -> 70 -> 80 -> 89 -> 101      vs within-hour shuffle +14.2 bp
 *   12h   100 -> 127 -> 139 -> 160 -> 172   vs shuffle +25.6 bp
 *   24h   150 -> 185 -> 206 -> 223 -> 251   vs shuffle +38.1 bp
 *
 * Measured through THIS code, not the research harness — see
 * `test/manual/layer1-service-bars.ts`.
 *
 * ─── Not calibrated yet ──────────────────────────────────────────────────
 * p50/p80/p90 are the point forecast times ratios fitted on training rows.
 * Whether the 80% band actually contains the outcome 80% of the time is a
 * Layer 2 question and is NOT claimed here. Nothing downstream may present
 * these as probabilities until that measurement exists.
 */
@Injectable()
export class ExpectedMoveService {
  private readonly logger = new Logger(ExpectedMoveService.name);

  /** 1h bars: the baseline window, plus warm-up for the indicators. */
  private static readonly CANDLE_LIMIT = BASELINE_WINDOW_HOURS + 260;
  private static readonly TIMEFRAME: TimeInterval = '1h';

  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
  ) {}

  /**
   * Cones for every coin in the universe, at the latest closed bar.
   *
   * A coin whose data will not load is dropped rather than defaulted: it
   * leaves the cross-section it would otherwise distort, and the coins that
   * did load are still standardised against each other.
   */
  async forUniverse(symbols: string[]): Promise<Map<string, ExpectedMove>> {
    // Fetched together, not in a loop. Ten coins fetched one after another is
    // ten round trips in series inside a 120-second Lambda ceiling, and a
    // single slow response pushes every remaining coin back behind it. The
    // measurement that caught this: Bar 4d saw a p50 of 395ms and a p95 of
    // 47s, because the tail was one upstream call blocking the rest.
    //
    // ponytail: Promise.all over ten symbols, not a bounded pool. Ten is the
    // universe; add a pool if it ever becomes a hundred.
    const settled = await Promise.all(
      symbols.map(async (symbol) => {
        const coin = symbol.toUpperCase();
        try {
          const candles = await this.binanceService.getCandles(
            coin,
            ExpectedMoveService.TIMEFRAME,
            ExpectedMoveService.CANDLE_LIMIT,
          );
          const context = this.indicatorsService.buildContext(
            coin,
            ExpectedMoveService.TIMEFRAME,
            candles,
          );
          const features = this.featuresFrom(context);
          if (features === null) return null;
          return { symbol: coin, features, closes: [...context.closes] };
        } catch (err) {
          // A coin that will not load leaves the cross-section rather than
          // distorting it, and the coins that did load are still standardised
          // against each other.
          this.logger.warn(`${coin}: expected move skipped — ${(err as Error).message}`);
          return null;
        }
      }),
    );

    const rows: CoinFeatures[] = [];
    for (const got of settled) {
      if (got === null) continue;
      rows.push({ symbol: got.symbol, features: got.features, baseline: NaN });
      (rows[rows.length - 1] as CoinFeatures & { closes: number[] }).closes = got.closes;
    }

    const out = new Map<string, ExpectedMove>();
    if (rows.length === 0) return out;

    for (const horizon of HORIZONS) {
      const withBaseline: CoinFeatures[] = [];
      for (const row of rows) {
        const closes = (row as CoinFeatures & { closes: number[] }).closes;
        const baseline = trailingBaseline(closes, horizon, BASELINE_WINDOW_HOURS);
        if (baseline === null) continue;
        withBaseline.push({ symbol: row.symbol, features: row.features, baseline });
      }
      if (withBaseline.length === 0) continue;

      const cones = conesForHour(withBaseline, horizon as ExpectedMoveHorizon);
      for (const [symbol, cone] of cones) {
        const existing = out.get(symbol) ?? { symbol, cones: {}, hasTilt: cone.hasTilt };
        existing.cones[horizon] = { predicted: cone.predicted, p50: cone.p50, p80: cone.p80, p90: cone.p90 };
        existing.hasTilt = cone.hasTilt;
        out.set(symbol, existing);
      }
    }

    this.logger.debug(`expected move: ${out.size} of ${symbols.length} coins priced`);
    return out;
  }

  /** The eight features, in FEATURE_ORDER. Null when any is unmeasurable. */
  private featuresFrom(context: ReturnType<IndicatorsService['buildContext']>): number[] | null {
    const bandWidthPct = this.indicatorsService.percentileRank(
      context.bandWidth,
      [...context.bandWidthSeries],
    );
    // %B exactly as panel-build.ts computes it, because the weights were fitted
    // against that column: where in the band the last close sits, 0 at the
    // lower band and 1 at the upper. NaN on a zero-width band rather than a
    // division that returns Infinity.
    const { upper, lower } = context.bollingerBands;
    const price = context.closes[context.closes.length - 1];
    const percentB = upper === lower ? NaN : (price - lower) / (upper - lower);

    const source: Record<string, number> = {
      rsi: context.rsi,
      adx: context.adx.adx,
      pdi: context.adx.pdi,
      mdi: context.adx.mdi,
      percentB,
      bandWidth: context.bandWidth,
      bandWidthPct,
      qqe: context.qqe.value,
    };
    const features = FEATURE_ORDER.map((f) => source[f]);
    return features.every((v) => Number.isFinite(v)) ? features : null;
  }
}
