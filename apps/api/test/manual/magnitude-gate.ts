/**
 * Magnitude gate — can predicting the SIZE of the next move rescue direction?
 *
 *   pnpm --filter api magnitude-gate
 *   pnpm --filter api magnitude-gate -- --shuffle
 *
 * ─── The question ────────────────────────────────────────────────────────
 * Phase C's combined directional signal earns ~1.3 gross bp at 4h against a
 * 14 bp round trip, priced over every hour, strong and weak alike. If the
 * features also carry information about SIZE, then trading only when the
 * predicted move is large might clear the fee even though the average hour
 * does not. That is the last cheap idea left before direction is declared
 * dead, and this file is the test of it.
 *
 * ─── Why the magnitude model is NOT purely cross-sectional ───────────────
 * Phase C standardises every feature within the hour, which deletes the
 * market-wide level on purpose — that is what stops a result being "we were
 * long crypto". For DIRECTION that is right. For MAGNITUDE it removes
 * exactly the thing being predicted: a cross-sectionally standardised design
 * with no intercept can only produce deviations around zero, so its forecast
 * never reaches an absolute threshold like 40 bp at all. Fitting it that way
 * returns zero trades — not a null result, a mis-specified model.
 *
 * So magnitude is decomposed, and the two halves are reported separately:
 *
 *   predicted |return| = baseline + tilt
 *
 *   baseline  per-coin trailing mean |4h return| over the past 30 days,
 *             using only returns already realised at the decision time.
 *             This is volatility clustering, and it needs no features.
 *   tilt      ridge on the 43 cross-sectionally standardised Phase C
 *             features, fit to (winsorised |return| − baseline). This is the
 *             only part the features can claim.
 *
 * Reporting them apart is the point. If the gate works on baseline alone,
 * the features bought nothing and the answer is "trade when the market is
 * volatile", which is not a discovery.
 *
 * ─── Guards ──────────────────────────────────────────────────────────────
 * `buildDesign` and `purgedKFold` are Phase C's, unmodified: same feature
 * gates, same purge, embargo = 4h. Evaluation is the standard 182-day
 * holdout this project uses elsewhere (Stage 0, Phase D), touched once. That
 * window sits inside the final fold, so every prediction scored here comes
 * from a model trained on the other four.
 *
 * Rule 9 (briefing §5): the training target is winsorised at the 1st/99th
 * percentile of TRAIN rows only. The P&L below is priced on the raw,
 * unclipped return — a real 20% move costs what it costs.
 *
 * ─── The book ─────────────────────────────────────────────────────────────
 * One flat bet per (coin, hour) whose predicted |return| clears the
 * threshold, direction = sign of the Phase C directional forecast, skipped
 * if that coin already has a position open. Non-overlap is tracked PER COIN:
 * two different coins gated in the same hour are two real positions, not one
 * book spending the same capital twice.
 *
 * ─── Falsification, declared before the run ──────────────────────────────
 * Net bp = gross − 14, with a 95% interval from a 30-day block bootstrap.
 * The gate fails unless that interval's lower bound is above zero — i.e.
 * unless gross clears the fee at the bottom of its interval.
 *
 * (The brief that commissioned this file wrote the bar as "the lower bound
 * on net bp is below 14". Net bp is already gross minus the 14 bp fee, so
 * reading that literally charges the fee twice and would demand 28 bp gross.
 * Both the gross and the net interval are printed, so either bar can be
 * checked against the same numbers.)
 *
 * ─── Controls ─────────────────────────────────────────────────────────────
 * Three arms, always reported together:
 *   full      baseline + ridge tilt
 *   baseline  volatility clustering only, no features
 *   ungated   every holdout row, no magnitude gate at all
 *
 * and `--shuffle`, which permutes the magnitude forecast among the coins
 * present in each hour, leaving direction and the realised return where they
 * are. The hour's volatility environment survives untouched; only the
 * coin-specific mapping dies. If the shuffled gate scores like the real one,
 * the gate is selecting volatile HOURS, not volatile coins.
 */
