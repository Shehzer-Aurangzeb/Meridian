/**
 * The historical shelf map: where resting size has actually sat, in dollars.
 *
 * ─── Why this exists alongside the depth profile ─────────────────────────
 * The profile answers "how thick is the book 2% below spot RIGHT NOW". It
 * cannot answer "how much size has historically rested at $61,200", because
 * its bands are measured from a mid that moves. Converting each snapshot's
 * shells to absolute prices and accumulating them answers the second question,
 * which is the one a reader looking at a chart actually has.
 *
 * ─── This is a measurement, not a forecast ───────────────────────────────
 * Bar 3a failed: shelf thickness does not predict whether a support zone
 * holds (gap -0.75 points against a bar of +8, interval [-7.93, 5.51]). So
 * nothing here feeds a probability. It is a description of where size has been
 * resting, published because it is true and useful to look at, and for no
 * other reason.
 *
 * ─── The attribution choice, stated because it is arguable ───────────────
 * A shell spans a band of prices — shell 3 covers (2%, 3%] below mid — and its
 * notional is spread across that whole band, not concentrated at a point. This
 * spreads each shell's notional UNIFORMLY across the price buckets it covers,
 * which is the assumption that adds the least information. The alternative,
 * dropping it all at the band's midpoint, invents a spike the archive never
 * reported.
 */
import { MAX_SHELL_PERCENT } from './depth.math';

export interface ShelfSnapshot {
  /** Mid price at the snapshot, which anchors the bands to real prices. */
  mid: number;
  /** Index 0 is shell 1. Notional resting in each incremental band. */
  bidByShell: number[];
  askByShell: number[];
}

export interface ShelfBucket {
  priceLow: number;
  priceHigh: number;
  bidNotional: number;
  askNotional: number;
}

/**
 * Accumulate snapshots into fixed price buckets.
 *
 * `bucketPercent` is the bucket width as a share of the FIRST snapshot's mid,
 * so the grid is uniform in dollars rather than drifting with price. Buckets
 * are returned only where something was actually observed — an empty bucket is
 * not a thin book, it is a price the market never visited within +-5%.
 */
export function buildShelfMap(
  snapshots: ShelfSnapshot[],
  bucketPercent = 0.25,
): ShelfBucket[] {
  const usable = snapshots.filter((s) => s.mid > 0);
  if (usable.length === 0) return [];

  const width = (usable[0].mid * bucketPercent) / 100;
  if (!(width > 0)) return [];

  const buckets = new Map<number, { bid: number; ask: number }>();
  const add = (index: number, bid: number, ask: number): void => {
    const cell = buckets.get(index) ?? { bid: 0, ask: 0 };
    cell.bid += bid;
    cell.ask += ask;
    buckets.set(index, cell);
  };

  for (const snap of usable) {
    for (let s = 0; s < MAX_SHELL_PERCENT; s += 1) {
      const inner = (snap.mid * s) / 100;
      const outer = (snap.mid * (s + 1)) / 100;

      for (const side of ['bid', 'ask'] as const) {
        const notional = side === 'bid' ? snap.bidByShell[s] : snap.askByShell[s];
        if (!Number.isFinite(notional) || notional === 0) continue;

        // The band, in absolute prices. Bids sit below mid, asks above.
        const lowPrice = side === 'bid' ? snap.mid - outer : snap.mid + inner;
        const highPrice = side === 'bid' ? snap.mid - inner : snap.mid + outer;
        if (!(highPrice > lowPrice)) continue;

        const first = Math.floor(lowPrice / width);
        const last = Math.floor(highPrice / width);
        const span = highPrice - lowPrice;

        for (let b = first; b <= last; b += 1) {
          // The overlap between this price bucket and the band, so a band that
          // covers two and a half buckets contributes in those proportions.
          const overlap =
            Math.min(highPrice, (b + 1) * width) - Math.max(lowPrice, b * width);
          if (overlap <= 0) continue;
          const share = (overlap / span) * notional;
          add(b, side === 'bid' ? share : 0, side === 'ask' ? share : 0);
        }
      }
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, cell]) => ({
      priceLow: index * width,
      priceHigh: (index + 1) * width,
      bidNotional: cell.bid,
      askNotional: cell.ask,
    }));
}
