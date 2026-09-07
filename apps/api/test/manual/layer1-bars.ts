/**
 * Layer 1's falsification bars, run before any service is written.
 *
 *   pnpm --filter api layer1-bars
 *
 * Three bars, all pre-registered in docs/PRODUCT_LAYERS.md before this file
 * existed. If any fails, Layer 1 does not get built — which is the point of
 * running them first rather than after.
 *
 *   1a  the magnitude model reproduces its skill on the holdout
 *       realised |move| rises monotonically across predicted quintiles, and
 *       the top quintile exceeds the bottom by >= 20 bp
 *
 *   1b  the skill is coin-specific, not a volatile-hour effect
 *       permute the forecast among the coins present in each hour; the real
 *       model's top quintile must beat the shuffled one's by >= 8 bp
 *
 *   1c  regimes are states, not flicker
 *       median regime duration > 12 hours, and the three regimes show
 *       materially different 24h exit rates
 *
 * ─── Why 1b is the one that matters ──────────────────────────────────────
 * Volatility clusters. Any model handed a volatile hour will "predict" a big
 * move for every coin in it and score well on 1a alone. Shuffling the forecast
 * among that hour's coins leaves the hour exactly as volatile as it was and
 * destroys only the claim about WHICH coin. What survives that is the only
 * part the features can claim.
 *
 * ─── Why 1c is measured on 1-hour bars ───────────────────────────────────
 * Production classifies the regime on 12h candles, where a single bar already
 * spans 12 hours and "median duration > 12h" is passed by arithmetic rather
 * than by stability. Measuring hourly is the strict version of the same
 * question: does the label hold when it is allowed to change every hour? A
 * classifier that flickers hourly is not stable at 12h either — it is being
 * sampled too coarsely to show it.
 *
 * The rule reimplemented here is `MarketRegimeService.classifyFromContext`
 * exactly: band width at or below the 15th percentile of the trailing 200
 * readings (excluding the current one) is COMPRESSION; otherwise ADX above 25
 * is TRENDING; otherwise MEAN_REVERSION.
 */
import * as fs from 'fs';
import { load, Panel, mean } from './phase-b';
import { buildDesign, purgedKFold } from './phase-c';
import { selectFeatures, buildBaseline, buildResidualTarget, shuffleWithinHour } from './magnitude-gate';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const OUT = str('out', 'test/manual/results/layer1-bars.csv');
const FITTED = str('fitted', 'test/manual/results/expected-move-fit.json');
const HORIZONS = str('horizons', '4,12,24').split(',').map(Number);
const FOLDS = num('folds', 5);
const LAMBDA = num('lambda', 10);
const HOLDOUT_DAYS = num('holdout-days', 182);
const BASELINE_HOURS = num('baseline-hours', 30 * 24);
const QUINTILES = num('quintiles', 5);
const SEED = num('seed', 12345);
/**
 * `--live-only` restricts the tilt to the features that can still be computed
 * at run time: everything derived from candles, plus funding and premium, which
 * have live endpoints with years of history.
 *
 * It is not a tidier feature list, it is a deployability question. The flow
 * collector was switched off on 5 Sept 2026, so open interest, long/short,
 * taker and top-trader are no longer being written and have ~30 days of
 * retention behind them. The venue features need OKX and Bybit calls nothing
 * currently makes, and the book-depth features come from an archive published a
 * day late. A model that needs those cannot be served today, whatever it scores
 * offline — so both feature sets are measured and reported side by side.
 */
const LIVE_ONLY = args.includes('--live-only');
/** `--only <regex>` restricts the tilt further, for costing a cheaper service. */
const ONLY = str('only', '');
const LIVE_PREFIXES = /^(rsi|adx|pdi|mdi|percentB|bandWidth|qqe|sup_|res_|premium|fundingRate)/;

// Bars, declared as constants so the report cannot quietly move them.
const BAR_1A_SPREAD_BP = num('bar-1a', 20);
const BAR_1B_MARGIN_BP = num('bar-1b', 8);
const BAR_1C_MEDIAN_HOURS = num('bar-1c', 12);

// Regime rule — the exact constants MarketRegimeService uses.
const COMPRESSION_PERCENTILE = 15; // <= 15th percentile of trailing band width
const ADX_TREND_THRESHOLD = 25;
const BANDWIDTH_LOOKBACK = 200;

const pct = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];

// ── the magnitude model, exactly as the gate built it ─────────────────────

