/**
 * The two pieces of the plan backtest that can be wrong silently.
 *
 * Both are pure and both have a spec next door, because a look-ahead leak and
 * a mis-scored exit ladder both produce plausible numbers rather than errors —
 * which is how the retracted results in docs/STATE_OF_PLAY.md §14c happened.
 */
import { Candle } from '../types/candle.types';

export const TIMEFRAME_MS: Record<string, number> = {
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '12h': 12 * 3_600_000,
  '1d': 24 * 3_600_000,
  '1w': 7 * 24 * 3_600_000,
};

/**
 * The last `limit` candles that were COMPLETE at `asOfMs`.
 *
 * The load-bearing detail is `time + durationMs <= asOfMs`, not `time <=
 * asOfMs`. A 12h candle that opened two hours ago is still forming: its high
 * and low already contain the next ten hours of price. Including it would let
 * the level map mark a swing that has not happened yet, and nothing downstream
 * could tell.
 */
export function completedAsOf(
  candles: Candle[],
  durationMs: number,
  asOfMs: number,
  limit: number,
): Candle[] {
  const done = candles.filter((c) => c.time.getTime() + durationMs <= asOfMs);
  return done.slice(-limit);
}

export interface LadderResult {
  /** Weighted R actually realised across the exit ladder, before costs. */
  realizedR: number;
  status: 'STOPPED' | 'PARTIAL' | 'ALL_TARGETS' | 'TIMEOUT';
  targetsHit: number;
  /** Bars from fill to the last exit (or to the end of the window). */
  barsHeld: number;
}

export interface LadderInput {
  direction: 'long' | 'short';
  averageEntry: number;
  stop: number;
  riskPerUnit: number;
  targets: Array<{ price: number; weightPercent: number }>;
  /**
   * How many targets must fill before the stop moves to breakeven.
   *
   * 1 is the playbook and the default, so every existing caller is unchanged.
   * 0 disables it and lets the remaining size run on the original stop. Only
   * the harness sets this — it exists to measure whether the rule pays for
   * itself, not to be tuned per analysis.
   */
  breakevenAfterTarget?: number;
}

/**
 * Score a filled plan against the candles that followed it.
 *
 * Scores the plan AS THE TOOL PRINTS IT — a laddered exit, not a single
 * target. That matters: TP1 is routinely below 1R because it is the next
 * confluence zone rather than a multiple of risk, so scoring TP1-only would
 * report a losing system by construction and blame the levels for it.
 *
 * Three rules, all from the playbook, all conservative:
 *  - Stop is checked BEFORE targets within a bar. OHLC carries no intra-candle
 *    ordering, so the pessimistic branch is the only honest one.
 *  - After TP1 the stop moves to breakeven (p14, "the trade should stop being
 *    able to hurt"). Remaining size then risks 0R, not -1R.
 *  - Weight still open when the window ends is marked to market at the last
 *    close, not assumed to reach its target.
 */
export function scoreLadder(post: Candle[], input: LadderInput): LadderResult {
  const long = input.direction === 'long';
  const rAt = (price: number): number =>
    input.riskPerUnit === 0
      ? 0
      : ((long ? price - input.averageEntry : input.averageEntry - price) /
          input.riskPerUnit);

  let realizedR = 0;
  let remaining = 100;
  let targetsHit = 0;
  let stop = input.stop;
  let stopped = false;
  let barsHeld = 0;

  for (const c of post) {
    barsHeld += 1;

    if (long ? c.low <= stop : c.high >= stop) {
      realizedR += (remaining / 100) * rAt(stop);
      remaining = 0;
      stopped = true;
      break;
    }

    while (
      targetsHit < input.targets.length &&
      (long
        ? c.high >= input.targets[targetsHit].price
        : c.low <= input.targets[targetsHit].price)
    ) {
      const t = input.targets[targetsHit];
      realizedR += (t.weightPercent / 100) * rAt(t.price);
      remaining -= t.weightPercent;
      targetsHit += 1;
      // Breakeven after the first target, per the playbook. 0 turns it off.
      const breakevenAfter = input.breakevenAfterTarget ?? 1;
      if (breakevenAfter > 0 && targetsHit === breakevenAfter) {
        stop = input.averageEntry;
      }
    }

    if (remaining <= 0) break;
  }

  if (remaining > 0 && post.length > 0) {
    realizedR += (remaining / 100) * rAt(post[post.length - 1].close);
  }

  return {
    realizedR,
    status: stopped
      ? targetsHit > 0
        ? 'PARTIAL'
        : 'STOPPED'
      : remaining <= 0
        ? 'ALL_TARGETS'
        : 'TIMEOUT',
    targetsHit,
    barsHeld,
  };
}
