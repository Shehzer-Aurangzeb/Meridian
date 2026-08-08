import { Candle } from '../common/types/candle.types';
import { findFirstFill } from '../common/replay/replay';
import { scoreLadder } from '../common/replay/plan-replay';
import { TradePlan } from '../analysis/services/trade-plan.service';

/**
 * Did the printed plan work?
 *
 * The same operation the plan backtest performs — replay candles from the
 * analysis timestamp against the plan's own entry, stop and target ladder —
 * applied to a SAVED analysis instead of a historical one. Deliberately the
 * same code (`findFirstFill`, `scoreLadder`), because a badge scored
 * differently from the harness would quietly disagree with every number in
 * STATE_OF_PLAY.md.
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
  | 'ALL_TARGETS';

export interface PlanResult {
  direction: 'long' | 'short';
  outcome: PlanOutcome;
  /** Realised R, or mark-to-market R while OPEN. Null before a fill. */
  r: number | null;
  filledAt: Date | null;
  targetsHit: number;
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

export function scorePlans(
  plans: TradePlan[],
  candlesSince: Candle[],
  analysedAt: Date,
  now: number,
): PlanResult[] {
  const elapsedHours = (now - analysedAt.getTime()) / 3_600_000;

  return plans.map((plan) => {
    const action = plan.direction === 'long' ? 'LONG' : 'SHORT';
    const fill = findFirstFill(candlesSince, action, plan.averageEntry);

    if (!fill) {
      return {
        direction: plan.direction,
        outcome: elapsedHours >= FILL_WINDOW_HOURS ? 'MISSED' : 'PENDING',
        r: null,
        filledAt: null,
        targetsHit: 0,
      };
    }

    const post = candlesSince.filter(
      (c) => c.time.getTime() > fill.time.getTime(),
    );
    const scored = scoreLadder(post, {
      direction: plan.direction,
      averageEntry: plan.averageEntry,
      stop: plan.stop,
      riskPerUnit: plan.riskPerUnit,
      targets: plan.targets,
    });

    // TIMEOUT from scoreLadder means "still running at the end of the
    // candles" — which live is not a timeout, it is an open position.
    const outcome: PlanOutcome =
      scored.status === 'TIMEOUT' ? 'OPEN' : scored.status;

    return {
      direction: plan.direction,
      outcome,
      r: scored.realizedR,
      filledAt: fill.time,
      targetsHit: scored.targetsHit,
    };
  });
}
