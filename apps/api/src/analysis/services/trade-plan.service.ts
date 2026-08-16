import { Injectable } from '@nestjs/common';
import { ConfluenceZone } from '../interfaces/support-resistance.types';

/**
 * How close price is to a zone. Purely a statement about distance — it makes
 * no claim about what happens next, which is the whole point: "price is 2.1%
 * from a zone" is checkable, "this will bounce" is not.
 */
export type ZoneState = 'ACTIONABLE' | 'APPROACHING' | 'FAR';

/**
 * Distance bands, measured to the NEAR EDGE of the zone (the edge price
 * reaches first), not its centre — the question is "how far until I can act".
 *
 * These are the only tunable numbers left in the analysis path, and unlike
 * the thresholds they replaced they are honest: they control what counts as
 * "close", not a claim about outcomes. Nothing is gated on them — every
 * direction always returns a full plan — so widening them cannot silence
 * the tool.
 */
export const ZONE_BANDS = { ACTIONABLE: 1.0, APPROACHING: 3.0 } as const;

/**
 * Entry ladder, from the playbook's zone-entry procedure (p53, "STEP 6:
 * Entry Execution"): 20% at the first touch of the zone, 40% mid-zone, 40%
 * at the far edge. Its worked example is $200 / $400 / $400 on $1,000, which
 * confirms these weights arithmetically.
 *
 * NOTE the playbook contradicts itself: the general "3-Entry Rule" (p11) says
 * 20/20/60, and STEP 6 labels its own third entry "heaviest at safest" while
 * giving it the same 40% as the second. STEP 6 is used because it is the
 * procedure being implemented — entering a confluence zone — and because its
 * arithmetic is explicit. Change here if the 60% version is preferred.
 */
export const ENTRY_WEIGHTS = [20, 40, 40] as const;

/** Take-profit split across successive zones (p14, TP1/TP2/TP3 = 33/33/34). */
export const TARGET_WEIGHTS = [33, 33, 34] as const;

/**
 * The ladder, rescaled to however many targets a zone map actually offered.
 *
 * The weights are a SPLIT, not a set of absolute sizes: they answer "how do I
 * divide the position across the exits I have", and with two exits the answer
 * is 50/50, not 33/33 with a third of the position left holding nothing.
 *
 * Taking `TARGET_WEIGHTS.slice(0, n)` unscaled is what produced the stuck
 * positions: a plan with one target exited 33% of size at that target and the
 * other 67% had no exit rule at all, so it could never reach ALL_TARGETS and
 * rode to the end of the hold window — where it was marked to market at
 * whatever price happened to be there and booked as a large gain. 31% of live
 * plans (106 of 337) were built this way.
 *
 * Proportional, so the relative emphasis of the playbook's split survives:
 *   3 targets -> 33 / 33 / 34   (already sums to 100 — bit-identical, asserted)
 *   2 targets -> 50 / 50
 *   1 target  -> 100
 *   0 targets -> []             (nothing to divide; no target exit exists)
 *
 * Note what this does NOT fix: a plan with zero targets still has no way to
 * close on profit. That is not a weight bug — there is no exit to weight — and
 * it is a question about whether such a plan should be printed at all.
 */
export function renormaliseTargetWeights(count: number): number[] {
  const taken = TARGET_WEIGHTS.slice(0, count);
  const sum = taken.reduce((a, b) => a + b, 0);
  if (sum === 0) return [];
  return taken.map((w) => (w * 100) / sum);
}

/**
 * Stop distance beyond the zone, in ATR multiples.
 *
 * "Stop Loss Price = Support Level − ATR Value" (p17). Anchored to the ZONE,
 * not to the entry: what invalidates the idea is price leaving the structure,
 * and the ATR is wick protection so a normal-sized probe does not stop you.
 */
