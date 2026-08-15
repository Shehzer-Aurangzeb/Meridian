/**
 * Winners vs losers — what separates them AT ENTRY, and does it survive?
 *
 *   npx ts-node test/manual/separate.ts --self-check
 *   npx ts-node test/manual/separate.ts test/manual/results/y3.csv
 *
 * Bottom-up counterpart to the top-down "does high confluence predict
 * success" question. Split closed trades by netR, then ask which recorded
 * entry-time feature actually differs between the two groups.
 *
 * READ-ONLY. No gate, no rule, no filter is produced by this file.
 *
 * ─── The honesty guard, which is the whole point ─────────────────────────
 * With ~15 features, something ALWAYS separates by chance: at p<0.05 you
 * expect roughly one spurious hit per twenty comparisons, and ranking by
 * separation guarantees the top of the list is the luckiest feature, not
 * the most informative one.
 *
 * So the ranking is computed on TUNE alone, and the top features are then
 * measured ON HOLDOUT WITHOUT RE-RANKING. A feature that separates on TUNE
 * and not on HOLDOUT is noise, and saying so is the useful outcome.
 *
 * The holdout is READ here but never selected on — nothing in this file
 * chooses a feature, threshold or direction using a holdout number.
 */
import * as fs from 'fs';
import { blockBootstrap } from './holdout';
import { blockSpread } from './baserate';

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const TUNE_FRACTION = num('tune', 0.7);
const BLOCK_DAYS = num('block-days', 14);
const B = num('b', 2000);
const SEED = num('seed', 12345);
/** TIMEOUTs are marked to market, not closed. 2.8% of y3. Excluded by default. */
const KEEP_TIMEOUT = args.includes('--keep-timeout');

// ── data ────────────────────────────────────────────────────────────────

export interface Trade {
  time: number;
  netR: number;
  win: boolean;
  status: string;
  cells: Record<string, string>;
}

/**
 * ponytail: a fourth local CSV reader. Extract a shared one when a fifth
 * appears — three call sites is not yet a library.
 */
export function load(path: string): Trade[] {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  return lines
    .slice(head + 1)
    .map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter((r) => r.tier === 'PLAN')
    .filter((r) => KEEP_TIMEOUT || r.status !== 'TIMEOUT')
    .map((r) => ({
      time: new Date(r.time).getTime(),
      netR: Number(r.netR),
      // The split the experiment is defined on. Ties (exactly 0R) are losses,
      // because a trade that returns nothing still paid the toll to do it.
      win: Number(r.netR) > 0,
      status: r.status,
      cells: r,
    }));
}

// ── separation statistics ───────────────────────────────────────────────

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * Cohen's d with the POOLED standard deviation.
 *
 * Pooled rather than either group's own, because the two groups are
 * different sizes and using one group's spread would let the smaller group
 * set the scale. Sign convention: positive means winners scored higher.
 */
export function cohensD(winners: number[], losers: number[]): number {
  const [n1, n2] = [winners.length, losers.length];
  if (n1 < 2 || n2 < 2) return 0;
  const [s1, s2] = [sd(winners), sd(losers)];
  const pooled = Math.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2));
  return pooled === 0 ? 0 : (mean(winners) - mean(losers)) / pooled;
}

/**
 * Separation for a categorical: the spread of win rate across its buckets.
 *
 * Buckets under `minN` are excluded, not merged — a 3-trade bucket at 100%
 * would otherwise define the range and read as perfect separation.
 */
export function categoricalSpread(
  values: string[],
  wins: boolean[],
  minN = 30,
): { spread: number; buckets: Array<{ value: string; n: number; winRate: number }> } {
  const by = new Map<string, { n: number; w: number }>();
  values.forEach((v, i) => {
    const e = by.get(v) ?? { n: 0, w: 0 };
    e.n += 1;
    if (wins[i]) e.w += 1;
    by.set(v, e);
  });
  const buckets = [...by.entries()]
    .filter(([, e]) => e.n >= minN)
    .map(([value, e]) => ({ value, n: e.n, winRate: e.w / e.n }))
    .sort((a, b) => b.winRate - a.winRate);
  const rates = buckets.map((b) => b.winRate);
  return { spread: rates.length < 2 ? 0 : Math.max(...rates) - Math.min(...rates), buckets };
}

/** Win rate, as a plain fraction. */
export const winRate = (ts: Trade[]): number =>
  ts.length === 0 ? NaN : ts.filter((t) => t.win).length / ts.length;

