/**
 * Resting depth, as arithmetic.
 *
 * ─── The one limit that is structural, not a policy ──────────────────────
 * Binance's bookDepth archive publishes cumulative resting notional at +-1%,
 * +-2%, +-3%, +-4% and +-5% of mid, and NOTHING BEYOND +-5%. That is the whole
 * published world. A question about a 10% move is not answerable from this
 * data at any confidence, so `shellForDistance` returns null rather than
 * extrapolating, and every caller must handle that as "unknown" rather than
 * as "thin".
 *
 * The +-0.2% band exists too, from 2026-01-15 onward. It is deliberately not
 * used here: seven months against everyone else's 3.6 years cannot carry a
 * multi-year base rate, and mixing it in would make history structurally
 * different from the present.
 */

/** The furthest the archive reaches from mid, in percent. */
export const MAX_SHELL_PERCENT = 5;

/**
 * Which shell a price sits in, given its signed distance from mid in percent.
 *
 * Shells are the INCREMENTAL bands stored in `BookProfile`: shell 3 holds the
 * notional resting in (2%, 3%] and nothing below it. A price 2.3% away is in
 * shell 3.
 *
 * Returns null beyond the archive's reach, and for a distance of exactly zero
 * — price at mid has no shell, and rounding it into shell 1 would silently
 * attribute the whole first band to a level that is not in it.
 */
export function shellForDistance(distancePercent: number): number | null {
  if (!Number.isFinite(distancePercent)) return null;
  const d = Math.abs(distancePercent);
  if (d <= 0 || d > MAX_SHELL_PERCENT) return null;
  return Math.ceil(d);
}

/**
 * Share of `history` at or below `value`, as 0-100.
 *
 * Same inclusive definition `IndicatorsService.percentileRank` uses, repeated
 * here so the liquidity layer does not depend on the indicators module for one
 * line of arithmetic.
 */
export function percentileOf(value: number, history: number[]): number {
  if (history.length === 0) return 0;
  let countLE = 0;
  for (const h of history) if (h <= value) countLE += 1;
  return (countLE / history.length) * 100;
}

export interface Shell {
  /** 1-5: the upper bound of the band, in percent from mid. */
  shell: number;
  bidNotional: number;
  askNotional: number;
  /** Against this coin's own trailing history, so thin means thin FOR IT. */
  bidPercentile: number;
  askPercentile: number;
}

export interface DepthProfile {
  symbol: string;
  asOf: string;
  shells: Shell[];
  /** Bid share of the whole +-5% book. 0.5 is balanced. */
  imbalance: number | null;
  /** Stated, never implied, so nobody reads a silence as "nothing there". */
  coverage: string;
}

/**
 * A profile from one bucket's shells plus each shell's own history.
 *
 * Percentiles are per shell and per coin on purpose. Absolute dollars say
 * BTC's book is deeper than LTC's, which is true and useless; the question a
 * reader has is whether THIS coin's book is thin right now compared with how
 * it usually looks.
 */
export function buildProfile(
  symbol: string,
  asOf: Date,
  current: Array<{ shell: number; bidNotional: number; askNotional: number }>,
  history: Map<number, { bid: number[]; ask: number[] }>,
): DepthProfile {
  const shells: Shell[] = current
    .filter((c) => c.shell >= 1 && c.shell <= MAX_SHELL_PERCENT)
    .sort((a, b) => a.shell - b.shell)
    .map((c) => {
      const h = history.get(c.shell) ?? { bid: [], ask: [] };
      return {
        shell: c.shell,
        bidNotional: c.bidNotional,
        askNotional: c.askNotional,
        bidPercentile: percentileOf(c.bidNotional, h.bid),
        askPercentile: percentileOf(c.askNotional, h.ask),
      };
    });

  const bid = shells.reduce((s, x) => s + x.bidNotional, 0);
  const ask = shells.reduce((s, x) => s + x.askNotional, 0);

  return {
    symbol,
    asOf: asOf.toISOString(),
    shells,
    imbalance: bid + ask > 0 ? bid / (bid + ask) : null,
    coverage: `+-${MAX_SHELL_PERCENT}% of mid only`,
  };
}
