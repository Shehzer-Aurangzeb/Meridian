import { SR_DEFAULTS } from '../analysis/interfaces/support-resistance.types';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';

/**
 * Does a saved analysis still describe the market?
 *
 *   LIVE         the plan can still be taken
 *   INVALIDATED  price went past the stop. Checked first — it is final
 *   SUPERSEDED   the zones it was built on are gone
 *
 * Never stored: it depends on the live price, so a stored answer is wrong the
 * moment the market moves.
 */
export type Freshness = 'LIVE' | 'INVALIDATED' | 'SUPERSEDED';

/**
 * A plan is dead once price is past its stop.
 *
 * TODO: uses the live price, but the plan means "on a CLOSE past X", so a
 * brief spike counts as invalidated. Costs a request to fix; not worth it yet.
 */
export function planInvalidated(plan: TradePlan, currentPrice: number): boolean {
  return plan.direction === 'long'
    ? currentPrice <= plan.stop
    : currentPrice >= plan.stop;
}

/** Does the new zone set still have one at nearly the same price? */
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
