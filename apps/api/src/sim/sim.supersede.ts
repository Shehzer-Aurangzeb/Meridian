import type { LabelledBar } from '../market-regime/market-regime.service';

/**
 * When did the market stop being what the plan was written against?
 *
 * A plan is written while the market is in one state. If that state ends, the
 * reasoning behind the plan has expired, and leaving the trade running to the
 * full window measures something the analyst never claimed.
 *
 * Read from the labelled bars rather than from a stored reading, so the answer
 * is a function of candles alone: the same question asked in a year returns the
 * same moment, whether or not anyone happened to load a page at the time.
 */
export function firstRegimeChangeAfter(
  series: LabelledBar[],
  decidedAt: Date,
  decisionRegime: string,
): Date | null {
  const from = decidedAt.getTime();
  for (const bar of series) {
    if (bar.time.getTime() <= from) continue;
    // The FIRST disagreement, not the current state: a market that leaves the
    // state and returns to it has still broken the thesis in between, and an
    // age-of-current-run check would miss that entirely.
    if (bar.regime !== decisionRegime) return bar.time;
  }
  return null;
}

/**
 * The regime the plan was written against, taken from the frozen snapshot.
 *
 * Read from the snapshot rather than recomputed: the snapshot is what the
 * analyst was shown, and recomputing it later would compare the market against
 * a state nobody ever saw.
 */
export function regimeOfSnapshot(snapshot: unknown): string | null {
  const regime = (snapshot as { regime?: { state?: unknown } } | null)?.regime;
  return typeof regime?.state === 'string' ? regime.state : null;
}
