/**
 * Phase B — does anything in the panel predict anything?
 *
 *   pnpm --filter api phase-b
 *
 * ─── The question ────────────────────────────────────────────────────────
 * For every feature and every horizon: rank the ten coins at each hour by the
 * feature, rank them by what actually happened next, and correlate the two.
 * That is the information coefficient, and it is the first time this project
 * asks "is there signal" without a fill, a stop or a ladder in the way.
 *
 * Cross-sectional is the PRIMARY measure, and not by taste. Ranking within one
 * timestamp subtracts the market move common to all ten coins, so a feature
 * cannot score by being long crypto during a bull run. The time-series IC is
 * reported beside it as a diagnostic and carries no t-stat, because ten coins
 * that move together are nothing like ten independent samples.
 *
 * ─── Why the naive t-stat is wrong here ──────────────────────────────────
 * A 24-hour forward return measured every hour shares 23 of its 24 hours with
 * the one before it. The IC series is autocorrelated by construction, and
 * `sd / sqrt(n)` on it understates the standard error by roughly sqrt(H) —
 * which turns a t of 1.0 into a t of 5.0 and a null result into a discovery.
 *
 * Two defences, and they must agree:
 *   - Newey-West at lag H, which is the textbook correction for exactly this.
 *   - A 30-day block bootstrap, which assumes almost nothing and resamples
 *     whole calendar blocks so the overlap travels with them.
 *
 * ─── Pre-registration ────────────────────────────────────────────────────
 * The bar is |t| > 3.0, following Harvey/Liu/Zhu on factor discovery, because
 * many features are tested at once. The feature count, the horizon count and
 * the bar are printed BEFORE any result, as every pre-registration here has
 * been. The expected number of false passes at that bar is printed with them.
 */
import * as fs from 'fs';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const OUT = str('out', 'test/manual/results/phase-b.csv');
const BAR = num('bar', 3.0);
const MIN_COINS = num('min-coins', 8);
const BLOCK_DAYS = num('block-days', 30);
const DRAWS = num('draws', 2000);
const SEED = num('seed', 12345);
/** Above this, a feature's cross-sectional ordering is a coin label, not a signal. */
const MAX_PERSIST = num('max-persist', 0.5);
const PERSIST_LAG_HOURS = num('persist-lag', 30 * 24);
/**
 * Negative control. Permutes which coin got which forward return, WITHIN each
 * hour, so the market-wide move and every feature's own distribution survive
 * untouched and only the pairing is destroyed. Nothing should clear the bar.
 * A pass here is a bug in this file, not a discovery in the data.
 */
const SHUFFLE = args.includes('--shuffle');

const HORIZONS = [4, 12, 24, 72];

/**
 * How much a feature's cross-sectional ordering survives 30 days.
 *
 * This is the trap that nearly produced this project's first false discovery.
 * Raw `openInterest` scored the largest t-stat in the run — and its ranking of
 * the ten coins is 0.99 correlated with itself a month later. It is not timing
 * anything. It says BTC and ETH always sit at the top, and over this particular
 * sample the top of that ordering underperformed. That is ONE bet on ONE
 * 3.6-year period, with an effective n near 1, dressed as 32,000 observations.
 *
 * A feature whose ranking never changes cannot predict a change. The gate is
 * not a p-hacking filter — it separates "this feature times the market" from
 * "these coins beat those coins", which the cross-sectional IC cannot tell
 * apart on its own.
 */
export function rankPersistence(panel: Panel, feature: string, lagHours: number): number {
  const nC = panel.coins.length;
  const f = panel.data.get(feature)!;
  const step = Math.max(1, Math.floor(lagHours / 3)); // sampled, not every hour
  const rs: number[] = [];
  for (let ti = 0; ti + lagHours < panel.times.length; ti += step) {
    const a: number[] = [];
    const b: number[] = [];
    for (let ci = 0; ci < nC; ci += 1) {
      const x = f[ti * nC + ci];
      const y = f[(ti + lagHours) * nC + ci];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        a.push(x);
        b.push(y);
      }
    }
    if (a.length < MIN_COINS) continue;
    const r = spearman(a, b);
    if (Number.isFinite(r)) rs.push(r);
  }
  return rs.length === 0 ? NaN : mean(rs);
}

/** Columns that are never features: keys, the price, staleness, and the targets. */
const NOT_A_FEATURE = (c: string): boolean =>
  c === 'coin' || c === 'ts' || c === 'close' || c.endsWith('_ageMin') || /^fwd\d+h$/.test(c);

