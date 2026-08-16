import { Candle } from '../common/types/candle.types';
import { scoreTrade } from '../common/replay/trade-scoring';
import { TradePlan } from '../analysis/services/trade-plan.service';

/**
 * Did the printed plan work?
 *
 * The same operation the plan backtest performs — replay candles from the
 * analysis timestamp against the plan's own entry, stop and target ladder —
 * applied to a SAVED analysis instead of a historical one. Deliberately the
 * same code (`scoreTrade`), because a badge scored differently from the
 * harness would quietly disagree with every number in STATE_OF_PLAY.md.
 *
 * What it does NOT yet share is the WINDOWS: the harness gives a plan 24 bars
 * to fill and 72 to resolve, and this passes infinity for both. That is C3 and
 * C4, and it is why a live badge and a backtested trade are still not the same
 * measurement even though the arithmetic between them now is.
 *
 * Computed on read, like freshness: nothing is stored, so nothing goes stale
 * and there is no job to keep in sync.
 *
 * ─── Why the ladder and not just TP1 ─────────────────────────────────────
 * TP1 is the next confluence zone, not a multiple of risk, so it is routinely
 * below 1R. Scoring TP1-only would report a losing plan by construction and
 * blame the levels for it. Breakeven moves to entry after TP1 (playbook p14),
 * and weight still open is marked to market at the latest candle — which is
 * exactly what "OPEN" means for a live position.
 */
export type PlanOutcome =
  | 'PENDING'
  | 'MISSED'
  | 'OPEN'
  | 'STOPPED'
  | 'PARTIAL'
  | 'ALL_TARGETS'
  /**
   * Filled, never resolved, and the hold window is spent. Closed at the mark,
   * not still running. The harness calls this TIMEOUT and counts it as an
   * unresolved trade; before the hold window was applied here, every one of
   * these read as OPEN indefinitely.
   */
  | 'EXPIRED'
  /**
   * The candles this plan would have to be replayed against could not be
   * fetched, so it has no badge and no R.
   *
   * Deliberately a state rather than a fallback. The bug this replaces scored
   * every old analysis against whatever window happened to be available, which
   * turned a closed trade back into MISSED and could invent a fill from a later
   * touch of the same price. A missing badge is recoverable; a confident wrong
   * one is not.
   */
  | 'UNSCOREABLE';

export interface PlanResult {
  direction: 'long' | 'short';
  outcome: PlanOutcome;
  /** Realised R before costs, or mark-to-market R while OPEN. Null before a fill. */
  r: number | null;
  /**
   * The same number after the round trip. Anything shown to a person uses
   * THIS one — the verdict quoting gross while the card beside it quoted net
   * is how one trade came to have two numbers on one screen.
   *
   * Taken from `scoreTrade`, which already computes it. Re-deriving the cost
   * at the call site is what let the two drift apart in the first place.
   */
  netR: number | null;
  filledAt: Date | null;
  targetsHit: number;
  /**
   * How many of the three entry legs actually filled, and what fraction of the
   * planned position that is.
   *
   * The plan is a 20/40/40 ladder. Reaching the near edge opens the trade at
   * 20% of size; the rest only fills if price works deeper into the zone, and
   * whatever is left is cancelled once the stop or the first target lands. So a
   * live position is routinely a fraction of the size the plan describes, and
   * `r` is already scaled to it — a 20%-filled winner earns a fifth of what a
   * full one would.
   */
  legsFilled: number;
  filledFraction: number;
}

/**
 * Hours a plan gets to be reached before it counts as MISSED rather than
 * still PENDING.
 *
 * 24 is not a guess: across the 582 backtested trades, 100% of the plans that
 * ever filled did so within 24 hours of the signal, median 3h
 * (STATE_OF_PLAY.md §14h). A plan unfilled after a day was not slow, it was
 * passed by.
 */
export const FILL_WINDOW_HOURS = 24;

/**
 * Hours a filled position gets to resolve before it is unresolved rather than
 * open forever. The harness's `--max-bars` on a 1h series, and the same number,
 * because a badge measured over an unbounded hold is not the thing the backtest
 * reports.
 *
 * Live used to pass Infinity for this and for the fill window. That is why an
 * OPEN badge could sit on a position for months, marked at a price it had long
 * since walked away from.
 */
export const MAX_HOLD_HOURS = 72;

/**
 * Candles a saved analysis must be replayed against: the fill window plus the
 * hold window, starting at the analysis itself. Anything less and the replay
 * cannot reach a verdict; anything more is not looked at.
 */
export const OUTCOME_WINDOW_HOURS = FILL_WINDOW_HOURS + MAX_HOLD_HOURS;

/**
 * Round-trip cost as a percentage of notional: 0.05% fee + 0.02% slippage,
 * each side. The §14h default, kept here so the API and the backtest harness
 * cannot drift apart — a scoreboard priced differently from STATE_OF_PLAY.md
 * would quietly disagree with every number in it.
 */
export const DEFAULT_ROUND_TRIP_PCT = 2 * (0.05 + 0.02);

/**
 * Cost in R. A plan with a 0.5% stop pays four times what a 2% stop pays,
 * because R is denominated in the stop distance. Fees are proportional to
 * size, so a laddered exit pays the same total as a single one.
 */
export function costR(riskPercent: number, roundTripPct = DEFAULT_ROUND_TRIP_PCT): number {
  return riskPercent === 0 ? 0 : roundTripPct / riskPercent;
}

/**
 * Is the replay series good enough to score against?
 *
 * It must START at the analysis — a series that begins later is a different
 * window, and scoring against it is how a closed trade turned back into MISSED.
 * It must also be LONG enough, unless the analysis is young and the rest of the
 * window has not happened yet, which is the ordinary case for a live plan.
 */
export function isScoreable(
  candlesSince: Candle[],
  analysedAt: Date,
  now: number,
  barMs = 3_600_000,
): boolean {
  const elapsedHours = (now - analysedAt.getTime()) / barMs;
  const expected = Math.min(Math.floor(elapsedHours), OUTCOME_WINDOW_HOURS);
  // Nothing has completed yet, or the only bar since is still forming. An empty
  // series is the honest answer here, and PENDING is the honest badge.
  if (expected <= 1) return true;
  if (candlesSince.length === 0) return false;
  // The first candle must be the one that opened at or just after the analysis.
  const gapBars = (candlesSince[0].time.getTime() - analysedAt.getTime()) / barMs;
  if (gapBars > 1) return false;
  // Allow one bar of slack for the still-forming candle at the live edge.
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
    // The same windows the harness uses. Live used to pass Infinity for both,
    // which meant a plan could "fill" weeks after its thesis expired and then
    // stay OPEN forever. A badge scored over a different window from the
    // backtest is not comparable to anything the backtest reports.
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

    // TIMEOUT from the ladder means "unresolved when the window ran out". Which
    // of two things that is depends on WHY it ran out:
    //
    //   - the hold window is spent  -> EXPIRED. The position is over, marked to
    //     market at the last bar of the window. This is the harness's TIMEOUT.
    //   - the candles simply have not happened yet -> OPEN, genuinely running.
    //
    // Before the hold window existed, every one of these was OPEN forever.
    // NO_FILL is unreachable here: the `!scored.filled` branch above returned.
    // SIGNAL_EXIT is a research-only status: it requires an `exitSignal`, and
    // this call configures none. If it ever appears, someone has wired an exit
    // rule into the live path without giving it a badge — say so rather than
    // pick a badge that would be wrong.
    if (scored.status === 'SIGNAL_EXIT') {
      throw new Error('SIGNAL_EXIT from the live scorer: an exitSignal was configured');
    }

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
