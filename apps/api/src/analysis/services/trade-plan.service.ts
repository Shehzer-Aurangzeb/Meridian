import { Injectable } from '@nestjs/common';
import {
  ConfluenceZone,
  ZoneTier,
  TIER_ATR_TIMEFRAME,
} from '../interfaces/support-resistance.types';
import { Timeframe } from '../../common/constants/timeframes';

/**
 * How close price is to a zone. A statement about distance only — it says
 * nothing about what price will do next, on purpose.
 */
export type ZoneState = 'ACTIONABLE' | 'APPROACHING' | 'FAR';

/**
 * What counts as "close", as a % away from the near edge of the zone — the
 * edge price reaches first. Changing these changes labels only; a plan is
 * still built either way.
 */
export const ZONE_BANDS = { ACTIONABLE: 1.0, APPROACHING: 3.0 } as const;

/**
 * How the position is built up: 20% when price first touches the zone, 40%
 * in the middle, 40% at the far side. From the playbook's zone-entry steps.
 *
 * TODO: the playbook also states a general 20/20/60 split elsewhere. This
 * follows the zone-entry procedure; switch if the other one is preferred.
 */
export const ENTRY_WEIGHTS = [20, 40, 40] as const;

/** How the position is sold off across the next zones up (or down). */
export const TARGET_WEIGHTS = [33, 33, 34] as const;

/**
 * Spreads the sell-off across however many targets actually exist, so the
 * whole position always has somewhere to go.
 *
 *   3 targets -> 33 / 33 / 34      2 targets -> 50 / 50      1 target -> 100
 *
 * Without this, a plan with one target sold only a third and the rest had no
 * exit at all, so it drifted to the end of the hold window every time.
 */
export function renormaliseTargetWeights(count: number): number[] {
  const taken = TARGET_WEIGHTS.slice(0, count);
  const sum = taken.reduce((a, b) => a + b, 0);
  if (sum === 0) return [];
  return taken.map((w) => (w * 100) / sum);
}

/**
 * How far past the zone the stop sits, as a multiple of recent volatility
 * (ATR). Measured from the ZONE, not the entry: the idea is wrong when price
 * leaves the zone, and the extra distance stops a normal-sized dip closing it.
 */
export const STOP_ATR_MULTIPLE = 1.0;

/**
 * Which tier may be entered, and which tier may be a target.
 *
 * HTF only, both. A 15-minute level is where price paused for an hour; nobody
 * trading a 12-hour setup takes profit there. Pooling every chart's levels into
 * one price cluster is what made seven charts measure worse than three
 * (CHARTS_AB.md): more zones put the next zone closer, so targets moved in
 * while the stop stayed put and planned R fell 2.26 -> 1.73.
 *
 * MID and LTF zones are still built and still shown. They corroborate; they do
 * not create a trade and they are never sold into.
 */
export const TRADEABLE_TIER: ZoneTier = 'HTF';

export interface PlanEntry {
  price: number;
  weightPercent: number;
}

export interface PlanTarget {
  price: number;
  weightPercent: number;
  rMultiple: number;
  source: string;
}

export interface TradePlan {
  direction: 'long' | 'short';
  state: ZoneState;
  zone: ConfluenceZone;
  /** % to the near edge. Negative means the zone is below the current price. */
  distanceToZonePercent: number;
  entries: PlanEntry[];
  averageEntry: number;
  stop: number;
  /** What a full stop-out loses, as a % of the entry price. */
  riskPercent: number;
  /** What 1R is worth in price: the gap from average entry to stop. */
  riskPerUnit: number;
  /** Which chart's ATR set the stop. Follows the zone's tier, not a fixed chart. */
  stopAtrTimeframe: Timeframe;
  targets: PlanTarget[];
  /**
   * Average reward across all the targets, weighted by how much is sold at
   * each. The first target is often worth less than the risk, because it sits
   * at the next zone rather than at a chosen multiple — the later ones carry
   * the average.
   */
  blendedR: number;
  comeBackWhen: string;
}

/**
 * Turns a price zone into a full plan: where to enter, where the idea is
 * wrong, where to take profit, and what has to happen for it to go live.
 *
 * Every price it produces comes from a zone edge, a zone centre, or a fixed
 * offset from one. None are invented.
 */
@Injectable()
export class TradePlanService {
  /**
   * One plan per direction: the nearest zone below the price for a buy, the
   * nearest above for a sell. Both are returned — the tool does not pick a
   * side for you.
   */
  buildPlans(
    zones: ConfluenceZone[],
    spot: number,
    atrByTier: Record<ZoneTier, number>,
  ): TradePlan[] {
    // Data predating tiers fails the filter below silently and returns no
    // plans at all — which reads as "the market offered nothing", not as
    // "these zones are the wrong shape". The golden set did exactly this:
    // 35/35 trades became NO_PLAN and nothing errored. Fail loudly instead.
    if (zones.length > 0 && zones.every((z) => z.tier === undefined)) {
      throw new Error(
        'ConfluenceZone.tier is missing on every zone. This is stale data from ' +
          'before tiering, not an absence of setups — rebuild it rather than ' +
          'reading the empty result as a verdict.',
      );
    }

    // Entries come from HTF zones only. `zones` still carries every tier,
    // because buildTargets needs the same filtered view and the caller should
    // not have to know the rule.
    const tradeable = zones.filter((z) => z.tier === TRADEABLE_TIER);
    const below = tradeable.filter((z) => z.high < spot);
    const above = tradeable.filter((z) => z.low > spot);

    // Zones the price is already sitting inside are skipped: there is nothing
    // to wait for and no clean edge to put a stop behind.
    const nearestBelow = below.sort((a, b) => b.high - a.high)[0];
    const nearestAbove = above.sort((a, b) => a.low - b.low)[0];

    // A plan with no zone ahead of it has nowhere to take profit, so the only
    // way it can end is at the stop. In the backtest every one of those lost.
    // Targets must sit at real levels, so rather than invent one, do not show
    // the plan at all.
    const plans: TradePlan[] = [];
    for (const [zone, direction] of [
      [nearestBelow, 'long'],
      [nearestAbove, 'short'],
    ] as const) {
      if (!zone) continue;
      const plan = this.buildPlan(zone, direction, spot, atrByTier[zone.tier], zones);
      if (plan.targets.length > 0) plans.push(plan);
    }

    return plans.sort(
      (a, b) =>
        Math.abs(a.distanceToZonePercent) - Math.abs(b.distanceToZonePercent),
    );
  }

