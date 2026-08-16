/**
 * The two parts of the backtest that can be wrong without anything breaking.
 * Both are tested next door: if either is wrong it produces believable numbers
 * rather than an error, which is how a past result had to be withdrawn.
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
 * The most recent bars that had FINISHED at a given moment.
 *
 * The important part is that a bar still in progress is excluded. A 12-hour
 * bar that opened two hours ago already contains the next ten hours of price,
 * so using it would let the backtest see the future.
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
  /** What the trade actually made across all its exits, before fees. */
  realizedR: number;
  status: 'STOPPED' | 'PARTIAL' | 'ALL_TARGETS' | 'TIMEOUT';
  targetsHit: number;
  /** Bars from opening the trade to the last exit, or to the end. */
  barsHeld: number;
}

export interface LadderInput {
  direction: 'long' | 'short';
  averageEntry: number;
  stop: number;
  riskPerUnit: number;
  targets: Array<{ price: number; weightPercent: number }>;
  /**
   * How many targets must be hit before the stop moves to break-even. 1 is the
   * rule; 0 turns it off. Only the backtest changes this, to measure whether
   * the rule is worth having.
   */
  breakevenAfterTarget?: number;
}

/**
 * Score an opened plan against the bars that followed it, selling off in
 * stages exactly as the plan describes rather than at a single target.
 *
 * Three deliberately cautious rules:
 *  - Within one bar the stop counts before any target. A bar's high and low
 *    carry no order, so assume the worse one happened first.
 *  - After the first target the stop moves to break-even, so the rest of the
 *    position can no longer lose.
 *  - Anything still open at the end is valued at the last price, never assumed
 *    to have reached its target.
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
      // Stop moves to break-even after the first target. 0 turns it off.
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
