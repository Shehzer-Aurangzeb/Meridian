/**
 * Fit the expected-move model and emit the constants the service ships with.
 *
 *   pnpm --filter api expected-move-fit
 *
 * Writes `src/expected-move/fitted.ts`. Research fits; the service only
 * applies. Nothing in `src/` reads the panel, and nothing here runs in
 * production — that separation is what stops a 170 MB CSV becoming a runtime
 * dependency of a Lambda.
 *
 * ─── What is fitted ──────────────────────────────────────────────────────
 * Per horizon:
 *   weights   ridge, on the EIGHT indicator features, fit to
 *             (winsorised |return| − per-coin 30-day baseline)
 *   ratios    quantiles of realised |move| / predicted |move|, which turn one
 *             predicted scale into a p50/p80/p90 cone
 *
 * Both are fitted on TRAIN rows only — everything before the last 182 days,
 * minus a `horizon`-hour embargo at the boundary. The holdout is scored by
 * `layer1-service-bars.ts` and is not touched here.
 *
 * ─── Why eight features and not forty-three ──────────────────────────────
 * Measured, not assumed. Bar 1b's margin over the within-hour shuffle, at
 * 4h/12h/24h:
 *
 *    8 indicators                      +14.2 / +25.5 / +38.0 bp
 *   12 (+ funding, premium)            +14.2 / +25.6 / +38.1 bp
 *   26 (+ level geometry)              +14.6 / +25.5 / +38.1 bp
 *   30 (all live-deployable)           +14.6 / +25.6 / +37.9 bp
 *   43 (everything, incl. collector)   +14.3 / +25.7 / +38.0 bp
 *
 * Identical within noise. The eight indicators come from ONE 1-hour candle
 * series per coin, so the service needs no funding call, no level geometry
 * across three timeframes, no book-depth archive and no flow collector. The
 * other thirty-five features buy nothing and cost four data sources.
 */
import * as fs from 'fs';
import { load, Panel } from './phase-b';
import { buildDesign, solveRidge } from './phase-c';
import { buildBaseline, buildResidualTarget } from './magnitude-gate';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const OUT = str('out', 'src/expected-move/fitted.ts');
const HORIZONS = str('horizons', '4,12,24').split(',').map(Number);
const LAMBDA = num('lambda', 10);
const HOLDOUT_DAYS = num('holdout-days', 182);
const BASELINE_HOURS = num('baseline-hours', 30 * 24);

/**
 * The eight, in a fixed order. The service standardises and dots against this
 * exact sequence, so it is written into the generated file rather than assumed
 * — a silently reordered feature list is a silently wrong forecast.
 */
export const FEATURES = [
  'rsi', 'adx', 'pdi', 'mdi', 'percentB', 'bandWidth', 'bandWidthPct', 'qqe',
] as const;

const pct = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];

