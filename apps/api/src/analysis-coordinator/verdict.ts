import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';
import { Freshness } from './freshness';
import { PlanResult } from './outcome';

/**
 * The analysis written out as sentences. Every phrase reads back a number that
 * already exists — no interpretation, so it cannot fail, cost money, or make
 * anything up. The AI explanation is a separate, optional extra.
 */
export interface Verdict {
  /** One line: the whole analysis reduced to its point. */
  headline: string;
  /** Two to four plain sentences. */
  body: string[];
  /** What price has actually done since. Null before anything can happen. */
  status: string | null;
}

/** Fixed number formatting, so the same value always reads the same way. */
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

/** Which plan to lead with: actionable, else approaching, else nearest. */
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

/** The result as a person reads it, always after fees. */
const rr = (r: PlanResult, whenNull: string): string =>
  r.netR === null
    ? whenNull
    : `${r.netR >= 0 ? '+' : '−'}${Math.abs(r.netR).toFixed(2)}R`;

const STATUS: Record<PlanResult['outcome'], (r: PlanResult) => string> = {
  PENDING: () => 'Price has not reached the entry yet.',
  MISSED: () => 'Price never came back to the entry within a day, so this one was passed by.',
  EXPIRED: (r) =>
    `Filled, but never reached a target or the stop. Closed at the end of the hold window ` +
    `at ${rr(r, 'break-even')}.`,
  UNSCOREABLE: () =>
    'The price history needed to score this analysis could not be loaded, so it has no result.',
  OPEN: (r) => `Filled, and still running at ${rr(r, 'break-even')}.`,
  STOPPED: (r) => `Filled, then stopped out at ${rr(r, 'the stop')}.`,
  PARTIAL: (r) =>
    `Filled and ${r.targetsHit} target${r.targetsHit === 1 ? '' : 's'} hit so far, ` +
    `worth ${rr(r, '—')}.`,
  ALL_TARGETS: (r) => `Filled and every target was reached, worth ${rr(r, '—')}.`,
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

  // Results come back in the same order as the plans.
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

  // This plan's own checklist — not the other direction's.
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