interface Fit {
  horizon: number;
  /** Holdout rows, aligned. */
  pred: number[];
  realisedAbs: number[];
  timeIdx: number[];
  coinIdx: number[];
  /** Same rows, forecast permuted among the coins present in each hour. */
  predShuffled: number[];
  /** realised |move| / predicted |move| on TRAIN rows, for the cone quantiles. */
  ratioQuantiles: { p50: number; p80: number; p90: number };
}

function fitHorizon(panel: Panel, kept: string[], horizon: number, holdoutLo: number): Fit {
  const nTimes = panel.times.length;
  const nC = panel.coins.length;

  const baseline = buildBaseline(panel, horizon, BASELINE_HOURS);
  const residual = buildResidualTarget(panel, horizon, baseline, holdoutLo);
  const magPanel: Panel = { ...panel, data: new Map(panel.data) };
  magPanel.data.set(`fwd${horizon}h`, residual);

  const design = buildDesign(magPanel, kept, horizon);
  const tilt = purgedKFold(design, nTimes, FOLDS, horizon, LAMBDA).pred;

  // The design is keyed on (timeIdx, coinIdx); carry the tilt back on that key
  // rather than a row number, since the residual's finite mask differs from the
  // raw return's wherever the baseline could not be formed.
  const raw = panel.data.get(`fwd${horizon}h`)!;

  const pred: number[] = [];
  const realisedAbs: number[] = [];
  const timeIdx: number[] = [];
  const coinIdx: number[] = [];
  // Train rows feed the ratio distribution the cone quantiles come from.
  const trainRatios: number[] = [];

  for (let r = 0; r < design.nRows; r += 1) {
    const t = design.timeIdx[r];
    const c = design.coinIdx[r];
    const b = baseline[t * nC + c];
    const y = raw[t * nC + c];
    if (!Number.isFinite(b) || !Number.isFinite(y) || !Number.isFinite(tilt[r])) continue;
    const p = b + tilt[r];
    if (p <= 0) continue; // a non-positive scale cannot carry a quantile

    if (t >= holdoutLo) {
      pred.push(p);
      realisedAbs.push(Math.abs(y) * 1e4);
      timeIdx.push(t);
      coinIdx.push(c);
    } else {
      trainRatios.push(Math.abs(y) / p);
    }
  }

  trainRatios.sort((a, b) => a - b);
  const ratioQuantiles = {
    p50: pct(trainRatios, 50),
    p80: pct(trainRatios, 80),
    p90: pct(trainRatios, 90),
  };

  // Shuffle control. Reuses the gate's within-hour permutation, which needs a
  // Design-shaped view; the holdout rows here are already time-ascending and
  // contiguous per hour, so a light shim is enough.
  const shim = {
    nRows: pred.length,
    timeIdx: Int32Array.from(timeIdx),
    coinIdx: Int32Array.from(coinIdx),
  } as never;
  const predShuffled = Array.from(shuffleWithinHour(shim, Float64Array.from(pred), SEED));

  return { horizon, pred, realisedAbs, timeIdx, coinIdx, predShuffled, ratioQuantiles };
}

// ── bars 1a and 1b ────────────────────────────────────────────────────────

/** Realised |move| per quintile of a forecast, in basis points. */
function quintileProfile(predictions: number[], realisedAbs: number[], q: number): number[] {
  const order = predictions.map((_, i) => i).sort((a, b) => predictions[a] - predictions[b]);
  const out: number[] = [];
  for (let k = 0; k < q; k += 1) {
    const lo = Math.floor((k * order.length) / q);
    const hi = Math.floor(((k + 1) * order.length) / q);
    const slice = order.slice(lo, hi).map((i) => realisedAbs[i]);
    out.push(slice.length === 0 ? NaN : mean(slice));
  }
  return out;
}

const isMonotonic = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

// ── bar 1c ────────────────────────────────────────────────────────────────

type Regime = 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';

/**
 * The regime label per (coin, hour), by MarketRegimeService's rule.
 * Returns one array per coin, indexed by time, with null where the trailing
 * band-width history is too short to judge.
 */
