/**
 * Phase C — do the weak signals combine into one that pays the fee?
 *
 *   pnpm --filter api phase-c
 *
 * ─── The one question ────────────────────────────────────────────────────
 * Phase B found seven families over |t| > 3.0 and priced every one of them
 * three to eight times underwater on cost. The best single feature earned
 * 4.79 bp per trade against a 14 bp round trip. Combining weak, partly
 * independent signals is the standard way that gap gets closed, and whether it
 * closes here is the only thing this file measures.
 *
 * So the answer is in BASIS POINTS, not t-stats. Phase B's own lesson is that
 * a rank IC can clear |t| = 6 while the return profile is flat, or while the
 * money runs the other way — `sup_1h_distPct` and `percentB` respectively. The
 * combiner is therefore fit to the forward RETURN and scored on money.
 *
 * ─── Guards ──────────────────────────────────────────────────────────────
 * Purged K-fold with an embargo. Folds are contiguous calendar blocks, and the
 * `horizon` hours on each side of a test fold are dropped from training,
 * because a 72-hour forward return computed one hour before the fold boundary
 * contains 71 hours of the test period. Without the purge the model is scored
 * on data it was fit on and every number below is fiction.
 *
 * Features are cross-sectionally standardised within each hour, so the market
 * move common to all ten coins is gone before the fit sees anything. Any
 * feature whose ranking survives a month is dropped outright — Phase B's
 * persistence gate, and the reason raw `openInterest` is not in here.
 *
 * `--shuffle` permutes which coin got which forward return inside each hour.
 * Nothing should clear anything.
 */
import * as fs from 'fs';
import { load, Panel, NOT_A_FEATURE, spearman, mean, rankPersistence, blockBootstrapMean } from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const OUT = str('out', 'test/manual/results/phase-c.csv');
const FOLDS = num('folds', 5);
const LAMBDA = num('lambda', 10);
const MIN_COINS = num('min-coins', 8);
/** Coverage a feature needs before it is allowed in. Below this its blanks,
 *  filled with "no opinion", are most of what the model sees. */
const MIN_COVERAGE = num('min-coverage', 0.9);
const MAX_PERSIST = num('max-persist', 0.5);
const PERSIST_LAG_HOURS = num('persist-lag', 30 * 24);
/** Coins held long and short. 3 of 10 is the same book Phase B was priced on. */
const K = num('k', 3);
/** Round trip in basis points, charged once per closed trade on total capital. */
const COSTS = str('costs', '0,14,25').split(',').map(Number);
/**
 * Only trade when the forecast spread is in the top slice of its own recent
 * history. Cost is charged per trade, so skipping the weak hours is the one
 * lever that can make a small edge pay a fixed fee — trade a tenth as often and
 * the fee bill falls tenfold while the strongest signals are kept.
 *
 * The percentile is taken against a TRAILING window, never the whole sample.
 * Ranking today's conviction against a distribution that includes next year is
 * a look-ahead, and a subtle one: it would select exactly the hours that turned
 * out to matter.
 */
const CONVICTION = num('conviction', 0); // 0 = trade every hour
const CONVICTION_WINDOW = num('conviction-window', 30 * 24);
const SHUFFLE = args.includes('--shuffle');
const SEED = num('seed', 12345);

const HORIZONS = [4, 12, 24, 72];

// ── linear algebra, such as it is ────────────────────────────────────────

/**
 * Solve `(A + lambda*I) w = b` by Gaussian elimination with partial pivoting.
 *
 * Ridge rather than plain least squares because the features are correlated by
 * construction — Phase B found seven families all telling one mean-reversion
 * story, and an unpenalised fit on correlated columns produces enormous
 * cancelling weights that do not survive out of sample.
 */
export function solveRidge(a: number[][], b: number[], lambda: number): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row.map((v, j) => (i === j ? v + lambda : v)), b[i]]);
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) {
      // Singular even after the ridge term: refusing beats returning a vector
      // of plausible-looking garbage.
      throw new Error(`solveRidge: column ${c} is singular at lambda ${lambda}`);
    }
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

