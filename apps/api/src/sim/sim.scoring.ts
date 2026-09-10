import { Candle } from '../common/types/candle.types';
import { ScorablePlan, scoreTrade } from '../common/replay/trade-scoring';

/** Fees plus spread for one round trip, measured at the venue, August 2026. */
export const ROUND_TRIP_PCT = 0.25;
/** Hours the entry must be reached within, or the plan counts as missed. */
export const FILL_WINDOW_HOURS = 24;
/** Hours a position gets before it is closed wherever it sits. */
export const MAX_HOLD_HOURS = 72;
export const SCORING_WINDOW_HOURS = FILL_WINDOW_HOURS + MAX_HOLD_HOURS;

const HOUR_MS = 3_600_000;

export type SimOutcome =
  | 'PENDING'
  | 'MISSED'
  | 'OPEN'
  | 'STOPPED'
  | 'PARTIAL'
  | 'ALL_TARGETS'
  | 'EXPIRED'
  | 'UNSCOREABLE';

export interface SimPlanInput {
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  targets: Array<{ price: number; weightPercent: number }>;
}

export interface SimScore {
  outcome: SimOutcome;
  grossR: number | null;
  netR: number | null;
  targetsHit: number | null;
  barsHeld: number | null;
  filledAt: Date | null;
}

const UNRESOLVED = (outcome: SimOutcome): SimScore => ({
  outcome,
  grossR: null,
  netR: null,
  targetsHit: null,
  barsHeld: null,
  filledAt: null,
});

/**
 * Turn a stored row into something `scoreTrade` accepts.
 *
 * Risk is derived, never stored: two numbers that imply a third are two numbers
 * that can disagree with it.
 */
export function toScorablePlan(plan: SimPlanInput): ScorablePlan {
  const riskPerUnit = Math.abs(plan.entry - plan.stop);
  return {
    direction: plan.direction,
    averageEntry: plan.entry,
    stop: plan.stop,
    riskPerUnit,
    riskPercent: plan.entry === 0 ? 0 : (riskPerUnit / plan.entry) * 100,
    targets: plan.targets,
  };
}

/**
 * The bars a decision is judged against: those opening at or after it.
 *
 * The bar CONTAINING the decision is excluded. Its low and high partly precede
 * the moment the analyst spoke, so allowing a fill there lets the trade take a
 * price that was gone before the plan existed.
 */
export function forwardBars(candles: Candle[], decidedAt: Date): Candle[] {
  const from = decidedAt.getTime();
  return candles.filter((c) => c.time.getTime() >= from);
}

/**
 * Is this price history good enough to judge against?
 *
 * History that starts late is a different stretch of time, and scoring against
 * it invents fills that never happened.
 */
export function isScoreable(forward: Candle[], decidedAt: Date, now: number): boolean {
  const elapsedHours = (now - decidedAt.getTime()) / HOUR_MS;
  const expected = Math.min(Math.floor(elapsedHours), SCORING_WINDOW_HOURS);
  if (expected <= 1) return true;
  if (forward.length === 0) return false;
  if ((forward[0].time.getTime() - decidedAt.getTime()) / HOUR_MS > 1) return false;
  return forward.length >= expected - 1;
}

export function scoreSimTrade(
  plan: SimPlanInput,
  candles: Candle[],
  decidedAt: Date,
  now: number,
  roundTripPct = ROUND_TRIP_PCT,
): SimScore {
  const forward = forwardBars(candles, decidedAt);
  if (!isScoreable(forward, decidedAt, now)) return UNRESOLVED('UNSCOREABLE');

  const elapsedHours = (now - decidedAt.getTime()) / HOUR_MS;
  const scored = scoreTrade(forward, toScorablePlan(plan), {
    fillBars: FILL_WINDOW_HOURS,
    maxBars: MAX_HOLD_HOURS,
    breakevenAfterTarget: 1,
    roundTripPct,
  });

  if (!scored.filled) {
    return UNRESOLVED(elapsedHours >= FILL_WINDOW_HOURS ? 'MISSED' : 'PENDING');
  }

  const heldOut = elapsedHours >= (scored.barsToFill ?? 0) + MAX_HOLD_HOURS;
  const outcome: SimOutcome =
    scored.status === 'TIMEOUT' || scored.status === 'NO_FILL'
      ? heldOut
        ? 'EXPIRED'
        : 'OPEN'
      : (scored.status as SimOutcome);

  // OPEN is not a verdict, so it carries no R: `scoreTrade` closes the
  // remainder at the last bar to reach a number, and that is a "if I closed
  // now" figure, not a result. What the candles HAVE settled is kept — whether
  // the entry filled, how many targets were reached, how long it has been held
  // — because those are facts about the past, not a running total.
  if (outcome === 'OPEN') {
    return {
      outcome,
      grossR: null,
      netR: null,
      targetsHit: scored.targetsHit,
      barsHeld: scored.barsHeld,
      filledAt: forward[scored.fillIndex as number].time,
    };
  }

  return {
    outcome,
    grossR: scored.grossR,
    netR: scored.netR,
    targetsHit: scored.targetsHit,
    barsHeld: scored.barsHeld,
    filledAt: forward[scored.fillIndex as number].time,
  };
}

/**
 * The earliest a row is worth looking at. Below one hour there is no forward
 * bar to judge against, so a check would only cost a request.
 */
export const MIN_AGE_HOURS = 1;

/** Outcomes the candles have already decided. They can never change again. */
const TERMINAL = new Set<SimOutcome>([
  'STOPPED',
  'PARTIAL',
  'ALL_TARGETS',
  'MISSED',
  'EXPIRED',
]);

export const isTerminal = (outcome: string | null): boolean =>
  outcome !== null && TERMINAL.has(outcome as SimOutcome);