export const STOP_ATR_MULTIPLE = 1.0;

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
  /** Distance to the near edge, signed. Negative = zone is below spot. */
  distanceToZonePercent: number;
  entries: PlanEntry[];
  averageEntry: number;
  stop: number;
  /** Loss at the stop, as a percentage of average entry. */
  riskPercent: number;
  /** Price move per unit of risk — what one R is worth in price terms. */
  riskPerUnit: number;
  targets: PlanTarget[];
  /**
   * Weighted R across the take-profit ladder — the number that decides
   * whether the plan is worth taking.
   *
   * Reported because TP1 alone is routinely below 1R: targeting successive
   * zones puts the first exit wherever the next zone happens to be, and in
   * dense structure that is close. A 0.65R first target is not a defect, but
   * it is only acceptable because the later ones carry the blend.
   *
   * Now that the weights are renormalised this is a genuine weighted mean.
   * Before, a one-target plan reported a THIRD of its own target's R, because
   * the ladder's other two thirds were multiplied by nothing.
   */
  blendedR: number;
  comeBackWhen: string;
}

/**
 * TradePlanService
 *
 * Turns a confluence zone into a complete, checkable plan: where to enter,
 * where the idea is wrong, where to take profit, and what has to happen for
 * it to become live.
 *
 * Pure arithmetic on numbers computed upstream. Every price it emits is
 * derived from a zone edge, a zone centre, or an ATR offset from one — never
 * invented — which is what lets the narration layer be checked against it.
 */
@Injectable()
export class TradePlanService {
  /**
   * Best plan for each direction: the nearest zone below spot is where a long
   * goes, the nearest above is where a short goes.
   *
   * Both are always returned when a zone exists on that side. The tool does
   * not decide which side you should take — that is a prediction, and it does
   * not make those.
   */
  buildPlans(
    zones: ConfluenceZone[],
    spot: number,
    atr: number,
  ): TradePlan[] {
    const below = zones.filter((z) => z.high < spot);
    const above = zones.filter((z) => z.low > spot);

    // Nearest on each side. Zones straddling spot are skipped: price is
    // already inside them, so there is no approach to plan and no clean edge
    // to anchor a stop to.
    const nearestBelow = below.sort((a, b) => b.high - a.high)[0];
    const nearestAbove = above.sort((a, b) => a.low - b.low)[0];

    // A plan with no zone ahead of its entry has no profit exit — its only
    // reachable outcomes are the stop and the end of the hold window. Across
    // the 626 backtested trades those were 57 plans at −1.08R resolved, every
    // resolved one a stop-out, because there was nothing else for them to hit.
    // "Never exit at random prices" (p14) rules out inventing an R-multiple
    // target, so the honest answer is not to print the plan.
    const plans: TradePlan[] = [];
    for (const [zone, direction] of [
      [nearestBelow, 'long'],
      [nearestAbove, 'short'],
    ] as const) {
      if (!zone) continue;
      const plan = this.buildPlan(zone, direction, spot, atr, zones);
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
    const long = direction === 'long';

    // Near edge = the one price reaches first. Falling into a support zone
    // touches its top; rising into a resistance zone touches its bottom.
    const nearEdge = long ? zone.high : zone.low;
    const farEdge = long ? zone.low : zone.high;

    const distanceToZonePercent = ((nearEdge - spot) / spot) * 100;
    const state = this.classify(Math.abs(distanceToZonePercent));

    // Ladder walks from the first touch to the far edge — heaviest at the
    // better price, which is the point of scaling in.
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
   * Targets are the next zones in the direction of travel — "Never exit at
   * random prices. Always exit at marked resistance levels" (p14). A fixed R
   * multiple would put the target wherever the arithmetic lands rather than
   * where sellers actually are.
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
      .filter((z) => (long ? z.center > averageEntry : z.center < averageEntry))
      .sort((a, b) =>
        long ? a.center - b.center : b.center - a.center,
      )
      .slice(0, TARGET_WEIGHTS.length);

    // Rescaled to the number of zones actually ahead, so the exits always
    // account for the whole position rather than a third of it.
    const weights = renormaliseTargetWeights(ahead.length);

    return ahead.map((z, i) => ({
      // Exit at the edge price reaches first — waiting for the far side of a
      // zone to fill is how a target gets missed by a few ticks.
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