function labelRegimes(panel: Panel): Array<Array<Regime | null>> {
  const nC = panel.coins.length;
  const nT = panel.times.length;
  const bw = panel.data.get('bandWidth')!;
  const adx = panel.data.get('adx')!;
  const out: Array<Array<Regime | null>> = [];

  for (let ci = 0; ci < nC; ci += 1) {
    const labels: Array<Regime | null> = new Array(nT).fill(null);
    // A ring of the trailing readings, kept sorted-on-demand. 200 x 32,000 x 10
    // is small enough that a copy-and-sort per hour is fine and obviously right.
    const hist: number[] = [];
    for (let ti = 0; ti < nT; ti += 1) {
      const v = bw[ti * nC + ci];
      const a = adx[ti * nC + ci];
      if (hist.length >= BANDWIDTH_LOOKBACK && Number.isFinite(v) && Number.isFinite(a)) {
        const window = hist.slice(-BANDWIDTH_LOOKBACK).sort((x, y) => x - y);
        // percentileRank: share of the history at or below the current reading.
        let countLE = 0;
        for (const h of window) if (h <= v) countLE += 1;
        const rank = (countLE / window.length) * 100;
        labels[ti] = rank <= COMPRESSION_PERCENTILE
          ? 'COMPRESSION'
          : a > ADX_TREND_THRESHOLD
            ? 'TRENDING'
            : 'MEAN_REVERSION';
      }
      if (Number.isFinite(v)) hist.push(v);
    }
    out.push(labels);
  }
  return out;
}

interface RegimeStats {
  runs: number;
  medianHours: number;
  meanHours: number;
  exit24h: Map<Regime, { entries: number; exited: number }>;
  share: Map<Regime, number>;
}

function regimeStats(labels: Array<Array<Regime | null>>): RegimeStats {
  const durations: number[] = [];
  const exit24h = new Map<Regime, { entries: number; exited: number }>();
  const count = new Map<Regime, number>();
  let total = 0;

  for (const series of labels) {
    let i = 0;
    while (i < series.length) {
      const label = series[i];
      if (label === null) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < series.length && series[j + 1] === label) j += 1;
      durations.push(j - i + 1);

      count.set(label, (count.get(label) ?? 0) + (j - i + 1));
      total += j - i + 1;

      // 24h exit rate, measured from every hour inside the run rather than only
      // its start: "given I am in this regime now, is it over within a day?"
      for (let t = i; t <= j; t += 1) {
        if (t + 24 >= series.length) break;
        const cell = exit24h.get(label) ?? { entries: 0, exited: 0 };
        cell.entries += 1;
        if (series[t + 24] !== label) cell.exited += 1;
        exit24h.set(label, cell);
      }
      i = j + 1;
    }
  }

  durations.sort((a, b) => a - b);
  return {
    runs: durations.length,
    medianHours: durations.length === 0 ? NaN : pct(durations, 50),
    meanHours: durations.length === 0 ? NaN : mean(durations),
    exit24h,
    share: new Map([...count].map(([k, v]) => [k, v / total])),
  };
}

// ── main ─────────────────────────────────────────────────────────────────