import * as fs from 'fs';
import {
  load, Panel, NOT_A_FEATURE, mean, rankPersistence, blockBootstrapMean,
} from './phase-b';
import { buildDesign, purgedKFold, Design } from './phase-c';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const OUT = str('out', 'test/manual/results/magnitude-gate.csv');
const HORIZON = 4;
const FOLDS = num('folds', 5);
const LAMBDA = num('lambda', 10);
const HOLDOUT_DAYS = num('holdout-days', 182);
const THRESHOLD_BP = num('threshold-bp', 40);
const COST_BP = num('cost-bp', 14);
const BLOCK_DAYS = num('block-days', 30);
const DRAWS = num('draws', 2000);
const SEED = num('seed', 12345);
const MIN_COVERAGE = num('min-coverage', 0.9);
const MAX_PERSIST = num('max-persist', 0.5);
const PERSIST_LAG_HOURS = num('persist-lag', 30 * 24);
const WINSOR_LO = num('winsor-lo', 0.01);
const WINSOR_HI = num('winsor-hi', 0.99);
/** Trailing window for the volatility baseline, in hours. */
const BASELINE_HOURS = num('baseline-hours', 30 * 24);
/** Thresholds the same book is re-priced at, because one that keeps 99% of the
 *  rows has not gated anything and cannot answer the question. */
const SWEEP_BP = str('sweep', '40,60,80,100,150,200,300').split(',').map(Number);
/** Distinct 30-day blocks a result needs before its interval means anything. */
const MIN_BLOCKS = num('min-blocks', 4);
const SHUFFLE = args.includes('--shuffle');

// ── feature selection: identical gates to Phase C ──────────────────────────

export function selectFeatures(panel: Panel): { kept: string[]; dropped: string[] } {
  const all = panel.columns.filter((c) => !NOT_A_FEATURE(c));
  const nCells = panel.times.length * panel.coins.length;
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const f of all) {
    const col = panel.data.get(f)!;
    let n = 0;
    for (let i = 0; i < col.length; i += 1) if (Number.isFinite(col[i])) n += 1;
    const cover = n / nCells;
    const persist = rankPersistence(panel, f, PERSIST_LAG_HOURS);
    if (cover < MIN_COVERAGE) dropped.push(`${f} (coverage ${(cover * 100).toFixed(0)}%)`);
    else if (!Number.isFinite(persist)) dropped.push(`${f} (persistence unmeasurable)`);
    else if (Math.abs(persist) >= MAX_PERSIST) dropped.push(`${f} (persistence ${persist.toFixed(2)})`);
    else kept.push(f);
  }
  return { kept, dropped };
}

// ── the volatility baseline ────────────────────────────────────────────────

/**
 * Per-coin trailing mean |fwd{h}h| over `window` hours, lagged so that only
 * returns ALREADY REALISED at the decision hour are in it.
 *
 * The return stamped at hour t is not known until t + h, so the newest term
 * available when deciding at hour ti is the one stamped ti - h. Using the
 * return stamped at ti itself is the answer, and it would make the baseline
 * look extraordinarily good.
 */
export function buildBaseline(panel: Panel, horizon: number, window: number): Float64Array {
  const nC = panel.coins.length;
  const nT = panel.times.length;
  const raw = panel.data.get(`fwd${horizon}h`)!;
  const out = new Float64Array(nT * nC).fill(NaN);

  for (let ci = 0; ci < nC; ci += 1) {
    // Prefix sums over |return| and over the count of readings present.
    const sum = new Float64Array(nT + 1);
    const cnt = new Int32Array(nT + 1);
    for (let ti = 0; ti < nT; ti += 1) {
      const v = raw[ti * nC + ci];
      const ok = Number.isFinite(v);
      sum[ti + 1] = sum[ti] + (ok ? Math.abs(v) : 0);
      cnt[ti + 1] = cnt[ti] + (ok ? 1 : 0);
    }
    for (let ti = 0; ti < nT; ti += 1) {
      const hi = ti - horizon + 1; // exclusive end: newest realised is ti-horizon
      const lo = Math.max(0, hi - window);
      if (hi <= lo) continue;
      const n = cnt[hi] - cnt[lo];
      if (n < 30) continue; // too little history to call it a level
      out[ti * nC + ci] = (sum[hi] - sum[lo]) / n;
    }
  }
  return out;
}

// ── the training target ────────────────────────────────────────────────────

const quantile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/**
 * (winsorised |fwd{h}h|) − baseline, the part of the move's size the baseline
 * did not already explain. Clip percentiles come from TRAIN rows only and are
 * then applied everywhere; the holdout never sets its own bounds.
 */
