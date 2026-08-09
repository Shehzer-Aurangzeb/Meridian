/**
 * The sequenced dip→turn signal, in ONE place.
 *
 * sequencing.ts measures how OFTEN this fires and what the market looks like
 * when it does. forward.ts measures whether it PRECEDES anything. Those two
 * must be talking about the same signal, so the definition lives here rather
 * than being copied — a drifted copy would silently invalidate the 314-signal
 * frequency the forward test is built on top of.
 *
 * Long side only. The dip reading is the long case; shorts mirror it.
 */
import {
  BB_THRESHOLDS,
  RSI_ENTRY_THRESHOLDS,
} from '../../src/analysis/interfaces/checklist.types';

/** Longest a dip may wait for its trigger before it is called stale. */
export const MAX_WAIT = 20;

export interface BarState {
  oversold: boolean;
  atLowerBand: boolean;
  qqeGreen: boolean;
  qqeTurnedGreen: boolean;
  structure: string;
}

export interface SignalContext {
  rsi: number;
  bollingerBands: { upper: number; lower: number };
  closes: readonly number[];
  qqe: { color: string; previousColor: string };
  highs: readonly number[];
  lows: readonly number[];
}

export function classify(ctx: SignalContext): BarState {
  const price = ctx.closes[ctx.closes.length - 1];
  const range = ctx.bollingerBands.upper - ctx.bollingerBands.lower;
  const proximity = range > 0 ? ((price - ctx.bollingerBands.lower) / range) * 100 : 100;

  // Same structure rule the checklist uses: compare the last bar to a pivot
  // roughly 20 bars back.
  const n = ctx.closes.length;
  const mid = (ctx.bollingerBands.upper + ctx.bollingerBands.lower) / 2;
  const pivot = Math.max(0, n - 21);
  let structure = 'ranging';
  if (price > mid && ctx.highs[n - 1] > ctx.highs[pivot]) structure = 'HH/HL';
  else if (price < mid && ctx.lows[n - 1] < ctx.lows[pivot]) structure = 'LH/LL';

  return {
    oversold: ctx.rsi <= RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX,
    atLowerBand: proximity <= BB_THRESHOLDS.PROXIMITY_PERCENT,
    qqeGreen: ctx.qqe.color === 'green',
    qqeTurnedGreen: ctx.qqe.color === 'green' && ctx.qqe.previousColor !== 'green',
    structure,
  };
}

export const isDip = (s: BarState) => s.oversold && s.atLowerBand;

export interface Trigger {
  /** index into `states` where momentum turned */
  at: number;
  /** index of the last dip bar that armed it */
  armedAt: number;
}

export interface Walk {
  triggers: Trigger[];
  /** bars on which the dip state was present */
  dipBars: number;
  /** dip AND turn on the SAME bar — the old simultaneous encoding */
  simultaneous: number;
  /** dips that went stale with no turn inside MAX_WAIT */
  expired: number;
}

/**
 * IDLE → ARMED (dip present) → TRIGGERED | EXPIRED.
 *
 * Re-arms on every dip bar: while price is still in the dip the clock
 * restarts, so `armedAt` is the LAST dip bar, not the first.
 */
export function walk(states: readonly BarState[], maxWait = MAX_WAIT): Walk {
  const out: Walk = { triggers: [], dipBars: 0, simultaneous: 0, expired: 0 };
  let armedAt = -1;

  for (let k = 0; k < states.length; k++) {
    const s = states[k];

    if (isDip(s)) {
      out.dipBars++;
      if (s.qqeTurnedGreen) out.simultaneous++;
      armedAt = k;
      continue;
    }

    if (armedAt < 0) continue;

    if (k - armedAt > maxWait) {
      out.expired++;
      armedAt = -1;
      continue;
    }

    if (s.qqeTurnedGreen) {
      out.triggers.push({ at: k, armedAt });
      armedAt = -1;
    }
  }

  return out;
}
