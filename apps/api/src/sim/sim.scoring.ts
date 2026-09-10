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
  /// Closed early because the thesis it was written against no longer held.
  | 'SUPERSEDED'
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

/**
 * Cut the history at a moment, so a trade can be closed where its reasoning
 * stopped applying rather than run to the full window.
 *
 * The bar CONTAINING `closeAt` is kept: the close happens at that bar's close
 * price, which is a price that existed at or after the moment in question.
 */
export function barsUntil(forward: Candle[], closeAt: Date): Candle[] {
  const until = closeAt.getTime();
  return forward.filter((c) => c.time.getTime() <= until);
}

export function scoreSimTrade(
  plan: SimPlanInput,
  candles: Candle[],
  decidedAt: Date,
  now: number,
  roundTripPct = ROUND_TRIP_PCT,
  /**
   * Close the trade here if it is still running. A trade that already hit its
   * stop or its last target BEFORE this moment keeps that outcome — the thesis
   * expiring afterwards does not reach back and change what happened.
   */
  closeAt?: Date,
): SimScore {
  let forward = forwardBars(candles, decidedAt);
  if (!isScoreable(forward, decidedAt, now)) return UNRESOLVED('UNSCOREABLE');

  if (closeAt) {
    // Closed before a single bar existed: it never had a chance to fill, and
    // it will not get one now, so it is over rather than waiting.
    const cut = barsUntil(forward, closeAt);
    if (cut.length === 0) return UNRESOLVED('MISSED');
    forward = cut;
  }

  const elapsedHours = closeAt
    ? (closeAt.getTime() - decidedAt.getTime()) / HOUR_MS
    : (now - decidedAt.getTime()) / HOUR_MS;
  const scored = scoreTrade(forward, toScorablePlan(plan), {
    fillBars: FILL_WINDOW_HOURS,
    maxBars: MAX_HOLD_HOURS,
    breakevenAfterTarget: 1,
    roundTripPct,
  });

  if (!scored.filled) {
    // A closed trade is finished whether or not it ever started. Left PENDING
    // it would sit unresolved for good: nothing will fill it now that a newer
    // call has replaced it, and `scoredAt` would never be written.
    if (closeAt) return UNRESOLVED('MISSED');
    return UNRESOLVED(elapsedHours >= FILL_WINDOW_HOURS ? 'MISSED' : 'PENDING');
  }

  const heldOut = elapsedHours >= (scored.barsToFill ?? 0) + MAX_HOLD_HOURS;
  // A cut history ends at the close, so `scoreTrade` reports TIMEOUT: the
  // remainder was closed at the last bar. That is exactly the intended
  // behaviour, and it is SUPERSEDED rather than EXPIRED because the window did
  // not run out — the reasoning did.
  const stillRunning = scored.status === 'TIMEOUT' || scored.status === 'NO_FILL';
  const outcome: SimOutcome = stillRunning
    ? closeAt
      ? 'SUPERSEDED'
      : heldOut
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
  'SUPERSEDED',
]);

export const isTerminal = (outcome: string | null): boolean =>
  outcome !== null && TERMINAL.has(outcome as SimOutcome);
