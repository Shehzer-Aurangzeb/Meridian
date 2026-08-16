import { SR_DEFAULTS } from '../analysis/interfaces/support-resistance.types';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';

/**
 * Does a saved analysis still describe the market?
 *
 *   LIVE         the plan can still be taken
 *   INVALIDATED  price went past the level the plan said it would not
 *   SUPERSEDED   the price zones it was built on are no longer there
 *
 * Worked out each time it is read, never stored — a stored answer is wrong
 * the moment the market moves.
 *
 * Invalidated is checked first because it is final: price went through the
 * stop, and no amount of surviving structure makes that plan takeable again.
 */
export type Freshness = 'LIVE' | 'INVALIDATED' | 'SUPERSEDED';

/**
 * A plan is dead once price is past its stop.
 *
 * TODO: this uses the current price, but the plan says "invalidated on a
 * CLOSE past X". A brief spike through the stop counts as invalidated here.
 * Fixing it costs one extra request, not paid for a status label.
 */
export function planInvalidated(plan: TradePlan, currentPrice: number): boolean {
  return plan.direction === 'long'
    ? currentPrice <= plan.stop
    : currentPrice >= plan.stop;
}

/**
 * Do two sets of zones still describe the same thing? A zone counts as
 * surviving if the new set has one at nearly the same price — using the same
 * tolerance that decides what a zone is in the first place.
 */
export function zonesSurvive(
  oldCenters: number[],
  freshCenters: number[],
): boolean {
  if (oldCenters.length === 0) return false;
  return oldCenters.some((old) =>
    freshCenters.some(
      (fresh) =>
        old !== 0 &&
        (Math.abs(fresh - old) / old) * 100 <= SR_DEFAULTS.CLUSTER_THRESHOLD,
    ),
  );
}

/** `newest` is null when this record IS the newest, so nothing replaced it. */
export function analysisFreshness(
  record: Pick<AnalysisRecord, 'plans' | 'map'>,
  currentPrice: number,
  newest: Pick<AnalysisRecord, 'map'> | null,
): Freshness {
  const plans = record.plans ?? [];

  // One surviving plan keeps the analysis alive: a dead buy plan does not
  // kill the sell plan printed beside it.
  if (plans.length > 0 && plans.every((p) => planInvalidated(p, currentPrice))) {
    return 'INVALIDATED';
  }

  if (newest) {
    const survives = zonesSurvive(
      plans.map((p) => p.zone.center),
      newest.map.zones.map((z) => z.center),
    );
    if (!survives) return 'SUPERSEDED';
  }

  return 'LIVE';
}
