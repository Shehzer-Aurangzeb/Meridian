import { Candle } from '../common/types/candle.types';
import { scoreTrade } from '../common/replay/trade-scoring';
import { TradePlan } from '../analysis/services/trade-plan.service';

/**
 * Did the plan we printed actually work?
 *
 * Replays the hours after a saved analysis against its own entry, stop and
 * targets. It calls the same `scoreTrade` as the backtest, with the same time
 * windows, so a badge on the site and a trade in the backtest mean the same
 * thing.
 *
 * Worked out fresh each time it is read. Nothing is stored, so nothing can go
 * stale and there is no background job to keep in step.
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
  /**
   * The price history needed to judge this plan could not be loaded, so it gets
   * no badge and no result. Saying nothing is better than showing a badge that
   * might be wrong.
   */
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
  /**
   * The entry is split into three steps at different prices. Reaching the
   * nearest one opens a fifth of the position; the rest only fills if price
   * moves further in, and whatever is left is cancelled once the stop or the
   * first target lands. So a real position is often smaller than the plan
   * describes, and `r` is already scaled to the size actually held.
   */
  legsFilled: number;
  filledFraction: number;
}

/**
 * Hours a plan gets to be reached before it counts as missed rather than still
 * waiting. Every backtested plan that ever filled did so within a day, half of
 * them within three hours; after that price had simply moved on.
 */
export const FILL_WINDOW_HOURS = 24;

/**
 * Hours an open position gets to finish before it is closed out at whatever
 * price it sat at. The same number the backtest uses, so the two agree.
 */
export const MAX_HOLD_HOURS = 72;

/** Hours of price history needed to judge a plan, starting from the analysis. */
export const OUTCOME_WINDOW_HOURS = FILL_WINDOW_HOURS + MAX_HOLD_HOURS;

/**
 * Cost of opening and closing, as a % of position value: 0.05% fee plus 0.02%
 * slippage, each way. Kept here so the site and the backtest price trades the
 * same.
 */
export const DEFAULT_ROUND_TRIP_PCT = 2 * (0.05 + 0.02);

/** The same cost expressed in R. A tighter stop pays proportionally more. */
export function costR(riskPercent: number, roundTripPct = DEFAULT_ROUND_TRIP_PCT): number {
  return riskPercent === 0 ? 0 : roundTripPct / riskPercent;
}

/**
 * Is this price history good enough to judge the plan against?
 *
 * It has to START at the analysis and be long enough. History that begins
 * later is a different stretch of time, and judging a plan against it can turn
 * a finished trade back into "never started" or invent an entry from a price
 * touched weeks afterwards.
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
      };
    }

    // This status needs an exit signal, and none is set here. If it ever shows
    // up, someone has added an exit rule to the live path without giving it a
    // badge — better to fail loudly than to display the wrong one.
    if (scored.status === 'SIGNAL_EXIT') {
      throw new Error('SIGNAL_EXIT from the live scorer: an exitSignal was configured');
    }

    // A trade that has not finished is one of two things: the hold time is up,
    // so it is over and valued where it sat (EXPIRED), or the hours simply have
    // not passed yet, so it is genuinely still running (OPEN).
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
    };
  });
}