  buildPlan(
    zone: ConfluenceZone,
    direction: 'long' | 'short',
    spot: number,
    atr: number,
    allZones: ConfluenceZone[],
  ): TradePlan {
    // Which chart's volatility priced this stop. Recorded on the plan so a CSV
    // reader can see that a weekly zone was not stopped on 4h noise.
    const stopAtrTimeframe = TIER_ATR_TIMEFRAME[zone.tier];
    const long = direction === 'long';

    // Near edge = the side price reaches first: the top of a zone below, the
    // bottom of a zone above.
    const nearEdge = long ? zone.high : zone.low;
    const farEdge = long ? zone.low : zone.high;

    const distanceToZonePercent = ((nearEdge - spot) / spot) * 100;
    const state = this.classify(Math.abs(distanceToZonePercent));

    // Buy in from the first touch to the far side, most of it at the better
    // price.
    const entries: PlanEntry[] = [
      { price: nearEdge, weightPercent: ENTRY_WEIGHTS[0] },
      { price: zone.center, weightPercent: ENTRY_WEIGHTS[1] },
      { price: farEdge, weightPercent: ENTRY_WEIGHTS[2] },
    ];

    const totalWeight = entries.reduce((s, e) => s + e.weightPercent, 0);
    const averageEntry =
      entries.reduce((s, e) => s + e.price * e.weightPercent, 0) / totalWeight;

    const stop = long
      ? zone.low - atr * STOP_ATR_MULTIPLE
      : zone.high + atr * STOP_ATR_MULTIPLE;

    const riskPerUnit = Math.abs(averageEntry - stop);
    const riskPercent =
      averageEntry === 0 ? 0 : (riskPerUnit / averageEntry) * 100;

    const targets = this.buildTargets(
      allZones,
      zone,
      averageEntry,
      riskPerUnit,
      long,
    );

    return {
      direction,
      state,
      zone,
      distanceToZonePercent,
      entries,
      averageEntry,
      stop,
      riskPercent,
      riskPerUnit,
      stopAtrTimeframe,
      targets,
      blendedR:
        targets.reduce((s2, t) => s2 + t.rMultiple * t.weightPercent, 0) / 100,
      comeBackWhen: this.comeBackWhen(state, nearEdge, stop, long),
    };
  }

  private classify(absDistancePercent: number): ZoneState {
    if (absDistancePercent <= ZONE_BANDS.ACTIONABLE) return 'ACTIONABLE';
    if (absDistancePercent <= ZONE_BANDS.APPROACHING) return 'APPROACHING';
    return 'FAR';
  }

  /**
   * Targets are the next zones in the direction of the trade. Never a round
   * number or a fixed multiple — exits go where other traders are already
   * acting, not where the arithmetic happens to land.
   */
  private buildTargets(
    allZones: ConfluenceZone[],
    entryZone: ConfluenceZone,
    averageEntry: number,
    riskPerUnit: number,
    long: boolean,
  ): PlanTarget[] {
    const ahead = allZones
      .filter((z) => z !== entryZone)
      // HTF only. This is the rule the whole hierarchy rests on: a target at a
      // 15m level is what pulled planned R from 2.26 to 1.73 when every chart
      // was pooled.
      .filter((z) => z.tier === TRADEABLE_TIER)
      .filter((z) => (long ? z.center > averageEntry : z.center < averageEntry))
      .sort((a, b) =>
        long ? a.center - b.center : b.center - a.center,
      )
      .slice(0, TARGET_WEIGHTS.length);

    // Spread across however many zones are actually ahead.
    const weights = renormaliseTargetWeights(ahead.length);

    return ahead.map((z, i) => ({
      // Sell at the near side of the zone. Waiting for the far side is how a
      // target gets missed by a few cents.
      price: long ? z.low : z.high,
      weightPercent: weights[i],
      rMultiple:
        riskPerUnit === 0
          ? 0
          : Math.abs((long ? z.low : z.high) - averageEntry) / riskPerUnit,
      source: z.sources.join(' + '),
    }));
  }

  private comeBackWhen(
    state: ZoneState,
    nearEdge: number,
    stop: number,
    long: boolean,
  ): string {
    const invalidation = `invalidated on a close ${long ? 'below' : 'above'} ${stop.toFixed(2)}`;

    if (state === 'ACTIONABLE') {
      return `live now — price is at the zone; ${invalidation}`;
    }

    return (
      `price within ${ZONE_BANDS.ACTIONABLE}% of ${nearEdge.toFixed(2)}, ` +
      `or ${invalidation}`
    );
  }
}
