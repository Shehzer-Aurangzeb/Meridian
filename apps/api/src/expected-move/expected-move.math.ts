/**
 * The expected-move cone, as arithmetic.
 *
 * Kept free of Nest and of any I/O on purpose: `test/manual/layer1-service-bars.ts`
 * runs these exact functions over the 320,000-row panel to prove the service
 * reproduces the research result. A model that can only be tested through a
 * service that fetches candles cannot be replayed against history at all.
 *
 * ─── The construction, and why it has two parts ──────────────────────────
 *
 *   predicted = baseline + tilt
 *   cone_p    = predicted * ratio_p          p in {50, 80, 90}
 *
 * `baseline` is the per-coin trailing mean |move| — volatility clustering,
 * which needs no features and carries the LEVEL.
 *
 * `tilt` is ridge on eight cross-sectionally standardised indicators and
 * carries the coin-specific part. It is what Bar 1b measures: standardising
 * within the hour means the tilt says which coin will move more than its
 * neighbours, not whether the market is busy.
 *
 * Both halves are mandatory. A purely cross-sectional model has zero-mean
 * columns and no intercept, so it can only emit deviations around zero and its
 * forecast never reaches an absolute level at all — fitted that way the
 * magnitude gate returned zero trades, which read as a null result and was a
 * mis-specified model. A baseline-only model reaches the right level and is
 * indistinguishable from the within-hour shuffle, which is Bar 1b failing.
 */
import { FEATURE_ORDER, FITTED, ExpectedMoveHorizon } from './fitted';

export interface Cone {
  /** The point forecast of |move|, as a fraction: 0.0062 is 62 bp. */
  predicted: number;
  p50: number;
  p80: number;
  p90: number;
}

export interface CoinFeatures {
  symbol: string;
  /** Raw, unstandardised, in FEATURE_ORDER. */
  features: number[];
  /** Trailing mean |move| at this horizon, as a fraction. */
  baseline: number;
}

/**
 * Trailing mean |log return| over `windowHours`, at a given horizon, using only
 * returns already realised at the decision bar.
 *
 * `closes` is a 1-hour series ending at the decision bar. The return over
 * [t, t+h] is not known until t+h, so the newest usable term starts `horizon`
 * bars before the end. Taking the return that ends at the decision bar would
 * be reading the answer, and it would make the baseline look extraordinary.
 */
export function trailingBaseline(
  closes: number[],
  horizon: number,
  windowHours: number,
): number | null {
  const moves: number[] = [];
  // The last fully realised return spans [n-1-horizon, n-1].
  for (let end = closes.length - 1; end - horizon >= 0 && moves.length < windowHours; end -= 1) {
    const a = closes[end - horizon];
    const b = closes[end];
    if (!(a > 0) || !(b > 0)) continue;
    moves.push(Math.abs(Math.log(b / a)));
  }
  // Fewer than 30 readings is not a level, it is a rumour.
  if (moves.length < 30) return null;
  return moves.reduce((s, x) => s + x, 0) / moves.length;
}

/**
 * Cross-sectional standardisation, matching `buildDesign` in phase-c exactly:
 * centre and scale each feature across the coins present in this hour, divide
 * by the POPULATION standard deviation, and leave a cell at 0 — "no opinion
 * relative to the others" — when it cannot be measured.
 *
 * The population divisor is not a detail. The weights were fitted against
 * columns built this way, so a sample (n-1) divisor here would scale every
 * tilt by sqrt(n/(n-1)) and silently mis-size the cone.
 */
export function standardiseAcrossCoins(rows: CoinFeatures[]): number[][] {
  const nF = FEATURE_ORDER.length;
  const out = rows.map(() => new Array<number>(nF).fill(0));
  for (let f = 0; f < nF; f += 1) {
    const present: number[] = [];
    for (const r of rows) {
      const v = r.features[f];
      if (Number.isFinite(v)) present.push(v);
    }
    if (present.length < 2) continue;
    const mu = present.reduce((s, x) => s + x, 0) / present.length;
    const sd = Math.sqrt(present.reduce((s, x) => s + (x - mu) ** 2, 0) / present.length);
    if (sd === 0) continue;
    rows.forEach((r, i) => {
      const v = r.features[f];
      if (Number.isFinite(v)) out[i][f] = (v - mu) / sd;
    });
  }
  return out;
}

/**
 * One hour's cones for the whole universe.
 *
 * Universe-wide by construction, not by preference: the tilt is a statement
 * about this coin RELATIVE to the others in the same hour, so it cannot be
 * computed for one coin alone. A caller with a single coin gets the baseline
 * and no tilt, and `hasTilt` says so rather than pretending.
 */
export function conesForHour(
  rows: CoinFeatures[],
  horizon: ExpectedMoveHorizon,
): Map<string, Cone & { hasTilt: boolean }> {
  const fit = FITTED[horizon];
  if (!fit) throw new Error(`no fitted constants for horizon ${horizon}h`);

  const hasTilt = rows.length >= 2;
  const z = hasTilt ? standardiseAcrossCoins(rows) : rows.map(() => new Array(FEATURE_ORDER.length).fill(0));

  const out = new Map<string, Cone & { hasTilt: boolean }>();
  rows.forEach((row, i) => {
    let tilt = 0;
    for (let f = 0; f < FEATURE_ORDER.length; f += 1) tilt += fit.weights[f] * z[i][f];
    const predicted = row.baseline + tilt;
    // The tilt can in principle drag a small baseline below zero. A negative
    // expected |move| is not a forecast, so the baseline stands alone there
    // rather than the cone being clamped to an arbitrary floor.
    const scale = predicted > 0 ? predicted : row.baseline;
    out.set(row.symbol, {
      predicted: scale,
      p50: scale * fit.ratios.p50,
      p80: scale * fit.ratios.p80,
      p90: scale * fit.ratios.p90,
      hasTilt,
    });
  });
  return out;
}