// ── the feature set actually recorded in y3.csv ─────────────────────────
//
// The five `c*` booleans are the checklist's verdicts and exist only on the
// ~81% of trades routed to CONFLUENCE_CHECKLIST. The `*Value` columns are the
// NUMBERS those verdicts were derived from, added so a "backwards" condition
// can be told apart from a badly placed threshold — and they are populated on
// every trade, squeeze route included.

/** One parsing rule for every numeric cell: blank and non-numeric both mean null. */
const cell =
  (key: string) =>
  (t: Trade): number | null => {
    const v = Number(t.cells[key]);
    return t.cells[key] === '' || !Number.isFinite(v) ? null : v;
  };

/**
 * Trend agreement, signed by the trade's OWN direction.
 *
 * +DI minus -DI for a long, the reverse for a short. Positive means the
 * directional index agrees with the trade; negative means the trade is
 * fighting it. Signing by direction is the whole point — an unsigned DI
 * spread averages a long fighting a downtrend against a short riding one and
 * calls them the same bar.
 *
 * Derived from recorded columns only. No market data is re-read.
 */
export function diSpread(t: Trade): number | null {
  // Via `cell`, not Number() directly: Number('') is 0, so a missing DI would
  // read as a perfectly balanced trend and land in the middle bin rather than
  // being dropped. One parsing rule, one place.
  const p = cell('pdiValue')(t);
  const m = cell('mdiValue')(t);
  return p === null || m === null ? null : t.cells.direction === 'long' ? p - m : m - p;
}

interface NumFeature {
  key: string;
  label: string;
  get: (t: Trade) => number | null;
}

const NUMERIC: NumFeature[] = [
  { key: 'sources', label: 'confluence sources', get: cell('sources') },
  { key: 'conditionsMet', label: 'checklist conditions met (0-5)', get: cell('conditionsMet') },
  { key: 'riskPercent', label: 'stop distance (% of entry)', get: cell('riskPercent') },
  { key: 'plannedR', label: 'planned blended R', get: cell('plannedR') },
  { key: 'barsToFill', label: 'bars from plan to fill', get: cell('barsToFill') },
  // ── the raw indicator readings, new in this CSV ──
  { key: 'rsiValue', label: 'RSI (raw)', get: cell('rsiValue') },
  { key: 'adxValue', label: 'ADX (raw)', get: cell('adxValue') },
  { key: 'pdiValue', label: '+DI (raw)', get: cell('pdiValue') },
  { key: 'mdiValue', label: '-DI (raw)', get: cell('mdiValue') },
  { key: 'percentBValue', label: '%B (raw)', get: cell('percentBValue') },
  { key: 'qqeValue', label: 'QQE smoothed RSI (raw)', get: cell('qqeValue') },
  { key: 'diSpread', label: 'trend agreement (direction-signed DI)', get: diSpread },
  // ── extremity: distance from a NEUTRAL point, not from the sample ──
  // A median split cannot test an inverted-U — both halves get some of the
  // good middle and one bad tail, so the test reads as noise no matter how
  // strong the shape is. Folding the U about its neutral point turns it into
  // a monotonic quantity a median split CAN test. The neutral points are
  // definitional constants (RSI/QQE 50, %B 0.5), never sample statistics.
  {
    key: 'rsiExtremity',
    label: '|RSI - 50| (distance from neutral)',
    get: (t) => { const v = cell('rsiValue')(t); return v === null ? null : Math.abs(v - 50); },
  },
  {
    key: 'qqeExtremity',
    label: '|QQE - 50| (distance from neutral)',
    get: (t) => { const v = cell('qqeValue')(t); return v === null ? null : Math.abs(v - 50); },
  },
  {
    key: 'pbExtremity',
    label: '|%B - 0.5| (distance from mid-band)',
    get: (t) => { const v = cell('percentBValue')(t); return v === null ? null : Math.abs(v - 0.5); },
  },
];

/**
 * Bin edges are FIXED CONSTANTS, never sample deciles.
 *
 * Same discipline as the base-rate study's Leak 3: deciles computed over the
 * sample let the sample's own distribution set the boundaries, so a bin edge
 * carries information about every row including the ones after it. Fixed
 * edges are immune, and they are readable — "RSI 30-40" beats "decile 3".
 */
const EDGES: Record<string, number[]> = {
  rsiValue: [0, 20, 30, 40, 50, 60, 70, 80, 100],
  qqeValue: [0, 20, 30, 40, 50, 60, 70, 80, 100],
  adxValue: [0, 15, 20, 25, 30, 40, 100],
  pdiValue: [0, 10, 20, 30, 40, 100],
  mdiValue: [0, 10, 20, 30, 40, 100],
  percentBValue: [-1, 0, 0.2, 0.4, 0.6, 0.8, 1, 2],
  diSpread: [-100, -30, -20, -10, 0, 10, 20, 30, 100],
};