// ── statistics ───────────────────────────────────────────────────────────

/** Ranks with ties averaged, which is what makes this Spearman and not a hack. */
export function rank(xs: number[]): number[] {
  const order = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rho. NaN when either side is constant — a flat column ranks all-ties
 *  and its correlation is undefined, not zero. */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 3) return NaN;
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i] - ma;
    const y = rb[i] - ma;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}

export const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Newey-West standard error of the mean, with `lag` Bartlett-weighted
 * autocovariances. At lag 0 this is the ordinary `sd / sqrt(n)`.
 */
export function neweyWestSe(xs: number[], lag: number): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  const d = xs.map((x) => x - m);
  let s = d.reduce((acc, x) => acc + x * x, 0) / n;
  for (let l = 1; l <= Math.min(lag, n - 1); l += 1) {
    let cov = 0;
    for (let i = l; i < n; i += 1) cov += d[i] * d[i - l];
    cov /= n;
    s += 2 * (1 - l / (lag + 1)) * cov;
  }
  // A Bartlett kernel keeps this non-negative in theory; floating point at
  // n=32,000 does not always agree, and a negative variance must not become NaN
  // silently under a sqrt.
  return s <= 0 ? NaN : Math.sqrt(s / n);
}

const quantile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/**
 * Block bootstrap of a mean over calendar time.
 *
 * Resampling whole blocks keeps the overlap between neighbouring observations
 * inside the block, which is the whole reason it is used here rather than a
 * plain bootstrap over rows.
 */
export function blockBootstrapMean(
  rows: Array<{ time: number; value: number }>,
  blockDays: number,
  draws: number,
  seed: number,
): { lo: number; hi: number; blocks: number } {
  if (rows.length === 0) return { lo: NaN, hi: NaN, blocks: 0 };
  const rng = makeRng(seed);
  const t0 = Math.min(...rows.map((r) => r.time));
  const ms = blockDays * 86_400_000;
  const byBlock = new Map<number, number[]>();
  for (const r of rows) {
    const k = Math.floor((r.time - t0) / ms);
    const cell = byBlock.get(k);
    if (cell) cell.push(r.value);
    else byBlock.set(k, [r.value]);
  }
  const blocks = [...byBlock.values()];
  const out: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      for (const v of blocks[Math.floor(rng() * blocks.length)]) {
        sum += v;
        n += 1;
      }
    }
    if (n > 0) out.push(sum / n);
  }
  out.sort((a, b) => a - b);
  return { lo: quantile(out, 0.025), hi: quantile(out, 0.975), blocks: blocks.length };
}

// ── the panel ────────────────────────────────────────────────────────────

export interface Panel {
  columns: string[];
  coins: string[];
  times: number[];
  /** column -> Float64Array of length times.length * coins.length, NaN for blank. */
  data: Map<string, Float64Array>;
}

function load(file: string): Panel {
  const text = fs.readFileSync(file, 'utf8');
  const nl = text.indexOf('\n');
  const columns = text.slice(0, nl).trim().split(',');
  const iCoin = columns.indexOf('coin');
  const iTs = columns.indexOf('ts');

  // Two passes. The first learns the axes, the second fills — which costs a
  // second scan and saves holding 320,000 row objects.
  const coinSet = new Set<string>();
  const timeSet = new Set<number>();
  let pos = nl + 1;
  const scan = (fn: (cells: string[]) => void): void => {
    let p = pos;
    while (p < text.length) {
      let e = text.indexOf('\n', p);
      if (e < 0) e = text.length;
      if (e > p) fn(text.slice(p, e).split(','));
      p = e + 1;
    }
  };
  scan((c) => {
    coinSet.add(c[iCoin]);
    timeSet.add(Date.parse(c[iTs]));
  });
  const coins = [...coinSet].sort();
  const times = [...timeSet].sort((a, b) => a - b);
  const coinIdx = new Map(coins.map((c, i) => [c, i]));
  const timeIdx = new Map(times.map((t, i) => [t, i]));

  const data = new Map<string, Float64Array>();
  const wanted = columns.filter((c) => c !== 'coin' && c !== 'ts');
  for (const c of wanted) data.set(c, new Float64Array(times.length * coins.length).fill(NaN));
  const colIdx = wanted.map((c) => columns.indexOf(c));

  scan((cells) => {
    const ci = coinIdx.get(cells[iCoin])!;
    const ti = timeIdx.get(Date.parse(cells[iTs]))!;
    const at = ti * coins.length + ci;
    for (let k = 0; k < wanted.length; k += 1) {
      const raw = cells[colIdx[k]];
      if (raw !== '') data.get(wanted[k])![at] = Number(raw);
    }
  });

  return { columns, coins, times, data };
}

