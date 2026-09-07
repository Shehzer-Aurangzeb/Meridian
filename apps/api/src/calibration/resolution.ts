/**
 * How a zone touch resolves. FROZEN — read this before changing a number.
 *
 * ─── Why the constants are named after their units ───────────────────────
 * This project's worst production defect was a units bug: thresholds named
 * `MIN_TESTS` — "minimum 3 touches" — were compared against a 1-5 STRENGTH
 * SCORE derived from the touch count, so "at least 3 touches" silently meant
 * "score of at least 3" for ~14% of levels. Nothing threw. The score is now
 * deleted (see `SupportResistanceLevel`), and every constant here carries its
 * unit in its name so the same substitution cannot be made silently.
 *
 * Every threshold is in ATR MULTIPLES, never in percent and never in ticks. A
 * fixed percentage means one thing for BTC and another for a coin three times
 * as volatile, and it would make the bounce rate a statement about which coins
 * are quiet rather than about which zones hold.
 *
 * ─── The rules ───────────────────────────────────────────────────────────
 *
 *   touch    price trades within 0.15 * ATR(1h) of the zone centre
 *   bounce   within 4h of the touch, price moves >= 0.5 * ATR AWAY from the
 *            zone, without first CLOSING 0.5 * ATR THROUGH it
 *   break    price closes 0.5 * ATR through the zone first
 *   neither  4h elapse with neither threshold reached
 *
 * `neither` is counted and PUBLISHED, never quietly dropped. A rule that
 * resolves 60% of the time and reports only the resolved 60% is describing a
 * minority of cases while implying it covers all of them.
 *
 * ─── The ambiguous case, which is real and is not swept up ───────────────
 * A single bar can both reach the away threshold on its high/low AND close
 * through the zone. Intrabar order is unknowable from OHLC, so which came
 * first cannot be decided. Those touches resolve to `ambiguous` and are
 * excluded from the denominator alongside `neither` — assigning them to
 * either side would be inventing a fact, and assigning them all to one side
 * would bias every published probability in that direction.
 */
import { Candle } from '../common/types/candle.types';

/** Distance from the zone centre, in ATR multiples, that counts as a touch. */
export const TOUCH_ATR_MULTIPLE = 0.15;
/** Move away from the zone, in ATR multiples, that counts as a bounce. */
export const BOUNCE_ATR_MULTIPLE = 0.5;
/** Close through the zone, in ATR multiples, that counts as a break. */
export const BREAK_ATR_MULTIPLE = 0.5;
/** Bars after the touch in which it must resolve. 1h bars, so 4 = 4 hours. */
export const RESOLUTION_WINDOW_BARS = 4;

export type ZoneOutcome = 'bounce' | 'break' | 'neither' | 'ambiguous';

export interface ZoneForResolution {
  /** Middle of the band. Touches are measured against this, not the edges. */
  center: number;
  type: 'support' | 'resistance';
}

/**
 * Did this bar touch the zone?
 *
 * Uses the bar's RANGE, not its close: price that traded into the zone and
 * left within the hour touched it, and a close-only test would miss exactly
 * the fast rejections a bounce rate is supposed to be about.
 */
export function isTouch(bar: Candle, zone: ZoneForResolution, atr: number): boolean {
  if (!(atr > 0)) return false;
  const tolerance = TOUCH_ATR_MULTIPLE * atr;
  return bar.low <= zone.center + tolerance && bar.high >= zone.center - tolerance;
}

/**
 * Resolve a touch against the bars that followed it.
 *
 * `after` must start at the bar AFTER the touch. Handing in the touch bar
 * itself lets a single bar both touch and resolve, which reads as an
 * instantaneous bounce and is really one bar of noise.
 *
 * `atr` is measured at the touch, never afterwards — a later ATR is
 * information the decision did not have.
 */
export function resolveTouch(
  zone: ZoneForResolution,
  atr: number,
  after: Candle[],
): ZoneOutcome {
  if (!(atr > 0)) return 'neither';

  const awayDistance = BOUNCE_ATR_MULTIPLE * atr;
  const throughDistance = BREAK_ATR_MULTIPLE * atr;

  // Support holds price up, so away is UP and through is DOWN. Resistance is
  // the mirror. Written out rather than sign-flipped, because a sign error
  // here inverts every published probability and nothing would throw.
  const awayTarget =
    zone.type === 'support' ? zone.center + awayDistance : zone.center - awayDistance;
  const throughTarget =
    zone.type === 'support' ? zone.center - throughDistance : zone.center + throughDistance;

  const bars = after.slice(0, RESOLUTION_WINDOW_BARS);
  for (const bar of bars) {
    const reachedAway =
      zone.type === 'support' ? bar.high >= awayTarget : bar.low <= awayTarget;
    // A break needs a CLOSE through, not a wick. A wick through a level and
    // back is the level holding, not failing.
    const closedThrough =
      zone.type === 'support' ? bar.close <= throughTarget : bar.close >= throughTarget;

    if (reachedAway && closedThrough) return 'ambiguous';
    if (closedThrough) return 'break';
    if (reachedAway) return 'bounce';
  }
  return 'neither';
}

export interface ResolutionTally {
  bounce: number;
  break: number;
  neither: number;
  ambiguous: number;
}

export const emptyTally = (): ResolutionTally => ({
  bounce: 0,
  break: 0,
  neither: 0,
  ambiguous: 0,
});

/**
 * Bounce rate over the RESOLVED touches only, plus the share that was not
 * resolved.
 *
 * Both numbers travel together on purpose. The rate answers "when it resolved,
 * how often did it hold"; `unresolvedShare` says how much of the sample that
 * rate is silent about. Publishing the first without the second is the failure
 * mode this whole file exists to prevent.
 */
export function bounceRate(t: ResolutionTally): {
  rate: number | null;
  resolved: number;
  total: number;
  unresolvedShare: number;
} {
  const resolved = t.bounce + t.break;
  const total = resolved + t.neither + t.ambiguous;
  return {
    rate: resolved === 0 ? null : t.bounce / resolved,
    resolved,
    total,
    unresolvedShare: total === 0 ? 0 : (t.neither + t.ambiguous) / total,
  };
}