export function binOf(v: number, edges: number[]): string | null {
  for (let i = 0; i < edges.length - 1; i += 1) {
    // Last bin is closed on the right so the maximum value is not dropped.
    const last = i === edges.length - 2;
    if (v >= edges[i] && (last ? v <= edges[i + 1] : v < edges[i + 1])) {
      return `${edges[i]} to ${edges[i + 1]}`;
    }
  }
  return null;
}

/** Win rate and mean netR per fixed bin, in ascending bin order. */
function binTable(
  rows: Trade[],
  get: (t: Trade) => number | null,
  edges: number[],
): Array<{ bin: string; n: number; winRate: number; netR: number }> {
  const by = new Map<string, Trade[]>();
  for (const t of rows) {
    const v = get(t);
    if (v === null) continue;
    const b = binOf(v, edges);
    if (b === null) continue;
    by.set(b, [...(by.get(b) ?? []), t]);
  }
  return edges
    .slice(0, -1)
    .map((e, i) => `${e} to ${edges[i + 1]}`)
    .filter((b) => by.has(b))
    .map((bin) => {
      const ts = by.get(bin)!;
      return { bin, n: ts.length, winRate: winRate(ts), netR: mean(ts.map((t) => t.netR)) };
    });
}

/** Monotonic / U-shaped / flat, from the sign changes in consecutive bins. */
function shapeOf(rates: number[]): string {
  if (rates.length < 3) return 'too few bins';
  const d = rates.slice(1).map((r, i) => r - rates[i]);
  const ups = d.filter((x) => x > 0.01).length;
  const downs = d.filter((x) => x < -0.01).length;
  const range = Math.max(...rates) - Math.min(...rates);
  if (range < 0.06) return 'flat';
  if (downs === 0) return 'monotonic up';
  if (ups === 0) return 'monotonic down';
  const peak = rates.indexOf(Math.max(...rates));
  const trough = rates.indexOf(Math.min(...rates));
  if (peak > 0 && peak < rates.length - 1) return 'inverted-U (peak in middle)';
  if (trough > 0 && trough < rates.length - 1) return 'U-shaped (trough in middle)';
  return 'mixed';
}

const CATEGORICAL: Array<{ key: string; label: string }> = [
  { key: 'regime', label: 'regime' },
  { key: 'structure', label: 'market structure' },
  { key: 'route', label: 'strategy route' },
  { key: 'direction', label: 'direction' },
  { key: 'coin', label: 'coin' },
  { key: 'cRsi', label: 'RSI condition passed' },
  { key: 'cQqe', label: 'QQE condition passed' },
  { key: 'cBollinger', label: 'Bollinger condition passed' },
  { key: 'cStructure', label: 'structure condition passed' },
  { key: 'cSupportResistance', label: 'S/R condition passed' },
];

const numbersFor = (ts: Trade[], get: (t: Trade) => number | null): { w: number[]; l: number[] } => {
  const ok = ts.filter((t) => get(t) !== null);
  return {
    w: ok.filter((t) => t.win).map((t) => get(t)!),
    l: ok.filter((t) => !t.win).map((t) => get(t)!),
  };
};