/** Reassign the targets among the coins present at each hour. See SHUFFLE. */
function shuffleTargets(panel: Panel, seed: number): void {
  const rng = makeRng(seed);
  const nC = panel.coins.length;
  for (const h of HORIZONS) {
    const y = panel.data.get(`fwd${h}h`)!;
    for (let ti = 0; ti < panel.times.length; ti += 1) {
      const at = ti * nC;
      // Fisher-Yates over the whole row. A blank stays blank and simply travels
      // to another coin, which keeps each hour's count of usable coins intact.
      for (let i = nC - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = y[at + i];
        y[at + i] = y[at + j];
        y[at + j] = tmp;
      }
    }
  }
}

// ── the measurement ──────────────────────────────────────────────────────

interface Result {
  feature: string;
  horizon: number;
  n: number;
  firstTs: number;
  ic: number;
  se: number;
  t: number;
  lo: number;
  hi: number;
  blocks: number;
  tsIc: number;
  persist: number;
}

function measure(panel: Panel, feature: string, horizon: number, persist: number): Result {
  const nC = panel.coins.length;
  const f = panel.data.get(feature)!;
  const y = panel.data.get(`fwd${horizon}h`)!;

  const series: Array<{ time: number; value: number }> = [];
  for (let ti = 0; ti < panel.times.length; ti += 1) {
    const a: number[] = [];
    const b: number[] = [];
    for (let ci = 0; ci < nC; ci += 1) {
      const at = ti * nC + ci;
      const fv = f[at];
      const yv = y[at];
      // A coin missing either side at this hour is out of THIS hour's ranking
      // and no other. Dropping the whole hour, or the whole feature, is how a
      // 7-month column silently redefines a 3.6-year study.
      if (Number.isFinite(fv) && Number.isFinite(yv)) {
        a.push(fv);
        b.push(yv);
      }
    }
    if (a.length < MIN_COINS) continue;
    const rho = spearman(a, b);
    if (Number.isFinite(rho)) series.push({ time: panel.times[ti], value: rho });
  }

  if (series.length < 30) {
    return {
      feature, horizon, n: series.length, firstTs: NaN,
      ic: NaN, se: NaN, t: NaN, lo: NaN, hi: NaN, blocks: 0, tsIc: NaN, persist,
    };
  }

  const ics = series.map((r) => r.value);
  const ic = mean(ics);
  // Lag = the horizon: two IC readings more than H hours apart share no part of
  // the same forward return.
  const se = neweyWestSe(ics, horizon);
  const boot = blockBootstrapMean(series, BLOCK_DAYS, DRAWS, SEED);

  // Time-series IC: one Spearman per coin over its own history, then averaged.
  // Diagnostic only. It carries the market move, and the ten coins carry the
  // same one, so no t-stat is computed from it.
  const perCoin: number[] = [];
  for (let ci = 0; ci < nC; ci += 1) {
    const a: number[] = [];
    const b: number[] = [];
    for (let ti = 0; ti < panel.times.length; ti += 1) {
      const at = ti * nC + ci;
      if (Number.isFinite(f[at]) && Number.isFinite(y[at])) {
        a.push(f[at]);
        b.push(y[at]);
      }
    }
    const rho = spearman(a, b);
    if (Number.isFinite(rho)) perCoin.push(rho);
  }

  return {
    feature,
    horizon,
    n: series.length,
    firstTs: series[0].time,
    ic,
    se,
    t: ic / se,
    lo: boot.lo,
    hi: boot.hi,
    blocks: boot.blocks,
    tsIc: perCoin.length === 0 ? NaN : mean(perCoin),
    persist,
  };
}

