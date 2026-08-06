import { SR_DEFAULTS } from '../analysis/interfaces/support-resistance.types';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';

/**
 * Whether a saved analysis still describes the market.
 *
 *   LIVE         the plan can still be taken
 *   INVALIDATED  price went through the level the plan said it would not
 *   SUPERSEDED   the structure moved on — those zones no longer exist
 *
 * ─── Computed on read, never stored ──────────────────────────────────────
 * A stored freshness column is wrong the moment it is written: the market
 * moves and the row does not. Both inputs are free at read time — the live
 * price is already being fetched for the chart, and the newest analysis for
 * the symbol is one indexed query away. So this is a pure function of
 * (old record, current price, newest record) and there is no background job,
 * no TTL column, and nothing to keep in sync.
 *
 * ─── Why order matters ───────────────────────────────────────────────────
 * INVALIDATED is checked first because it is definitive: price went through
 * the stop, and no amount of surviving structure makes that plan takeable
 * again. SUPERSEDED is the weaker statement — the idea was never disproved,
 * it just stopped being the current read.
 */
export type Freshness = 'LIVE' | 'INVALIDATED' | 'SUPERSEDED';

/**
 * A plan is invalidated when price is beyond its stop.
 *
 * ponytail: uses the current price, while the plan says "invalidated on a
 * CLOSE below X". A wick through the stop reads as invalidated here and a
 * candle close would say otherwise. Upgrade to the last closed candle of the
 * lowest level timeframe if that difference ever costs a real judgement — it
 * is one extra fetch, deliberately not paid for a state badge.
 */
export function planInvalidated(plan: TradePlan, currentPrice: number): boolean {
  return plan.direction === 'long'
    ? currentPrice <= plan.stop
    : currentPrice >= plan.stop;
}

/**
 * Do two zone sets still describe the same structure?
 *
 * A zone survives if the fresh map has one centred within the same 0.5% band
 * the clustering itself uses (`SR_DEFAULTS.CLUSTER_THRESHOLD`) — reused
 * rather than picked, so "the same zone" means here what it means there.
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

/**
 * `newest` is the most recent analysis for the same symbol, or null when the
 * record IS the newest — in which case nothing can have superseded it.
 */
export function analysisFreshness(
  record: Pick<AnalysisRecord, 'plans' | 'map'>,
  currentPrice: number,
  newest: Pick<AnalysisRecord, 'map'> | null,
): Freshness {
  const plans = record.plans ?? [];

  // Every plan gone means the whole read is spent. One surviving plan keeps
  // the analysis alive — an invalidated long does not invalidate the short
  // printed beside it.
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