/** Non-empty only: a blank checklist cell is "not scored", never "failed". */
const populated = (ts: Trade[], key: string): Trade[] => ts.filter((t) => t.cells[key] !== '');

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  assert(median([3, 1, 2]) === 2, 'odd-length median is the middle');
  assert(median([4, 1, 2, 3]) === 2.5, 'even-length median averages the pair');

  // Cohen's d: two groups one pooled SD apart must read 1.0.
  const a = [2, 3, 4];
  const b = [1, 2, 3];
  assert(Math.abs(cohensD(a, b) - 1) < 1e-9, 'a one-SD shift reads d = 1');
  assert(cohensD(a, a) === 0, 'identical groups do not separate');
  assert(cohensD(b, a) === -1, 'the sign follows which group scored higher');
  assert(cohensD([5, 5, 5], [5, 5, 5]) === 0, 'zero variance cannot divide by zero');

  // Categorical spread: the range of win rates, tiny buckets excluded.
  const vals = [...Array(40).fill('up'), ...Array(40).fill('down')];
  const wins = [...Array(40).fill(true), ...Array(40).fill(false)];
  const c = categoricalSpread(vals, wins, 30);
  assert(Math.abs(c.spread - 1) < 1e-9, '100% vs 0% is a spread of 1');
  assert(c.buckets.length === 2 && c.buckets[0].value === 'up', 'buckets sort by win rate');
  // A 3-trade perfect bucket must NOT define the range.
  const withTiny = categoricalSpread(
    [...vals, 'rare', 'rare', 'rare'],
    [...wins, true, true, true],
    30,
  );
  assert(withTiny.buckets.length === 2, 'a bucket under minN is dropped, not merged');

  // Ties are losses: a 0R trade paid the toll and returned nothing.
  const t = (netR: number): Trade =>
    ({ time: 0, netR, win: netR > 0, status: 'STOPPED', cells: {} }) as Trade;
  assert(!t(0).win && t(0.001).win && !t(-1).win, 'exactly 0R is not a win');
  assert(winRate([t(1), t(-1), t(1), t(0)]) === 0.5, 'win rate counts strict positives');

  // Fixed bins: half-open except the last, which must keep the maximum.
  const e = [0, 10, 20, 30];
  assert(binOf(0, e) === '0 to 10', 'the lower edge belongs to its own bin');
  assert(binOf(10, e) === '10 to 20', 'an interior edge opens the next bin');
  assert(binOf(30, e) === '20 to 30', 'the top edge stays in the last bin, not dropped');
  assert(binOf(-1, e) === null && binOf(31, e) === null, 'outside the range is null, not clamped');

  // Trend agreement must be signed by the trade's own direction: the same
  // DI pair reads +20 for a long and -20 for a short.
  const dt = (direction: string, pdi: string, mdi: string): Trade =>
    ({ time: 0, netR: 0, win: false, status: '', cells: { direction, pdiValue: pdi, mdiValue: mdi } }) as Trade;
  assert(diSpread(dt('long', '30', '10')) === 20, 'a long with +DI above -DI agrees with the trend');
  assert(diSpread(dt('short', '30', '10')) === -20, 'the same bar is disagreement for a short');
  assert(diSpread(dt('short', '10', '30')) === 20, 'a short into a downtrend agrees');
  assert(diSpread(dt('long', '', '')) === null, 'missing DI values yield null, never 0');

  // Shape detection: the labels drive the report's headline for each feature.
  assert(shapeOf([0.1, 0.3, 0.5, 0.7]) === 'monotonic up', 'a rising series reads as rising');
  assert(shapeOf([0.7, 0.5, 0.3, 0.1]) === 'monotonic down', 'and a falling one as falling');
  assert(shapeOf([0.5, 0.51, 0.49, 0.5]) === 'flat', 'noise under 6pp of range is flat');
  assert(shapeOf([0.2, 0.6, 0.7, 0.2]) === 'inverted-U (peak in middle)', 'a middle peak is an inverted U');

  console.log(
    'self-check passed (median, Cohen d, categorical spread, tie handling, '
      + 'fixed bins, direction-signed DI, shape labels)',
  );
}