// ── the design matrix ────────────────────────────────────────────────────

interface Design {
  features: string[];
  /** rows[i] = one (hour, coin) observation, already cross-sectionally standardised. */
  x: Float64Array;
  y: Float64Array;
  timeIdx: Int32Array;
  coinIdx: Int32Array;
  nRows: number;
}

/**
 * Cross-sectional standardisation: within one hour, each feature is centred and
 * scaled across the coins present.
 *
 * This is what makes the forecast a statement about WHICH coin rather than
 * about the market, and it is why the result cannot be "we were long crypto".
 * A cell with no reading becomes 0, which after centring means "no opinion
 * relative to the other coins" — the only filling that does not invent a view.
 */
export function buildDesign(panel: Panel, features: string[], horizon: number): Design {
  const nC = panel.coins.length;
  const nF = features.length;
  const cols = features.map((f) => panel.data.get(f)!);
  const y = panel.data.get(`fwd${horizon}h`)!;

  const xs: number[] = [];
  const ys: number[] = [];
  const ts: number[] = [];
  const cs: number[] = [];
  const buf = new Float64Array(nC);

  for (let ti = 0; ti < panel.times.length; ti += 1) {
    const present: number[] = [];
    for (let ci = 0; ci < nC; ci += 1) {
      if (Number.isFinite(y[ti * nC + ci])) present.push(ci);
    }
    if (present.length < MIN_COINS) continue;

    // One standardised row per present coin, features in `features` order.
    const rows = present.map(() => new Float64Array(nF));
    for (let fi = 0; fi < nF; fi += 1) {
      const col = cols[fi];
      let sum = 0;
      let n = 0;
      for (let k = 0; k < present.length; k += 1) {
        const v = col[ti * nC + present[k]];
        buf[k] = v;
        if (Number.isFinite(v)) {
          sum += v;
          n += 1;
        }
      }
      if (n < 2) continue; // every row keeps 0 for this feature
      const mu = sum / n;
      let ss = 0;
      for (let k = 0; k < present.length; k += 1) {
        if (Number.isFinite(buf[k])) ss += (buf[k] - mu) ** 2;
      }
      const sd = Math.sqrt(ss / n);
      if (sd === 0) continue;
      for (let k = 0; k < present.length; k += 1) {
        if (Number.isFinite(buf[k])) rows[k][fi] = (buf[k] - mu) / sd;
      }
    }

    for (let k = 0; k < present.length; k += 1) {
      for (let fi = 0; fi < nF; fi += 1) xs.push(rows[k][fi]);
      ys.push(y[ti * nC + present[k]]);
      ts.push(ti);
      cs.push(present[k]);
    }
  }

  return {
    features,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    timeIdx: Int32Array.from(ts),
    coinIdx: Int32Array.from(cs),
    nRows: ys.length,
  };
}

// ── purged K-fold ────────────────────────────────────────────────────────

/**
 * Out-of-sample predictions, one per row, from contiguous calendar folds.
 *
 * The embargo is the whole point. A 72-hour forward return stamped one hour
 * before the test fold begins is 71 hours of the test period, and training on
 * it is training on the answer. Every training row within `horizon` hours of
 * either fold boundary is dropped.
 */
