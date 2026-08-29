import { Candle } from '../common/types/candle.types';
import { scoreTrade } from '../common/replay/trade-scoring';
import { TradePlan } from '../analysis/services/trade-plan.service';

/**
 * Did the plan actually work? Replays the hours after an analysis against its
 * own entry, stop and targets.
 *
 * Calls the same `scoreTrade` as the backtest, so a badge on the site and a
 * trade in the backtest mean the same thing. Run once by OutcomeScorerService
 * and stored — read paths never call this.
 */
export type PlanOutcome =
  | 'PENDING'
  | 'MISSED'
  | 'OPEN'
  | 'STOPPED'
  | 'PARTIAL'
  | 'ALL_TARGETS'
  /** Opened, then ran out of time without hitting a target or the stop. */
  | 'EXPIRED'
  /** The price history could not be loaded, so there is no verdict to give. */
  | 'UNSCOREABLE';

export interface PlanResult {
  direction: 'long' | 'short';
  outcome: PlanOutcome;
  /** Result in R before costs. Null until the trade opens. */
  r: number | null;
  /** The same, after fees. Anything shown to a person uses this one. */
  netR: number | null;
  filledAt: Date | null;
  targetsHit: number;
  /** Entry steps that filled. A real position is often smaller than planned. */
  legsFilled: number;
  filledFraction: number;
  /** Bars the position was held for. 0 until it opens. */
  barsHeld: number;
}

/**
 * Outcomes that can never change again — the candles that decided them are past.
 *
 * PARTIAL is in here: scoreTrade only emits it when `stopped` is true, so the
 * position is closed. UNSCOREABLE is not: that is a failed fetch, not a verdict.
 */
const TERMINAL: ReadonlySet<string> = new Set<PlanOutcome>([
  'STOPPED',
  'PARTIAL',
  'ALL_TARGETS',
  'MISSED',
  'EXPIRED',
]);

export function isTerminalOutcome(outcome: string | null | undefined): boolean {
  return outcome !== null && outcome !== undefined && TERMINAL.has(outcome);
}

/** Hours to reach the entry before the plan counts as missed. */
export const FILL_WINDOW_HOURS = 24;

/** Hours a position gets before it is closed at whatever price it sat at. */
export const MAX_HOLD_HOURS = 72;

/** Hours of price history needed to judge a plan, starting from the analysis. */
export const OUTCOME_WINDOW_HOURS = FILL_WINDOW_HOURS + MAX_HOLD_HOURS;

/**
 * Cost of opening and closing once, as a % of position value. MEASURED at the
 * venue, August 2026 — fee and real spread together, because only the total
 * was measured. Shared with the backtest so both price trades identically.
 */
export const DEFAULT_ROUND_TRIP_PCT = 0.25;

/** The same cost expressed in R. A tighter stop pays proportionally more. */
export function costR(riskPercent: number, roundTripPct = DEFAULT_ROUND_TRIP_PCT): number {
  return riskPercent === 0 ? 0 : roundTripPct / riskPercent;
}

/**
 * Is this price history good enough to judge the plan against? It must START at
 * the analysis and be long enough — history that begins later is a different
 * stretch of time, and scoring against it invents fills that never happened.
 */
export function isScoreable(
  candlesSince: Candle[],
  analysedAt: Date,
  now: number,
  barMs = 3_600_000,
): boolean {
  const elapsedHours = (now - analysedAt.getTime()) / barMs;
  const expected = Math.min(Math.floor(elapsedHours), OUTCOME_WINDOW_HOURS);
  // Too soon for anything to have happened. Empty is the honest answer.
  if (expected <= 1) return true;
  if (candlesSince.length === 0) return false;
  // The first bar must be the one that opened at or just after the analysis.
  const gapBars = (candlesSince[0].time.getTime() - analysedAt.getTime()) / barMs;
  if (gapBars > 1) return false;
  // One bar of slack for the hour still in progress.
  return candlesSince.length >= expected - 1;
}

const UNSCOREABLE = (direction: 'long' | 'short'): PlanResult => ({
  direction,
  outcome: 'UNSCOREABLE',
  r: null,
  netR: null,
  filledAt: null,
  targetsHit: 0,
  legsFilled: 0,
  filledFraction: 0,
  barsHeld: 0,
});

export function scorePlans(
  plans: TradePlan[],
  candlesSince: Candle[],
  analysedAt: Date,
  now: number,
): PlanResult[] {
  const elapsedHours = (now - analysedAt.getTime()) / 3_600_000;

  if (!isScoreable(candlesSince, analysedAt, now)) {
    return plans.map((p) => UNSCOREABLE(p.direction));
  }

  return plans.map((plan) => {
    const scored = scoreTrade(candlesSince, plan, {
      fillBars: FILL_WINDOW_HOURS,
      maxBars: MAX_HOLD_HOURS,
      breakevenAfterTarget: 1,
      roundTripPct: DEFAULT_ROUND_TRIP_PCT,
    });

    if (!scored.filled) {
      return {
        direction: plan.direction,
        outcome: elapsedHours >= FILL_WINDOW_HOURS ? 'MISSED' : 'PENDING',
        r: null,
        netR: null,
        filledAt: null,
        targetsHit: 0,
        legsFilled: 0,
        filledFraction: 0,
        barsHeld: 0,
      };
    }

    // Nothing here sets an exitSignal, so this cannot happen. If it does,
    // someone added an exit rule without giving it a badge.
    if (scored.status === 'SIGNAL_EXIT') {
      throw new Error('SIGNAL_EXIT from the live scorer: an exitSignal was configured');
    }

    // Unfinished is one of two things: hold time is up (EXPIRED), or the hours
    // simply have not passed yet (OPEN).
    const heldOut = elapsedHours >= (scored.barsToFill as number) + MAX_HOLD_HOURS;
    const outcome: PlanOutcome =
      scored.status === 'TIMEOUT' || scored.status === 'NO_FILL'
        ? heldOut
          ? 'EXPIRED'
          : 'OPEN'
        : scored.status;

    return {
      direction: plan.direction,
      outcome,
      r: scored.grossR,
      netR: scored.netR,
      filledAt: candlesSince[scored.fillIndex as number].time,
      targetsHit: scored.targetsHit,
      legsFilled: scored.legsFilled,
      filledFraction: scored.filledFraction,
      barsHeld: scored.barsHeld,
    };
  });
}