if (require.main === module && args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── the ceiling: what is left after skipping every extreme entry ────────
//
// Thresholds are the TUNE medians already reported, and the signed-DI cut is
// the one read off the TUNE bins. None is re-fitted here.
//
// WHAT THIS NUMBER IS NOT: an out-of-sample result. The thresholds came from
// TUNE, but the DECISION TO COMBINE THESE FIVE came from watching which ones
// survived the holdout. That is selection on the holdout, so the figure below
// is an optimistic upper bound — a ceiling, which is what was asked for — and
// not an estimate of what the filter would earn on data nobody has seen.
const KEEP: Array<{ label: string; ok: (t: Trade) => boolean }> = [
  { label: '|RSI-50| <= 6.902', ok: (t) => { const v = cell('rsiValue')(t); return v !== null && Math.abs(v - 50) <= 6.902; } },
  { label: '|%B-0.5| <= 0.241', ok: (t) => { const v = cell('percentBValue')(t); return v !== null && Math.abs(v - 0.5) <= 0.241; } },
  { label: '|QQE-50| <= 6.432', ok: (t) => { const v = cell('qqeValue')(t); return v !== null && Math.abs(v - 50) <= 6.432; } },
  { label: 'ADX <= 22.546', ok: (t) => { const v = cell('adxValue')(t); return v !== null && v <= 22.546; } },
  { label: 'signed DI <= +10', ok: (t) => { const v = diSpread(t); return v !== null && v <= 10; } },
];

function ceiling(): void {
  const path = args.find((a) => a.endsWith('.csv'));
  if (!path) throw new Error('pass the plan-backtest CSV as the first argument');
  const all = load(path).sort((a, b) => a.time - b.time);
  const t0 = all[0].time;
  const cut = t0 + (all[all.length - 1].time - t0) * TUNE_FRACTION;
  const holdout = all.filter((t) => t.time >= cut);

  const row = (label: string, ts: Trade[], base: number) => {
    const ci = blockBootstrap(
      ts.map((t) => ({ time: t.time, value: t.netR })),
      BLOCK_DAYS,
      B,
      SEED,
    );
    const m = mean(ts.map((t) => t.netR));
    return {
      filter: label,
      n: ts.length,
      kept: `${((ts.length / holdout.length) * 100).toFixed(0)}%`,
      'win%': `${(winRate(ts) * 100).toFixed(1)}%`,
      'mean netR': m.toFixed(3),
      '95% CI': `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
      blocks: ci.blocks,
      'vs unfiltered': base === 0 ? '—' : `${m - base >= 0 ? '+' : ''}${(m - base).toFixed(3)}R`,
      'crosses 0?': ci.hi > 0 ? 'yes' : 'NO — still losing',
    };
  };

  console.log(`\nEXTREMITY FILTER — CEILING TEST (HOLDOUT ONLY)`);
  console.log(`source   ${path}`);
  console.log(`holdout  ${new Date(cut).toISOString().slice(0, 10)} → ` +
    `${new Date(all[all.length - 1].time).toISOString().slice(0, 10)}  ${holdout.length} closed trades\n`);

  const base = mean(holdout.map((t) => t.netR));

  console.log('each filter on its own');
  console.table(KEEP.map((f) => row(f.label, holdout.filter(f.ok), base)));

  console.log('\ncumulative — filters stacked in the order above');
  const cum: Array<Record<string, string | number>> = [row('(unfiltered)', holdout, 0)];
  let live = holdout;
  for (let i = 0; i < KEEP.length; i += 1) {
    live = live.filter(KEEP[i].ok);
    cum.push(row(`+ ${KEEP[i].label}`, live, base));
  }
  console.table(cum);

  // Total R matters as well as the mean: a filter that halves the loss per
  // trade while removing 90% of them is a different proposition from one that
  // keeps most of the book.
  console.log(
    `\ntotal netR — unfiltered ${holdout.reduce((s, t) => s + t.netR, 0).toFixed(1)}R over ${holdout.length} trades` +
      ` · calm-only ${live.reduce((s, t) => s + t.netR, 0).toFixed(1)}R over ${live.length} trades`,
  );
  console.log(
    `cost toll is ~0.068R/trade, so the calm-only gross is about ` +
      `${(mean(live.map((t) => t.netR)) + 0.068).toFixed(3)}R before costs.`,
  );
}

if (require.main === module && args.includes('--ceiling')) {
  ceiling();
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────

function report(): void {
  const path = args.find((a) => a.endsWith('.csv'));
  if (!path) throw new Error('pass the plan-backtest CSV as the first argument');

  const all = load(path).sort((a, b) => a.time - b.time);
  const t0 = all[0].time;
  const t1 = all[all.length - 1].time;
  const cut = t0 + (t1 - t0) * TUNE_FRACTION;
  const tune = all.filter((t) => t.time < cut);
  const holdout = all.filter((t) => t.time >= cut);
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nWINNERS vs LOSERS — what separates them at entry`);
  console.log(`source   ${path}`);
  console.log(
    `trades   ${all.length} closed (TIMEOUT ${KEEP_TIMEOUT ? 'kept' : 'excluded'}) · ` +
      `${(winRate(all) * 100).toFixed(1)}% win · mean netR ${mean(all.map((t) => t.netR)).toFixed(3)}`,
  );
  console.log(
    `TUNE     ${day(t0)} → ${day(cut)}  ${tune.length} trades · ${(winRate(tune) * 100).toFixed(1)}% win`,
  );
  console.log(
    `HOLDOUT  ${day(cut)} → ${day(t1)}  ${holdout.length} trades · ${(winRate(holdout) * 100).toFixed(1)}% win`,
  );

  // ── numeric features, TUNE ──
  console.log('\nNUMERIC FEATURES — winner vs loser distribution (TUNE only)');
  const numericRanked = NUMERIC.map((f) => {
    const { w, l } = numbersFor(tune, f.get);
    return { f, w, l, d: cohensD(w, l) };
  }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  console.table(
    numericRanked.map(({ f, w, l, d }) => ({
      feature: f.label,
      n: w.length + l.length,
      'winner mean': w.length ? mean(w).toFixed(3) : '—',
      'loser mean': l.length ? mean(l).toFixed(3) : '—',
      'winner med': w.length ? median(w).toFixed(3) : '—',
      'loser med': l.length ? median(l).toFixed(3) : '—',
      "Cohen's d": d.toFixed(3),
      size: Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large',
    })),
  );

  // ── categorical features, TUNE ──
  console.log('\nCATEGORICAL FEATURES — win-rate spread across buckets (TUNE only)');
  const catRanked = CATEGORICAL.map((f) => {
    const rows = populated(tune, f.key);
    const c = categoricalSpread(
      rows.map((t) => t.cells[f.key]),
      rows.map((t) => t.win),
    );
    return { f, c, n: rows.length };
  }).sort((a, b) => b.c.spread - a.c.spread);

  console.table(
    catRanked.map(({ f, c, n }) => ({
      feature: f.label,
      n,
      buckets: c.buckets.length,
      best: c.buckets.length ? `${c.buckets[0].value} ${(c.buckets[0].winRate * 100).toFixed(1)}%` : '—',
      worst: c.buckets.length
        ? `${c.buckets[c.buckets.length - 1].value} ${(c.buckets[c.buckets.length - 1].winRate * 100).toFixed(1)}%`
        : '—',
      'win-rate spread': `${(c.spread * 100).toFixed(1)}pp`,
    })),
  );

  // ── the combined ranking ──
  // Cohen's d and a win-rate spread are different units. They are ranked
  // together anyway because the question is "which feature to look at next",
  // and the answer only has to be roughly ordered. Stated, not hidden.
  console.log('\nCOMBINED RANKING (TUNE) — |d| for numeric, pp spread for categorical');
  const combined = [
    ...numericRanked.map((x) => ({
      feature: x.f.label,
      kind: 'numeric',
      key: x.f.key,
      get: x.f.get as ((t: Trade) => number | null) | null,
      strength: Math.abs(x.d),
      readable: `d = ${x.d.toFixed(3)}`,
    })),
    ...catRanked.map((x) => ({
      feature: x.f.label,
      kind: 'categorical',
      key: x.f.key,
      get: null as ((t: Trade) => number | null) | null,
      strength: x.c.spread,
      readable: `${(x.c.spread * 100).toFixed(1)}pp`,
    })),
  ].sort((a, b) => b.strength - a.strength);
  console.table(
    combined.map((c, i) => ({
      rank: i + 1,
      feature: c.feature,
      kind: c.kind,
      key: c.key,
      strength: c.strength.toFixed(3),
      readable: c.readable,
    })),
  );

  // ── 1. shape across the actual value range, not one threshold ─────────
  console.log('\n═══ RAW FEATURE BINS (TUNE) — win rate and netR across the value range ═══');
  console.log('Fixed edges, never sample deciles: a decile edge is set by the sample it is measuring.\n');
  for (const f of NUMERIC.filter((x) => EDGES[x.key])) {
    const rows = binTable(tune, f.get, EDGES[f.key]);
    if (rows.length < 2) continue;
    console.log(`${f.label} — ${shapeOf(rows.map((r) => r.winRate))}`);
    console.table(
      rows.map((r) => ({
        bin: r.bin,
        n: r.n,
        'win%': `${(r.winRate * 100).toFixed(1)}%`,
        'mean netR': r.netR.toFixed(3),
      })),
    );
  }

  // ── 2. the interaction the sample row flagged ─────────────────────────
  console.log('\n═══ DIRECTION x TREND STRENGTH (TUNE) ═══');
  console.log(
    'Does going long into a strong -DI downtrend (or short into a strong +DI uptrend) reliably lose?\n',
  );
  for (const dir of ['long', 'short'] as const) {
    const side = tune.filter((t) => t.cells.direction === dir);
    console.log(`${dir.toUpperCase()} — by ADX (trend strength, unsigned)`);
    console.table(
      binTable(side, cell('adxValue'), EDGES.adxValue).map((r) => ({
        'ADX bin': r.bin,
        n: r.n,
        'win%': `${(r.winRate * 100).toFixed(1)}%`,
        'mean netR': r.netR.toFixed(3),
      })),
    );
    console.log(`${dir.toUpperCase()} — by trend agreement (negative = trading against the DI)`);
    console.table(
      binTable(side, diSpread, EDGES.diSpread).map((r) => ({
        'signed DI bin': r.bin,
        n: r.n,
        'win%': `${(r.winRate * 100).toFixed(1)}%`,
        'mean netR': r.netR.toFixed(3),
      })),
    );
  }

  // ── the honesty guard: top 3 re-measured on HOLDOUT, no re-ranking ──
  console.log('\n═══ EVERY FEATURE, RE-MEASURED ON HOLDOUT ═══');
  console.log('Buckets, thresholds and direction are FIXED FROM TUNE. Holdout is measured, never searched.');
  console.log(
    `${combined.length} features tested — at 95% confidence roughly ${(combined.length * 0.05).toFixed(1)} ` +
      `are expected to "survive" by chance alone. Treat a lone survivor accordingly.\n`,
  );

  const survivors: Array<{ label: string; split: (t: Trade) => 'high' | 'low' | null }> = [];
  const summary: Array<Record<string, string | number>> = [];

  for (const c of combined) {
    // For a numeric feature the "buckets" are a median split taken from TUNE.
    // The threshold must come from TUNE or the holdout has been fitted.
    let split: (t: Trade) => 'high' | 'low' | null;
    let describe: string;

    if (c.kind === 'numeric') {
      const get = c.get!;
      const { w, l } = numbersFor(tune, get);
      const thresh = median([...w, ...l]);
      describe = `${c.feature} — TUNE median split at ${thresh.toFixed(3)}`;
      split = (t) => {
        const v = get(t);
        return v === null ? null : v > thresh ? 'high' : 'low';
      };
    } else {
      const rows = populated(tune, c.key);
      const { buckets } = categoricalSpread(rows.map((t) => t.cells[c.key]), rows.map((t) => t.win));
      if (buckets.length < 2) continue;
      const best = buckets[0].value;
      const worst = buckets[buckets.length - 1].value;
      describe = `${c.feature} — TUNE best "${best}" vs worst "${worst}"`;
      split = (t) =>
        t.cells[c.key] === best ? 'high' : t.cells[c.key] === worst ? 'low' : null;
    }

    const gapOn = (set: Trade[]) => {
      const hi = set.filter((t) => split(t) === 'high');
      const lo = set.filter((t) => split(t) === 'low');
      const pts = (ts: Trade[]): Array<{ time: number; value: number }> =>
        ts.map((t) => ({ time: t.time, value: t.win ? 1 : 0 }));
      const s =
        hi.length && lo.length ? blockSpread(pts(hi), pts(lo), BLOCK_DAYS, B, SEED) : null;
      return {
        hiRate: winRate(hi),
        loRate: winRate(lo),
        gap: winRate(hi) - winRate(lo),
        nHi: hi.length,
        nLo: lo.length,
        // Numbers, not a formatted string. Parsing "[-1.2, 3.4]" back out to
        // decide whether it crosses zero is how a verdict line silently lies.
        ciLo: s ? s.lo : NaN,
        ciHi: s ? s.hi : NaN,
        blocks: s ? s.blocks : 0,
      };
    };

    const T = gapOn(tune);
    const H = gapOn(holdout);
    const fmtCi = (g: ReturnType<typeof gapOn>): string =>
      Number.isFinite(g.ciLo) ? `[${(g.ciLo * 100).toFixed(1)}, ${(g.ciHi * 100).toFixed(1)}]` : '—';

    const signHeld = Math.sign(T.gap) === Math.sign(H.gap);
    const clearsZero = Number.isFinite(H.ciLo) && (H.ciLo > 0 || H.ciHi < 0);

    const rNet = (set: Trade[], side: 'high' | 'low'): number =>
      mean(set.filter((t) => split(t) === side).map((t) => t.netR));

    summary.push({
      feature: c.feature,
      split: describe.replace(`${c.feature} — `, ''),
      'TUNE gap': `${(T.gap * 100).toFixed(1)}pp`,
      'HOLDOUT gap': `${(H.gap * 100).toFixed(1)}pp`,
      'HOLDOUT CI': fmtCi(H),
      sign: signHeld ? 'held' : 'FLIPPED',
      verdict: signHeld && clearsZero ? 'SURVIVES' : 'no',
      'HOLDOUT netR hi/lo': `${rNet(holdout, 'high').toFixed(3)} / ${rNet(holdout, 'low').toFixed(3)}`,
    });
    if (signHeld && clearsZero) survivors.push({ label: c.feature, split });
  }
  console.table(summary);

  // ── the costume check ─────────────────────────────────────────────────
  // A raw indicator can "separate" purely by co-occurring with the checklist
  // harm signal. Re-measure each survivor INSIDE each conditionsMet bucket:
  // if the gap only exists in one bucket, or vanishes in both, it was never
  // its own signal. Squeeze-route rows have no conditionsMet and are held out
  // of this table rather than lumped into a bucket they never had.
  if (survivors.length) {
    console.log('\n═══ COSTUME CHECK — is each survivor just conditionsMet again? ═══\n');
    for (const s of survivors) {
      const rows: Array<Record<string, string | number>> = [];
      for (const [name, filt] of [
        ['conditionsMet <= 1', (t: Trade) => t.cells.conditionsMet !== '' && Number(t.cells.conditionsMet) <= 1],
        ['conditionsMet >= 2', (t: Trade) => t.cells.conditionsMet !== '' && Number(t.cells.conditionsMet) >= 2],
        ['no checklist (squeeze)', (t: Trade) => t.cells.conditionsMet === ''],
      ] as Array<[string, (t: Trade) => boolean]>) {
        const set = holdout.filter(filt);
        const hi = set.filter((t) => s.split(t) === 'high');
        const lo = set.filter((t) => s.split(t) === 'low');
        rows.push({
          'holdout subset': name,
          n: set.length,
          'high win%': hi.length ? `${(winRate(hi) * 100).toFixed(1)}% (${hi.length})` : '—',
          'low win%': lo.length ? `${(winRate(lo) * 100).toFixed(1)}% (${lo.length})` : '—',
          gap: hi.length && lo.length ? `${((winRate(hi) - winRate(lo)) * 100).toFixed(1)}pp` : '—',
        });
      }
      console.log(`${s.label}:`);
      console.table(rows);
    }
  } else {
    console.log('\nNo feature survived the holdout, so there is no costume check to run.');
  }

  // ── the asymmetric trend hypothesis, tested at explicit thresholds ─────
  // Folding about zero would destroy what the TUNE bins actually show: the
  // POSITIVE side (trend agreeing with the trade) collapses far harder than
  // the negative side. These three thresholds were read off the TUNE bins —
  // that is fitting, and it is why the holdout column is the only verdict
  // here. Three more comparisons on top of the 25 above.
  console.log('\n═══ "TRADING WITH A STRONG TREND" — thresholds read off TUNE, judged on HOLDOUT ═══\n');
  console.table(
    [0, 10, 20].map((thr) => {
      const on = (set: Trade[]) => {
        const hi = set.filter((t) => (diSpread(t) ?? -Infinity) > thr);
        const lo = set.filter((t) => (diSpread(t) ?? Infinity) <= thr);
        const s =
          hi.length && lo.length
            ? blockSpread(
                hi.map((t) => ({ time: t.time, value: t.win ? 1 : 0 })),
                lo.map((t) => ({ time: t.time, value: t.win ? 1 : 0 })),
                BLOCK_DAYS,
                B,
                SEED,
              )
            : null;
        return {
          n: hi.length,
          win: winRate(hi),
          netR: mean(hi.map((t) => t.netR)),
          gap: winRate(hi) - winRate(lo),
          ci: s,
        };
      };
      const T = on(tune);
      const H = on(holdout);
      const clears = H.ci ? H.ci.lo > 0 || H.ci.hi < 0 : false;
      return {
        'signed DI >': thr,
        'TUNE n': T.n,
        'TUNE win%': `${(T.win * 100).toFixed(1)}%`,
        'TUNE gap': `${(T.gap * 100).toFixed(1)}pp`,
        'HOLDOUT n': H.n,
        'HOLDOUT win%': `${(H.win * 100).toFixed(1)}%`,
        'HOLDOUT netR': H.netR.toFixed(3),
        'HOLDOUT gap': `${(H.gap * 100).toFixed(1)}pp`,
        'HOLDOUT CI': H.ci ? `[${(H.ci.lo * 100).toFixed(1)}, ${(H.ci.hi * 100).toFixed(1)}]` : '—',
        verdict: clears && Math.sign(T.gap) === Math.sign(H.gap) ? 'SURVIVES' : 'no',
      };
    }),
  );

  // Win rate is not expectancy — a feature can lift win rate and lose money.
  console.log('mean netR by the same TUNE-fixed top-1 split, as a reminder that win rate is not edge:');
  const top = combined[0];
  const rowsT = populated(all, top.key);
  const ci = blockBootstrap(
    rowsT.map((t) => ({ time: t.time, value: t.netR })),
    BLOCK_DAYS,
    B,
    SEED,
  );
  console.log(
    `  all ${rowsT.length} trades with "${top.feature}" recorded: ` +
      `mean netR ${mean(rowsT.map((t) => t.netR)).toFixed(3)} ` +
      `CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] over ${ci.blocks} blocks`,
  );
}

if (require.main === module) report();