function main(): void {
  const panel = load(IN);
  const nTimes = panel.times.length;
  const nC = panel.coins.length;
  const holdoutLo = nTimes - HOLDOUT_DAYS * 24;

  const missing = FEATURES.filter((f) => !panel.data.has(f));
  if (missing.length > 0) throw new Error(`panel is missing ${missing.join(', ')}`);

  console.log(`\nEXPECTED MOVE — FIT`);
  console.log(`panel     ${IN}  ${nTimes.toLocaleString()} hours x ${nC} coins`);
  console.log(`features  ${FEATURES.length}: ${FEATURES.join(' ')}`);
  console.log(`train     everything before ${new Date(panel.times[holdoutLo]).toISOString().slice(0, 10)}, minus a horizon embargo\n`);

  const fitted: Record<number, { weights: number[]; ratios: { p50: number; p80: number; p90: number } }> = {};

  for (const horizon of HORIZONS) {
    const baseline = buildBaseline(panel, horizon, BASELINE_HOURS);
    const residual = buildResidualTarget(panel, horizon, baseline, holdoutLo);
    const magPanel: Panel = { ...panel, data: new Map(panel.data) };
    magPanel.data.set(`fwd${horizon}h`, residual);
    const d = buildDesign(magPanel, [...FEATURES], horizon);

    // One fit on the training period, embargoed at the holdout boundary. The
    // per-fold weights purgedKFold produces are for scoring, not for shipping.
    const nF = FEATURES.length;
    const xtx = Array.from({ length: nF }, () => new Array<number>(nF).fill(0));
    const xty = new Array<number>(nF).fill(0);
    let used = 0;
    for (let r = 0; r < d.nRows; r += 1) {
      if (d.timeIdx[r] >= holdoutLo - horizon) continue;
      const at = r * nF;
      for (let i = 0; i < nF; i += 1) {
        const xi = d.x[at + i];
        if (xi === 0) continue;
        xty[i] += xi * d.y[r];
        for (let j = i; j < nF; j += 1) xtx[i][j] += xi * d.x[at + j];
      }
      used += 1;
    }
    for (let i = 0; i < nF; i += 1) for (let j = 0; j < i; j += 1) xtx[i][j] = xtx[j][i];
    const weights = solveRidge(xtx, xty, LAMBDA * used);

    // Ratios, from the same training rows: realised |move| over predicted.
    const raw = panel.data.get(`fwd${horizon}h`)!;
    const ratios: number[] = [];
    for (let r = 0; r < d.nRows; r += 1) {
      const t = d.timeIdx[r];
      if (t >= holdoutLo - horizon) continue;
      const b = baseline[t * nC + d.coinIdx[r]];
      const y = raw[t * nC + d.coinIdx[r]];
      if (!Number.isFinite(b) || !Number.isFinite(y)) continue;
      const at = r * nF;
      let tilt = 0;
      for (let i = 0; i < nF; i += 1) tilt += weights[i] * d.x[at + i];
      const p = b + tilt;
      if (p > 0) ratios.push(Math.abs(y) / p);
    }
    ratios.sort((a, b) => a - b);

    fitted[horizon] = {
      weights,
      ratios: { p50: pct(ratios, 50), p80: pct(ratios, 80), p90: pct(ratios, 90) },
    };
    console.log(
      `${String(horizon).padStart(2)}h  rows ${used.toLocaleString().padStart(9)}  ` +
        `ratios p50 ${fitted[horizon].ratios.p50.toFixed(4)} ` +
        `p80 ${fitted[horizon].ratios.p80.toFixed(4)} p90 ${fitted[horizon].ratios.p90.toFixed(4)}`,
    );
  }

  const body = `/**
 * Fitted constants for the expected-move cone. GENERATED — do not edit.
 *
 *   pnpm --filter api expected-move-fit
 *
 * Fitted ${new Date().toISOString().slice(0, 10)} on ${IN}, training rows only
 * (everything before the last ${HOLDOUT_DAYS} days, minus a horizon embargo).
 * Ridge lambda ${LAMBDA}, scaled by row count. Baseline window ${BASELINE_HOURS / 24} days.
 *
 * \`weights\` apply to the features in FEATURE_ORDER, cross-sectionally
 * standardised across the coins present in the same hour, in that exact order.
 * \`ratios\` turn one predicted scale into a cone: quantile = predicted * ratio.
 */
export const FEATURE_ORDER = [
${FEATURES.map((f) => `  '${f}',`).join('\n')}
] as const;

export type ExpectedMoveFeature = (typeof FEATURE_ORDER)[number];

/** Trailing window for the per-coin volatility baseline, in hours. */
export const BASELINE_WINDOW_HOURS = ${BASELINE_HOURS};

export interface HorizonFit {
  weights: number[];
  ratios: { p50: number; p80: number; p90: number };
}

export const FITTED: Record<number, HorizonFit> = {
${HORIZONS.map(
  (h) => `  ${h}: {
    weights: [${fitted[h].weights.map((w) => w.toExponential(8)).join(', ')}],
    ratios: { p50: ${fitted[h].ratios.p50.toFixed(6)}, p80: ${fitted[h].ratios.p80.toFixed(6)}, p90: ${fitted[h].ratios.p90.toFixed(6)} },
  },`,
).join('\n')}
};

export const HORIZONS = [${HORIZONS.join(', ')}] as const;
export type ExpectedMoveHorizon = (typeof HORIZONS)[number];
`;

  fs.mkdirSync('src/expected-move', { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(`\nwritten ${OUT}`);
}

if (require.main === module) main();
