import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';
import { Freshness } from './freshness';
import { PlanResult } from './outcome';

/**
 * The analysis, in sentences.
 *
 * ─── Why this is not Claude's job ────────────────────────────────────────
 * Nothing here is interpretation. Every clause restates a number that was
 * already computed — which zone, how far, what it risks, what happened since.
 * A model is not needed to read a struct out loud, and one that did would be
 * a moving part that can fail, cost money, and occasionally lie.
 *
 * Claude's narration is a separate, optional thing: it says what the numbers
 * MEAN in context, and it can decline. This always renders.
 *
 * Lives beside `freshness` and `outcome` rather than in the frontend because
 * those two are its inputs, it is pure, and the CLI wants it too.
 */
export interface Verdict {
  /** One line — the whole analysis reduced to its point. */
  headline: string;
  /** Two to four plain sentences. */
  body: string[];
  /** What price has actually done since. Null before anything can happen. */
  status: string | null;
}

/**
 * No locale games: this is read by one person, and `en-GB` is stable.
 *
 * The non-finite guards are for the formatter itself, not for missing fields —
 * the route rejects an incomplete payload before it reaches here.
 */
function num(value: number, dp: number): string {
  return Number.isFinite(value) ? value.toFixed(dp) : '—';
}

function money(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return `$${value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

const REGIME_WORDS: Record<string, string> = {
  COMPRESSION: 'coiled — volatility is compressed',
  TRENDING: 'trending',
  MEAN_REVERSION: 'ranging',
};

const ROUTE_WORDS: Record<string, string> = {
  SQUEEZE_BREAKOUT: 'a breakout setup',
  CONFLUENCE_CHECKLIST: 'a confluence entry',
};

/**
 * The plan worth leading with: one that can be taken now, else one that is
 * close, else whichever is nearest. Not "the best" — the tool does not pick a
 * side, and both plans stay on the page.
 */
export function leadPlan(plans: TradePlan[]): TradePlan | null {
  if (plans.length === 0) return null;
  const byDistance = [...plans].sort(
    (a, b) => Math.abs(a.distanceToZonePercent) - Math.abs(b.distanceToZonePercent),
  );
  return (
    byDistance.find((p) => p.state === 'ACTIONABLE') ??
    byDistance.find((p) => p.state === 'APPROACHING') ??
    byDistance[0]
  );
}

const STATUS: Record<PlanResult['outcome'], (r: PlanResult) => string> = {
  PENDING: () => 'Price has not reached the entry yet.',
  MISSED: () => 'Price never came back to the entry within a day, so this one was passed by.',
  OPEN: (r) =>
    `Filled, and still running at ${r.r === null ? 'break-even' : `${r.r >= 0 ? '+' : '−'}${Math.abs(r.r).toFixed(2)}R`}.`,
  STOPPED: (r) =>
    `Filled, then stopped out at ${r.r === null ? 'the stop' : `${r.r.toFixed(2)}R`}.`,
  PARTIAL: (r) =>
    `Filled and ${r.targetsHit} target${r.targetsHit === 1 ? '' : 's'} hit so far, worth ${r.r === null ? '—' : `${r.r >= 0 ? '+' : '−'}${Math.abs(r.r).toFixed(2)}R`}.`,
  ALL_TARGETS: (r) =>
    `Filled and every target was reached, worth ${r.r === null ? '—' : `+${r.r.toFixed(2)}R`}.`,
};

export function buildVerdict(
  record: Pick<AnalysisRecord, 'symbol' | 'regime' | 'route' | 'checklists' | 'plans' | 'map'>,
  freshness: Freshness,
  outcomes: PlanResult[],
  currentPrice: number,
): Verdict {
  const { symbol, regime, plans } = record;
  const lead = leadPlan(plans);
  const body: string[] = [];

  if (!lead) {
    return {
      headline: `${symbol} · nothing to trade here`,
      body: [
        `No confluence zone was close enough to spot at ${money(record.map.spot)} to build a plan from.`,
        `The market is ${REGIME_WORDS[regime.regime] ?? regime.regime.toLowerCase()} on the ${regime.timeframe}.`,
      ],
      status: null,
    };
  }

  // Index-aligned: scorePlans maps over plans in order.
  const outcome = outcomes[plans.indexOf(lead)];

  const headline =
    freshness === 'INVALIDATED'
      ? `${symbol} · this read is finished`
      : freshness === 'SUPERSEDED'
        ? `${symbol} · a newer analysis has replaced this`
        : lead.state === 'ACTIONABLE'
          ? `${symbol} · a ${lead.direction} is actionable now`
          : lead.state === 'APPROACHING'
            ? `${symbol} · a ${lead.direction} is worth watching`
            : `${symbol} · nothing to do yet`;

  const side = lead.zone.type === 'support' ? 'support' : 'resistance';
  const distance = Math.abs(lead.distanceToZonePercent);
  const where =
    lead.state === 'ACTIONABLE'
      ? `Price is sitting in a ${side} zone`
      : `Price is ${distance.toFixed(1)}% ${lead.zone.center > currentPrice ? 'below' : 'above'} a ${side} zone`;

  body.push(
    `${where} at ${money(lead.zone.low)}–${money(lead.zone.high)}, where ${lead.zone.sources.length} independent levels agree.`,
  );

  body.push(
    `Taking it risks ${num(lead.riskPercent, 2)}% to a stop at ${money(lead.stop)}, ` +
      `against ${lead.targets.length} target${lead.targets.length === 1 ? '' : 's'} that blend to ${num(lead.blendedR, 2)}R.`,
  );

  // The lead plan's OWN checklist. Reading a single shared one printed the
  // opposite side's score next to this plan whenever the trend disagreed with
  // the zone.
  const leadChecklist = record.checklists?.[lead.direction];
  const checklistClause = leadChecklist
    ? ` ${leadChecklist.conditionsMet} of 5 entry conditions are met for the ${lead.direction}.`
    : '';
  body.push(
    `The ${regime.timeframe} read is ${REGIME_WORDS[regime.regime] ?? regime.regime.toLowerCase()} ` +
      `(ADX ${regime.metrics.adx.toFixed(0)}), which routed this to ${ROUTE_WORDS[record.route] ?? record.route}.` +
      checklistClause,
  );

  if (freshness === 'INVALIDATED') {
    body.push(`Price has since gone through every stop, so none of these plans can be taken.`);
  }

  return {
    headline,
    body,
    status: outcome ? STATUS[outcome.outcome](outcome) : null,
  };
}