function main(): void {
  const t0 = Date.now();
  const panel = load(IN);
  const nTimes = panel.times.length;
  const holdoutLo = nTimes - HOLDOUT_DAYS * 24;
  const all = selectFeatures(panel).kept;
  let kept = LIVE_ONLY ? all.filter((f) => LIVE_PREFIXES.test(f)) : all;
  if (ONLY) kept = kept.filter((f) => new RegExp(ONLY).test(f));

  console.log(`\nLAYER 1 — FALSIFICATION BARS${LIVE_ONLY ? '  [LIVE-DEPLOYABLE FEATURES ONLY]' : ''}`);
  console.log(`panel      ${IN}  ${nTimes.toLocaleString()} hours x ${panel.coins.length} coins`);
  console.log(`features   ${kept.length}${LIVE_ONLY ? ` of ${all.length} — LIVE-ONLY (candles + funding/premium)` : ''}`);
  console.log(`model      per-coin ${BASELINE_HOURS / 24}-day baseline + ridge tilt, lambda ${LAMBDA}, ${FOLDS} purged folds`);
  console.log(`holdout    last ${HOLDOUT_DAYS} days: ${new Date(panel.times[holdoutLo]).toISOString().slice(0, 10)} -> ${new Date(panel.times[nTimes - 1]).toISOString().slice(0, 10)}`);
  console.log(`\n── bars, declared before the run ──`);
  console.log(`1a  realised |move| monotonic across ${QUINTILES} quintiles, top - bottom >= ${BAR_1A_SPREAD_BP} bp`);
  console.log(`1b  real top quintile beats within-hour shuffle by >= ${BAR_1B_MARGIN_BP} bp`);
  console.log(`1c  median regime duration > ${BAR_1C_MEDIAN_HOURS}h, exit rates differ across regimes\n`);

  // ── 1a and 1b ──
  const lines = ['horizon,quintile,realisedAbsBp,shuffledRealisedAbsBp'];
  const fits: Fit[] = [];
  let pass1a = true;
  let pass1b = true;

  console.log('── bar 1a / 1b — expected move ──');
  for (const h of HORIZONS) {
    const fit = fitHorizon(panel, kept, h, holdoutLo);
    fits.push(fit);

    const real = quintileProfile(fit.pred, fit.realisedAbs, QUINTILES);
    const shuffled = quintileProfile(fit.predShuffled, fit.realisedAbs, QUINTILES);
    const spread = real[real.length - 1] - real[0];
    const margin = real[real.length - 1] - shuffled[shuffled.length - 1];
    const mono = isMonotonic(real);
    const ok1a = mono && spread >= BAR_1A_SPREAD_BP;
    const ok1b = margin >= BAR_1B_MARGIN_BP;
    pass1a = pass1a && ok1a;
    pass1b = pass1b && ok1b;

    console.log(
      `\n${h}h  n=${fit.pred.length.toLocaleString()}  ` +
        `quintiles ${real.map((x) => x.toFixed(0)).join(' -> ')} bp`,
    );
    console.log(
      `     shuffled  ${shuffled.map((x) => x.toFixed(0)).join(' -> ')} bp`,
    );
    console.log(
      `     1a: ${mono ? 'monotonic' : 'NOT MONOTONIC'}, spread ${spread.toFixed(1)} bp ` +
        `(bar ${BAR_1A_SPREAD_BP}) ${ok1a ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `     1b: top ${real[real.length - 1].toFixed(1)} vs shuffled ${shuffled[shuffled.length - 1].toFixed(1)}, ` +
        `margin ${margin.toFixed(1)} bp (bar ${BAR_1B_MARGIN_BP}) ${ok1b ? 'PASS' : 'FAIL'}`,
    );
    real.forEach((v, i) => lines.push([h, i + 1, v, shuffled[i]].join(',')));
  }

  // ── 1c ──
  console.log('\n── bar 1c — regime stability, on 1h bars ──');
  const labels = labelRegimes(panel);
  const stats = regimeStats(labels);
  console.log(`runs ${stats.runs.toLocaleString()}, median ${stats.medianHours.toFixed(0)}h, mean ${stats.meanHours.toFixed(1)}h`);
  const rates: number[] = [];
  for (const [regime, cell] of [...stats.exit24h].sort()) {
    const rate = cell.exited / cell.entries;
    rates.push(rate);
    console.log(
      `  ${regime.padEnd(15)} share ${((stats.share.get(regime) ?? 0) * 100).toFixed(1)}%  ` +
        `24h exit rate ${(rate * 100).toFixed(1)}%  (n=${cell.entries.toLocaleString()})`,
    );
  }
  const spreadRates = rates.length < 2 ? 0 : Math.max(...rates) - Math.min(...rates);
  const ok1c = stats.medianHours > BAR_1C_MEDIAN_HOURS && spreadRates >= 0.1;
  console.log(
    `  1c: median ${stats.medianHours.toFixed(0)}h (bar > ${BAR_1C_MEDIAN_HOURS}h), ` +
      `exit-rate spread ${(spreadRates * 100).toFixed(1)} points ${ok1c ? 'PASS' : 'FAIL'}`,
  );

  // ── the fitted constants Layer 1's service needs ──
  fs.writeFileSync(
    FITTED,
    JSON.stringify(
      {
        fittedAt: new Date().toISOString(),
        note: 'Cone quantiles are predicted |move| times these ratios. Fitted on TRAIN rows only; Layer 2 checks their coverage.',
        baselineDays: BASELINE_HOURS / 24,
        horizons: Object.fromEntries(fits.map((f) => [f.horizon, f.ratioQuantiles])),
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(OUT, lines.join('\n') + '\n');

  console.log('\n── verdict ──');
  console.log(`1a ${pass1a ? 'PASS' : 'FAIL'}   1b ${pass1b ? 'PASS' : 'FAIL'}   1c ${ok1c ? 'PASS' : 'FAIL'}`);
  console.log(`written ${OUT} and ${FITTED} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!pass1a || !pass1b || !ok1c) process.exitCode = 1;
}

if (require.main === module) main();