export function purgedKFold(
  d: Design,
  nTimes: number,
  folds: number,
  horizon: number,
  lambda: number,
): { pred: Float64Array; weights: number[][]; trainRows: number[] } {
  const nF = d.features.length;
  const pred = new Float64Array(d.nRows).fill(NaN);
  const weights: number[][] = [];
  const trainRows: number[] = [];
  const per = Math.floor(nTimes / folds);

  for (let f = 0; f < folds; f += 1) {
    const lo = f * per;
    const hi = f === folds - 1 ? nTimes : (f + 1) * per;

    const xtx = Array.from({ length: nF }, () => new Array<number>(nF).fill(0));
    const xty = new Array<number>(nF).fill(0);
    let used = 0;
    for (let r = 0; r < d.nRows; r += 1) {
      const t = d.timeIdx[r];
      if (t >= lo - horizon && t < hi + horizon) continue; // test fold + embargo
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

    const w = solveRidge(xtx, xty, lambda * used);
    weights.push(w);
    trainRows.push(used);

    for (let r = 0; r < d.nRows; r += 1) {
      const t = d.timeIdx[r];
      if (t < lo || t >= hi) continue;
      const at = r * nF;
      let s = 0;
      for (let i = 0; i < nF; i += 1) s += w[i] * d.x[at + i];
      pred[r] = s;
    }
  }
  return { pred, weights, trainRows };
}

// ── scoring, in money ────────────────────────────────────────────────────

export interface Book {
  trades: number;
  grossBp: number;
  ic: number;
  net: Map<number, number>;
  /** 95% block-bootstrap interval on the mean trade, in basis points. */
  lo: number;
  hi: number;
}

/**
 * Long the top K coins by forecast, short the bottom K, half the capital on
 * each leg, held `horizon` hours and never overlapping.
 *
 * Non-overlapping is deliberate. Overlapping holds would report the same hour's
 * move up to `horizon` times and make the trade count — and therefore the cost
 * — meaningless.
 */
export function scoreBook(
  d: Design,
  pred: Float64Array,
  horizon: number,
  k: number,
  costs: number[],
  conviction = 0,
  convictionWindow = 30 * 24,
): Book {
  const byTime = new Map<number, Array<{ p: number; y: number }>>();
  for (let r = 0; r < d.nRows; r += 1) {
    if (!Number.isFinite(pred[r])) continue;
    const t = d.timeIdx[r];
    const cell = byTime.get(t);
    if (cell) cell.push({ p: pred[r], y: d.y[r] });
    else byTime.set(t, [{ p: pred[r], y: d.y[r] }]);
  }

  const times = [...byTime.keys()].sort((a, b) => a - b);
  const rets: number[] = [];
  const ics: number[] = [];
  const history: Array<{ t: number; spread: number }> = [];
  const taken: Array<{ time: number; value: number }> = [];
  let nextFree = -Infinity;
  for (const t of times) {
    const rows = byTime.get(t)!;
    if (rows.length < 2 * k) continue;
    const rho = spearman(rows.map((r) => r.p), rows.map((r) => r.y));
    if (Number.isFinite(rho)) ics.push(rho);

    const sorted = [...rows].sort((a, b) => a.p - b.p);
    const avg = (xs: typeof rows, key: 'p' | 'y'): number =>
      xs.reduce((s, r) => s + r[key], 0) / xs.length;
    const spread = avg(sorted.slice(-k), 'p') - avg(sorted.slice(0, k), 'p');
    history.push({ t, spread });

    if (t < nextFree) continue;
    if (conviction > 0) {
      // Trailing window only. `history` is append-only in time order, so
      // everything in it is already in the past.
      const win = history.filter((h) => h.t >= t - convictionWindow && h.t < t);
      if (win.length < 50) continue;
      const below = win.filter((h) => h.spread <= spread).length / win.length;
      if (below < conviction) continue;
    }
    nextFree = t + horizon;
    const r = (avg(sorted.slice(-k), 'y') - avg(sorted.slice(0, k), 'y')) / 2;
    rets.push(r);
    taken.push({ time: t * 3_600_000, value: r * 1e4 });
  }

  const grossBp = rets.length === 0 ? NaN : mean(rets) * 1e4;
  const net = new Map(costs.map((c) => [c, grossBp - c]));
  // The interval is the whole point once a conviction gate is on: gating turns
  // thousands of trades into hundreds, and a mean over hundreds of noisy trades
  // moves a long way on its own.
  const boot = blockBootstrapMean(taken, 30, 2000, 12345);
  return {
    trades: rets.length,
    grossBp,
    ic: ics.length === 0 ? NaN : mean(ics),
    net,
    lo: boot.lo,
    hi: boot.hi,
  };
}

// ── main ─────────────────────────────────────────────────────────────────

function shuffleTargets(panel: Panel, seed: number): void {
  const rng = makeRng(seed);
  const nC = panel.coins.length;
  for (const h of HORIZONS) {
    const y = panel.data.get(`fwd${h}h`)!;
    for (let ti = 0; ti < panel.times.length; ti += 1) {
      const at = ti * nC;
      for (let i = nC - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = y[at + i];
        y[at + i] = y[at + j];
        y[at + j] = tmp;
      }
    }
  }
}

function main(): void {
  const t0 = Date.now();
  const panel = load(IN);
  if (SHUFFLE) shuffleTargets(panel, SEED);

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

  console.log(`\nPHASE C — combine${SHUFFLE ? '  [SHUFFLED CONTROL]' : ''}`);
  console.log(`panel      ${IN}  ${panel.times.length.toLocaleString()} hours x ${panel.coins.length} coins`);
  console.log(`\n── pre-registered ──`);
  console.log(`features   ${kept.length} of ${all.length}`);
  console.log(`dropped    ${dropped.length}: ${dropped.join(', ')}`);
  console.log(`model      ridge, lambda ${LAMBDA} (scaled by row count)`);
  console.log(`validation ${FOLDS} contiguous calendar folds, embargo = horizon`);
  console.log(`book       long top ${K}, short bottom ${K}, half capital each leg, non-overlapping`);
  console.log(
    `conviction ${CONVICTION === 0 ? 'off — every hour traded' : `only the top ${((1 - CONVICTION) * 100).toFixed(0)}% of forecast spreads, ranked against a trailing ${CONVICTION_WINDOW}h window`}`,
  );
  console.log(`the test   net basis points per trade at a ${COSTS.filter((c) => c > 0).join(' and ')} bp round trip\n`);

  const lines = ['horizon,trades,grossBp,' + COSTS.map((c) => `net${c}bp`).join(',') + ',bootLo,bootHi,oosIc,annualGrossPct'];
  console.log(
    `${'horizon'.padStart(7)} ${'trades'.padStart(7)} ${'gross bp'.padStart(9)} ` +
      COSTS.map((c) => `${`net@${c}`.padStart(8)}`).join(' ') +
      ` ${'95% interval on gross'.padStart(23)} ${'oos IC'.padStart(8)}`,
  );
  for (const h of HORIZONS) {
    const d = buildDesign(panel, kept, h);
    const { pred } = purgedKFold(d, panel.times.length, FOLDS, h, LAMBDA);
    const b = scoreBook(d, pred, h, K, COSTS, CONVICTION, CONVICTION_WINDOW);
    const perYear = (365 * 24) / h;
    console.log(
      `${`${h}h`.padStart(7)} ${b.trades.toLocaleString().padStart(7)} ${b.grossBp.toFixed(2).padStart(9)} ` +
        COSTS.map((c) => b.net.get(c)!.toFixed(2).padStart(8)).join(' ') +
        ` ${`[${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}]`.padStart(23)} ${b.ic.toFixed(4).padStart(8)}`,
    );
    lines.push(
      [h, b.trades, b.grossBp, ...COSTS.map((c) => b.net.get(c)), b.lo, b.hi, b.ic,
        (b.grossBp / 1e4) * perYear * 100].join(','),
    );
  }

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  const bar = COSTS.filter((c) => c > 0)[0];
  console.log(
    `\nThe question was whether the combination clears ${bar} bp per trade. ` +
      `Read the net@${bar} column; a negative number is the answer being no.`,
  );
  console.log(`written ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) main();
