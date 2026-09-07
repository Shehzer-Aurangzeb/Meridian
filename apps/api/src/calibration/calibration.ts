/**
 * Calibration: does a stated probability mean what it says?
 *
 * ─── Why this layer is reachable when an edge was not ────────────────────
 * Twenty pre-registered tests closed the directional question. Every one died
 * on the same wall: real information, one to five basis points of it, against
 * a fourteen basis point round trip. **A calibration bar has no fee to clear.**
 * "When you say 70%, be right 70% of the time" is a different property, and one
 * this data can support — a statement can be perfectly calibrated and carry no
 * tradeable edge at all.
 *
 * ─── Calibrated is not the same as useful, and Brier is why ──────────────
 * A model that only ever emits the base rate is PERFECTLY calibrated and
 * completely useless. Reliability alone cannot tell that apart from a model
 * that actually knows something, so every calibrated output here is scored on
 * Brier against a base-rate-only baseline as well. Passing ECE says the number
 * is honest; beating the base rate on Brier says it is informative. Both, or
 * the output does not ship as a probability.
 */

export interface Bucket {
  /** Inclusive lower and exclusive upper edge of the predicted-probability bin. */
  lo: number;
  hi: number;
  n: number;
  predictedMean: number;
  realisedRate: number;
}

export interface Reliability {
  buckets: Bucket[];
  /** Expected calibration error, as a share (0.043 is 4.3 points). */
  ece: number;
  brier: number;
  /** Brier of always predicting the sample's own base rate. */
  brierBaseRate: number;
  baseRate: number;
  n: number;
}

/**
 * The smallest sample that may carry a published probability.
 *
 * Effective n on this data runs one to two orders of magnitude below raw n —
 * 13,500 observations were measured to carry 300-1,500 of actual evidence — so
 * a bucket of 199 touches is not 199 independent facts. Below this the output
 * is `null` rather than a number with a wide interval nobody will read.
 */
export const MIN_SAMPLE_FOR_PROBABILITY = 200;

/**
 * Reliability of a set of (predicted, outcome) pairs.
 *
 * Buckets are fixed-width in predicted probability rather than equal-count.
 * Equal-count bins hide the failure this is meant to catch: a model that
 * crowds every forecast into 0.45-0.55 would get ten tidy buckets and look
 * well spread, when the honest picture is that it never says anything.
 */
export function reliability(
  pairs: Array<{ predicted: number; outcome: 0 | 1 }>,
  bucketCount = 10,
): Reliability {
  const buckets: Bucket[] = [];
  const n = pairs.length;
  const baseRate = n === 0 ? 0 : pairs.reduce((s, p) => s + p.outcome, 0) / n;

  let ece = 0;
  for (let b = 0; b < bucketCount; b += 1) {
    const lo = b / bucketCount;
    const hi = (b + 1) / bucketCount;
    const inBucket = pairs.filter(
      (p) => p.predicted >= lo && (b === bucketCount - 1 ? p.predicted <= hi : p.predicted < hi),
    );
    if (inBucket.length === 0) continue;
    const predictedMean = inBucket.reduce((s, p) => s + p.predicted, 0) / inBucket.length;
    const realisedRate = inBucket.reduce((s, p) => s + p.outcome, 0) / inBucket.length;
    buckets.push({ lo, hi, n: inBucket.length, predictedMean, realisedRate });
    ece += (inBucket.length / n) * Math.abs(predictedMean - realisedRate);
  }

  const brier = n === 0 ? NaN : pairs.reduce((s, p) => s + (p.predicted - p.outcome) ** 2, 0) / n;
  const brierBaseRate =
    n === 0 ? NaN : pairs.reduce((s, p) => s + (baseRate - p.outcome) ** 2, 0) / n;

  return { buckets, ece, brier, brierBaseRate, baseRate, n };
}

/**
 * One row of a fitted calibration table: a bucket key, and what happened in it.
 *
 * Fitted offline on training data and read at analysis time. Never computed
 * live — a probability that moves because today's data arrived is not a base
 * rate, it is a moving target nobody can check.
 */
export interface CalibrationRow {
  key: string;
  n: number;
  /** Null when n is below MIN_SAMPLE_FOR_PROBABILITY. */
  probability: number | null;
  ci95: [number, number] | null;
}

export interface CalibrationTable {
  output: string;
  fittedAt: string;
  /** Rows the model may quote, keyed by whatever bucketing the output uses. */
  rows: CalibrationRow[];
  /** Fallback when a key is unseen or too thin. Always populated. */
  baseRate: number;
  baseRateN: number;
  /** Share of observations the resolution rule could not settle. */
  unresolvedShare: number;
}

/**
 * Fit a lookup from bucket key to realised frequency.
 *
 * The interval is a normal approximation on the binomial, which is adequate at
 * n >= 200 and is not what decides anything here — the block bootstrap in the
 * calibration job is the interval that carries weight, because these
 * observations overlap in time and are nothing like independent.
 */
export function fitTable(
  output: string,
  observations: Array<{ key: string; outcome: 0 | 1 }>,
  unresolvedShare: number,
): CalibrationTable {
  const byKey = new Map<string, { n: number; hits: number }>();
  for (const o of observations) {
    const cell = byKey.get(o.key) ?? { n: 0, hits: 0 };
    cell.n += 1;
    cell.hits += o.outcome;
    byKey.set(o.key, cell);
  }

  const rows: CalibrationRow[] = [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, cell]) => {
      const p = cell.hits / cell.n;
      if (cell.n < MIN_SAMPLE_FOR_PROBABILITY) {
        return { key, n: cell.n, probability: null, ci95: null };
      }
      const se = Math.sqrt((p * (1 - p)) / cell.n);
      return {
        key,
        n: cell.n,
        probability: p,
        ci95: [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)] as [number, number],
      };
    });

  const n = observations.length;
  return {
    output,
    fittedAt: new Date().toISOString(),
    rows,
    baseRate: n === 0 ? 0 : observations.reduce((s, o) => s + o.outcome, 0) / n,
    baseRateN: n,
    unresolvedShare,
  };
}

/**
 * What the table says for a key.
 *
 * An unseen or too-thin key falls back to the base rate rather than to a
 * guess, and the caller is told which it got — a base rate presented as a
 * conditional probability is the failure this whole layer exists to prevent.
 */
export function lookup(
  table: CalibrationTable,
  key: string,
): { probability: number; n: number; isBaseRate: boolean } {
  const row = table.rows.find((r) => r.key === key);
  if (!row || row.probability === null) {
    return { probability: table.baseRate, n: table.baseRateN, isBaseRate: true };
  }
  return { probability: row.probability, n: row.n, isBaseRate: false };
}

/** Coverage of a quantile band: how often the outcome landed inside it. */
export function coverage(pairs: Array<{ bound: number; actual: number }>): number {
  if (pairs.length === 0) return NaN;
  return pairs.filter((p) => p.actual <= p.bound).length / pairs.length;
}