export function buildResidualTarget(
  panel: Panel,
  horizon: number,
  baseline: Float64Array,
  holdoutLo: number,
): Float64Array {
  const nC = panel.coins.length;
  const raw = panel.data.get(`fwd${horizon}h`)!;
  const trainAbs: number[] = [];
  for (let ti = 0; ti < holdoutLo; ti += 1) {
    for (let ci = 0; ci < nC; ci += 1) {
      const v = raw[ti * nC + ci];
      if (Number.isFinite(v)) trainAbs.push(Math.abs(v));
    }
  }
  trainAbs.sort((a, b) => a - b);
  const lo = quantile(trainAbs, WINSOR_LO);
  const hi = quantile(trainAbs, WINSOR_HI);

  const out = new Float64Array(raw.length).fill(NaN);
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    const b = baseline[i];
    if (!Number.isFinite(v) || !Number.isFinite(b)) continue;
    out[i] = Math.min(hi, Math.max(lo, Math.abs(v))) - b;
  }
  return out;
}

// ── controls ───────────────────────────────────────────────────────────────

/** Rows are time-ascending out of buildDesign, so a run of equal timeIdx is
 *  exactly one hour's coins. Permutes values inside each such run. */
export function shuffleWithinHour(d: Design, values: Float64Array, seed: number): Float64Array {
  const rng = makeRng(seed);
  const out = values.slice();
  let i = 0;
  while (i < d.nRows) {
    let j = i;
    while (j + 1 < d.nRows && d.timeIdx[j + 1] === d.timeIdx[i]) j += 1;
    for (let k = j; k > i; k -= 1) {
      const s = i + Math.floor(rng() * (k - i + 1));
      const tmp = out[k];
      out[k] = out[s];
      out[s] = tmp;
    }
    i = j + 1;
  }
  return out;
}

// ── the gated book ─────────────────────────────────────────────────────────

interface GateBook {
  trades: number;
  grossBp: number;
  netBp: number;
  lo: number;
  hi: number;
  /** Mean realised |return| of the rows traded, in bp. The magnitude model's
   *  own scoreboard, independent of whether direction made money. */
  realisedAbsBp: number;
  /**
   * How many distinct 30-day blocks the trades fall in — the honest sample
   * size. A tight threshold can leave a handful of trades inside ONE block,
   * and a block bootstrap over one block resamples the same block every draw
   * and returns a zero-width interval. That is not certainty, it is an
   * interval with nothing to resample, and printing the count is what stops
   * it being read as a pass.
   */
  blocks: number;
}

function gatedBook(
  d: Design,
  dirPred: Float64Array,
  magPred: Float64Array | null,
  holdoutLo: number,
  bucket: 'high' | 'low' | 'all',
  thresholdBp: number,
): GateBook {
  const threshold = thresholdBp / 1e4;
  const nextFree = new Map<number, number>();
  const taken: Array<{ time: number; value: number }> = [];
  const absMoves: number[] = [];

  for (let r = 0; r < d.nRows; r += 1) {
    const t = d.timeIdx[r];
    if (t < holdoutLo) continue; // train + embargo region, never evaluated
    const p = dirPred[r];
    if (!Number.isFinite(p) || p === 0) continue;
    if (bucket !== 'all') {
      const m = magPred![r];
      if (!Number.isFinite(m)) continue;
      if ((bucket === 'high') !== m > threshold) continue;
    }
    const coin = d.coinIdx[r];
    if (t < (nextFree.get(coin) ?? -Infinity)) continue;
    taken.push({ time: t * 3_600_000, value: Math.sign(p) * d.y[r] * 1e4 });
    absMoves.push(Math.abs(d.y[r]) * 1e4);
    nextFree.set(coin, t + HORIZON);
  }

  const grossBp = taken.length === 0 ? NaN : mean(taken.map((x) => x.value));
  const boot = blockBootstrapMean(taken, BLOCK_DAYS, DRAWS, SEED);
  return {
    trades: taken.length,
    grossBp,
    netBp: grossBp - COST_BP,
    lo: boot.lo,
    hi: boot.hi,
    realisedAbsBp: absMoves.length === 0 ? NaN : mean(absMoves),
    blocks: boot.blocks,
  };
}

// ── main ─────────────────────────────────────────────────────────────────

