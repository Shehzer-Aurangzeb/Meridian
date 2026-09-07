/**
 * Fitted constants for the expected-move cone. GENERATED — do not edit.
 *
 *   pnpm --filter api expected-move-fit
 *
 * Fitted 2026-09-06 on test/manual/results/panel.csv, training rows only
 * (everything before the last 182 days, minus a horizon embargo).
 * Ridge lambda 10, scaled by row count. Baseline window 30 days.
 *
 * `weights` apply to the features in FEATURE_ORDER, cross-sectionally
 * standardised across the coins present in the same hour, in that exact order.
 * `ratios` turn one predicted scale into a cone: quantile = predicted * ratio.
 */
export const FEATURE_ORDER = [
  'rsi',
  'adx',
  'pdi',
  'mdi',
  'percentB',
  'bandWidth',
  'bandWidthPct',
  'qqe',
] as const;

export type ExpectedMoveFeature = (typeof FEATURE_ORDER)[number];

/** Trailing window for the per-coin volatility baseline, in hours. */
export const BASELINE_WINDOW_HOURS = 720;

export interface HorizonFit {
  weights: number[];
  ratios: { p50: number; p80: number; p90: number };
}

export const FITTED: Record<number, HorizonFit> = {
  4: {
    weights: [5.36934835e-5, 2.47326877e-5, 5.17495542e-5, -4.20556837e-5, 4.39117993e-5, 2.66274650e-5, 4.54258160e-5, 5.12317124e-5],
    ratios: { p50: 0.691641, p80: 1.537721, p90: 2.257288 },
  },
  12: {
    weights: [8.43698546e-5, 2.11358553e-5, 7.85762683e-5, -6.82569957e-5, 7.62872461e-5, 2.28930957e-5, 6.99706249e-5, 8.00133184e-5],
    ratios: { p50: 0.717283, p80: 1.572425, p90: 2.256777 },
  },
  24: {
    weights: [9.65884024e-5, 5.39733740e-6, 9.99158092e-5, -8.01340941e-5, 8.53885841e-5, 6.15549629e-6, 8.69356389e-5, 9.19434656e-5],
    ratios: { p50: 0.737264, p80: 1.595457, p90: 2.266978 },
  },
};

export const HORIZONS = [4, 12, 24] as const;
export type ExpectedMoveHorizon = (typeof HORIZONS)[number];