function main(): void {
  const t0 = Date.now();
  const panel = load(IN);
  if (SHUFFLE) shuffleTargets(panel, SEED);
  const features = panel.columns.filter((c) => !NOT_A_FEATURE(c));
  const tests = features.length * HORIZONS.length;
  // Two-sided normal tail at the bar, times the number of tests.
  const tail = 2 * (1 - normalCdf(BAR));

  console.log(`\nPHASE B — cross-sectional information coefficient${SHUFFLE ? '  [SHUFFLED CONTROL]' : ''}`);
  console.log(`panel      ${IN}`);
  console.log(`            ${panel.times.length.toLocaleString()} hours x ${panel.coins.length} coins`);
  console.log(`            ${new Date(panel.times[0]).toISOString().slice(0, 10)} -> ${new Date(panel.times[panel.times.length - 1]).toISOString().slice(0, 10)}`);
  console.log(`\n── pre-registered, before any result ──`);
  console.log(`features   ${features.length}`);
  console.log(`horizons   ${HORIZONS.join('h, ')}h`);
  console.log(`tests      ${tests}`);
  console.log(`bar        |t| > ${BAR.toFixed(1)}  (Harvey/Liu/Zhu)`);
  console.log(`expected false passes at that bar: ${(tests * tail).toFixed(2)}`);
  console.log(`t-stat     Newey-West, lag = horizon`);
  console.log(`interval   ${BLOCK_DAYS}-day block bootstrap, ${DRAWS} draws, seed ${SEED}`);
  console.log(`persistence gate: 30-day rank persistence must be under ${MAX_PERSIST.toFixed(2)}\n`);

  const results: Result[] = [];
  for (const feature of features) {
    // Horizon-independent, so computed once and shared across the four.
    const persist = rankPersistence(panel, feature, PERSIST_LAG_HOURS);
    for (const h of HORIZONS) results.push(measure(panel, feature, h, persist));
  }

  fs.writeFileSync(
    OUT,
    ['feature,horizon,n,firstTs,ic,se,t,bootLo,bootHi,blocks,tsIc,rankPersist']
      .concat(
        results.map((r) =>
          [
            r.feature, r.horizon, r.n,
            Number.isFinite(r.firstTs) ? new Date(r.firstTs).toISOString() : '',
            r.ic, r.se, r.t, r.lo, r.hi, r.blocks, r.tsIc, r.persist,
          ].join(','),
        ),
      )
      .join('\n') + '\n',
  );

  const bootAgrees = (r: Result): boolean => (r.lo > 0 && r.hi > 0) || (r.lo < 0 && r.hi < 0);
  const timesTheMarket = (r: Result): boolean =>
    Number.isFinite(r.persist) && Math.abs(r.persist) < MAX_PERSIST;

  const byT = (a: Result, b: Result): number => Math.abs(b.t) - Math.abs(a.t);
  const overBar = results.filter((r) => Math.abs(r.t) > BAR).sort(byT);
  const passed = overBar.filter((r) => bootAgrees(r) && timesTheMarket(r));
  const static_ = overBar.filter((r) => !timesTheMarket(r));

  const row = (r: Result): string =>
    `  ${r.feature.padEnd(30)} ${String(r.horizon).padStart(3)}h  ` +
    `IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}  t ${r.t.toFixed(2).padStart(7)}  ` +
    `boot [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  persist ${r.persist.toFixed(2).padStart(5)}  ` +
    `n ${r.n.toLocaleString().padStart(7)}` +
    `${bootAgrees(r) ? '' : '  BOOTSTRAP DISAGREES'}`;

  console.log(`── passes: |t| > ${BAR.toFixed(1)}, bootstrap agrees, ranking actually moves ──`);
  if (passed.length === 0) console.log('  none');
  else passed.forEach((r) => console.log(row(r)));

  console.log(
    `\n── over the bar but REJECTED: the ranking barely moves, so this is a fixed ` +
      `bet on which coins, not a forecast ──`,
  );
  if (static_.length === 0) console.log('  none');
  else static_.forEach((r) => console.log(row(r)));

  console.log(`\n── largest |t| among the features that pass the persistence gate ──`);
  [...results]
    .filter((r) => Number.isFinite(r.t) && timesTheMarket(r))
    .sort(byT)
    .slice(0, 10)
    .forEach((r) => console.log(row(r)));

  console.log(
    `\n${results.length} tests. ${overBar.length} over the bar, of which ${static_.length} are ` +
      `static tilts and ${passed.length} survive. ${(tests * tail).toFixed(2)} expected by chance.`,
  );
  console.log(`written ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/** Abramowitz & Stegun 26.2.17, accurate to ~7 decimals — enough for a tail count. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

if (require.main === module) main();