function main(): void {
  const t0 = Date.now();
  const panel = load(IN);
  const nTimes = panel.times.length;
  const holdoutLo = nTimes - HOLDOUT_DAYS * 24;
  const { kept, dropped } = selectFeatures(panel);

  console.log(`\nMAGNITUDE GATE${SHUFFLE ? '  [SHUFFLED CONTROL]' : ''}`);
  console.log(`panel        ${IN}  ${nTimes.toLocaleString()} hours x ${panel.coins.length} coins`);
  console.log(`\n── pre-registered, before any result ──`);
  console.log(`features     ${kept.length} of ${kept.length + dropped.length}, Phase C's coverage and persistence gates`);
  console.log(`target       |log return| @${HORIZON}h, winsorised [${WINSOR_LO}, ${WINSOR_HI}] on TRAIN rows, minus a ${BASELINE_HOURS / 24}-day per-coin baseline`);
  console.log(`forecast     baseline + ridge tilt, lambda ${LAMBDA}, ${FOLDS} purged calendar folds, embargo ${HORIZON}h`);
  console.log(`holdout      last ${HOLDOUT_DAYS} days, touched once: ${new Date(panel.times[holdoutLo]).toISOString().slice(0, 10)} -> ${new Date(panel.times[nTimes - 1]).toISOString().slice(0, 10)}`);
  console.log(`gate         one flat bet per (coin, hour) with predicted |return| > ${THRESHOLD_BP} bp, direction = Phase C sign, per-coin non-overlap`);
  console.log(`the test     net bp = gross − ${COST_BP}; interval = ${BLOCK_DAYS}-day block bootstrap, ${DRAWS} draws`);
  console.log(`the bar      the gate fails unless the 95% lower bound on NET bp is above zero\n`);

  // Direction: Phase C's own model, unchanged.
  const dirDesign = buildDesign(panel, kept, HORIZON);
  const dirPred = purgedKFold(dirDesign, nTimes, FOLDS, HORIZON, LAMBDA).pred;

  // Magnitude: baseline + ridge tilt on the residual.
  const baseline = buildBaseline(panel, HORIZON, BASELINE_HOURS);
  const residual = buildResidualTarget(panel, HORIZON, baseline, holdoutLo);
  const magPanel: Panel = { ...panel, data: new Map(panel.data) };
  magPanel.data.set(`fwd${HORIZON}h`, residual);
  const magDesign = buildDesign(magPanel, kept, HORIZON);
  const tiltPred = purgedKFold(magDesign, nTimes, FOLDS, HORIZON, LAMBDA).pred;

  // magDesign drops rows the baseline could not reach, so it is NOT row-aligned
  // with dirDesign. Both are keyed by (timeIdx, coinIdx), which is unique, so
  // the tilt is carried across on that key rather than on a row number.
  const key = (t: number, c: number): number => t * 100 + c;
  const tiltByCell = new Map<number, number>();
  for (let r = 0; r < magDesign.nRows; r += 1) {
    if (Number.isFinite(tiltPred[r])) tiltByCell.set(key(magDesign.timeIdx[r], magDesign.coinIdx[r]), tiltPred[r]);
  }

  const nC = panel.coins.length;
  const full = new Float64Array(dirDesign.nRows).fill(NaN);
  const baseOnly = new Float64Array(dirDesign.nRows).fill(NaN);
  for (let r = 0; r < dirDesign.nRows; r += 1) {
    const t = dirDesign.timeIdx[r];
    const c = dirDesign.coinIdx[r];
    const b = baseline[t * nC + c];
    if (!Number.isFinite(b)) continue;
    baseOnly[r] = b;
    const tilt = tiltByCell.get(key(t, c));
    if (tilt !== undefined) full[r] = b + tilt;
  }

  const magPred = SHUFFLE ? shuffleWithinHour(dirDesign, full, SEED) : full;

  const arms: Array<[string, GateBook]> = [
    ['full  high-magnitude', gatedBook(dirDesign, dirPred, magPred, holdoutLo, 'high', THRESHOLD_BP)],
    ['full  low-magnitude', gatedBook(dirDesign, dirPred, magPred, holdoutLo, 'low', THRESHOLD_BP)],
    ['baseline only  high', gatedBook(dirDesign, dirPred, SHUFFLE ? shuffleWithinHour(dirDesign, baseOnly, SEED) : baseOnly, holdoutLo, 'high', THRESHOLD_BP)],
    ['ungated (no gate)', gatedBook(dirDesign, dirPred, null, holdoutLo, 'all', THRESHOLD_BP)],
  ];

  console.log(
    `${'arm'.padEnd(21)} ${'trades'.padStart(7)} ${'blocks'.padStart(6)} ${'gross bp'.padStart(9)} ${`net@${COST_BP}`.padStart(8)} ` +
      `${'95% interval on net'.padStart(22)} ${'realised |move|'.padStart(16)}`,
  );
  for (const [label, b] of arms) {
    console.log(
      `${label.padEnd(21)} ${b.trades.toLocaleString().padStart(7)} ${String(b.blocks).padStart(6)} ` +
        `${b.grossBp.toFixed(2).padStart(9)} ${b.netBp.toFixed(2).padStart(8)} ` +
        `${`[${(b.lo - COST_BP).toFixed(2)}, ${(b.hi - COST_BP).toFixed(2)}]`.padStart(22)} ` +
        `${`${b.realisedAbsBp.toFixed(0)} bp`.padStart(16)}`,
    );
  }

  const high = arms[0][1];
  const netLo = high.lo - COST_BP;
  // A pass needs the interval to clear zero AND to have been built from more
  // than one block. One block is one month of market, resampled against
  // itself.
  const verdict = Number.isFinite(netLo) && netLo > 0 && high.blocks >= MIN_BLOCKS ? 'PASSES' : 'FAILS';
  console.log(
    `\nHigh-magnitude bucket: net@${COST_BP} = ${high.netBp.toFixed(2)} bp, 95% lower bound ` +
      `${Number.isFinite(netLo) ? netLo.toFixed(2) : 'NaN'} bp. Gate ${verdict}.`,
  );
  console.log(
    `Read the two controls before believing anything: "baseline only" is the same gate with no ` +
      `features in it, and --shuffle breaks which coin got which forecast.`,
  );

  // ── how selective is the threshold, and does ANY setting of it help? ────
  //
  // The pre-registered 40 bp is far below the median 4-hour move, so it keeps
  // almost every row and gates nothing. A single threshold that does not bind
  // cannot answer the question it was asked, so the same book is priced across
  // a ladder of thresholds. If magnitude selection can pay the fee anywhere,
  // it shows up here; if the net stays flat as the book shrinks, size and
  // direction are unrelated on this data and no threshold will save it.
  console.log(`\n── threshold sweep, high-magnitude bucket ──`);
  console.log(
    `${'threshold'.padStart(9)} ${'trades'.padStart(7)} ${'kept'.padStart(6)} ${'blocks'.padStart(6)} ${'gross bp'.padStart(9)} ` +
      `${`net@${COST_BP}`.padStart(8)} ${'95% interval on net'.padStart(22)} ${'realised |move|'.padStart(16)}`,
  );
  const ungatedTrades = arms[3][1].trades;
  const sweepRows: string[] = [];
  for (const th of SWEEP_BP) {
    const b = gatedBook(dirDesign, dirPred, magPred, holdoutLo, 'high', th);
    console.log(
      `${`${th} bp`.padStart(9)} ${b.trades.toLocaleString().padStart(7)} ` +
        `${`${((b.trades / ungatedTrades) * 100).toFixed(0)}%`.padStart(6)} ` +
        `${String(b.blocks).padStart(6)} ` +
        `${b.grossBp.toFixed(2).padStart(9)} ${b.netBp.toFixed(2).padStart(8)} ` +
        `${`[${(b.lo - COST_BP).toFixed(2)}, ${(b.hi - COST_BP).toFixed(2)}]`.padStart(22)} ` +
        `${`${b.realisedAbsBp.toFixed(0)} bp`.padStart(16)}` +
        `${b.blocks > 0 && b.blocks < MIN_BLOCKS ? `  UNDER ${MIN_BLOCKS} BLOCKS — INTERVAL MEANINGLESS` : ''}`,
    );
    sweepRows.push(
      [`sweep ${th}bp`, SHUFFLE ? 1 : 0, b.trades, b.grossBp, b.netBp,
        b.lo - COST_BP, b.hi - COST_BP, b.realisedAbsBp].join(','),
    );
  }

  fs.writeFileSync(
    OUT,
    ['arm,shuffled,trades,grossBp,netBp,netBootLo,netBootHi,realisedAbsBp']
      .concat(
        arms.map(([label, b]) =>
          [label.trim(), SHUFFLE ? 1 : 0, b.trades, b.grossBp, b.netBp,
            b.lo - COST_BP, b.hi - COST_BP, b.realisedAbsBp].join(','),
        ),
      )
      .concat(sweepRows)
      .join('\n') + '\n',
  );
  console.log(`\nwritten ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) main();
