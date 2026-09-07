import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { LevelMapService } from '../analysis/services/level-map.service';
import { ExpectedMoveService } from '../expected-move/expected-move.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { shellForDistance } from '../liquidity/depth.math';
import { HORIZONS } from '../expected-move/fitted';
import { MarketMap, ZoneOut, ExpectedMoveOut } from './map.types';
import {
  ZONE_BOUNCE_WITHHELD, REGIME_EXIT_WITHHELD, MAP_DISCLAIMERS,
} from './withheld';

/**
 * Coverage measured on the 182-day holdout by `layer2-calibrate`.
 *
 * Shipped as constants beside the cone rather than recomputed, because a
 * coverage number that moves when today's data arrives is not a calibration
 * result — it is a moving target nobody can check.
 */
const CONE_COVERAGE: Record<number, { p50: number; p80: number; p90: number }> = {
  4: { p50: 0.514, p80: 0.804, p90: 0.907 },
  12: { p50: 0.506, p80: 0.811, p90: 0.911 },
  24: { p50: 0.500, p80: 0.815, p90: 0.919 },
};
const CONE_FITTED_AT = '2026-09-06';

/**
 * Assembles the market map: one call, one payload.
 *
 * ─── Why one aggregate and not six endpoints ─────────────────────────────
 * The Lambda's ceiling is 120 seconds and a cold start spends a chunk of it
 * before any handler runs. Six round trips to build one screen turns a slow
 * start into a failed page, so the screen's whole payload is assembled here.
 *
 * ─── What this service refuses to do ─────────────────────────────────────
 * It emits no direction, no target, no entry, and no probability that has not
 * passed a bar. Three fields that a reader would plainly like — zone bounce,
 * regime exit, unwind lift — are permanently null with a reason attached,
 * because they were measured and did not clear. See `withheld.ts`.
 */
@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    private readonly binance: BinanceService,
    private readonly indicators: IndicatorsService,
    private readonly regime: MarketRegimeService,
    private readonly levelMap: LevelMapService,
    private readonly expectedMove: ExpectedMoveService,
    private readonly liquidity: LiquidityService,
  ) {}

  async build(symbol: string, universe?: string[]): Promise<MarketMap> {
    const coin = symbol.toUpperCase();

    // The cone needs the cross-section, so the universe is priced together.
    // A caller with one coin gets the baseline and `hasTilt: false` rather
    // than a weaker number presented as the same thing.
    const priced = await this.expectedMove.forUniverse(universe ?? [coin]);
    const move = priced.get(coin);

    const [hourly, map] = await Promise.all([
      this.binance.getCandles(coin, '1h', 600),
      this.levelMap.build(coin),
    ]);

    const context = this.indicators.buildContext(coin, '1h', hourly);
    const regimeState = this.regime.classifySeries(context);

    let expectedMove: ExpectedMoveOut | null = null;
    if (move) {
      const horizons: ExpectedMoveOut['horizons'] = {};
      for (const h of HORIZONS) {
        const cone = move.cones[h];
        if (!cone) continue;
        horizons[h] = {
          p50: cone.p50,
          p80: cone.p80,
          p90: cone.p90,
          coverage: CONE_COVERAGE[h] ?? { p50: NaN, p80: NaN, p90: NaN },
        };
      }
      expectedMove = {
        horizons,
        calibrated: true,
        fittedAt: CONE_FITTED_AT,
        note:
          'A SIZE forecast, not a direction. Measured coverage on a 182-day holdout was ' +
          'within 1.9 points of nominal at every band and horizon.',
      };
    }

    const zones: ZoneOut[] = map.zones.map((z) => ({
      low: z.low,
      high: z.high,
      center: z.center,
      type: z.type,
      sources: z.sources,
      distancePercent: z.distancePercent,
      spanPercent: z.spanPercent,
      // Permanently null. Measured twice — on zone features and on shelf
      // thickness — and neither carried information.
      bounceWithin4h: ZONE_BOUNCE_WITHHELD,
      shell: shellForDistance(z.distancePercent),
    }));

    const profile = await this.liquidity.profile(coin).catch((err: unknown) => {
      this.logger.warn(`${coin}: depth profile unavailable — ${(err as Error).message}`);
      return null;
    });

    return {
      symbol: coin,
      asOf: new Date().toISOString(),
      spot: map.spot,
      expectedMove,
      regime: regimeState
        ? {
            state: regimeState.regime,
            ageHours: regimeState.ageHours,
            ageTruncated: regimeState.ageTruncated,
            reason: regimeState.reason,
            exitWithin24h: REGIME_EXIT_WITHHELD,
          }
        : null,
      zones,
      liquidity: profile
        ? {
            shells: profile.shells,
            imbalance: profile.imbalance,
            coverage: profile.coverage,
            asOf: profile.asOf,
          }
        : null,
      // Crowding needs a live open-interest reading and nothing fetches one:
      // the collector was switched off on 5 September 2026. Reported as absent
      // rather than as a zero score, which would read as "not crowded".
      crowding: null,
      disclaimers: MAP_DISCLAIMERS,
    };
  }
}
