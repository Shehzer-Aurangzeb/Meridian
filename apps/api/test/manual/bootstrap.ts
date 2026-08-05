/**
 * Block bootstrap for backtest CSVs.
 *
 *   npx ts-node test/manual/bootstrap.ts strat.csv rand.csv --direction long
 *   npx ts-node test/manual/bootstrap.ts strat.csv --direction long   (no control)
 *   npx ts-node test/manual/bootstrap.ts --self-check
 *
 * ─── Why this exists ─────────────────────────────────────────────────────
 * The harness reports a Welch t-test, which assumes trades are independent.
 * They are not: 10 crypto assets over one calendar window move together
 * (cross-sectional corr ~0.7-0.9), and overlapping holds correlate in time.
 * So the t-test's p-value is optimistic by an unknown factor.
 *
 * Resampling whole CALENDAR MONTHS with replacement fixes both at once — a
 * month is drawn with every coin's trades inside it, so whatever correlation
 * exists within that month is preserved instead of being averaged away.
 *
 * The unit of evidence is therefore the MONTH, not the trade. ~33 months of
 * data is a far weaker sample than "742 trades" suggests, which is the whole
 * point of running this.
 *
 * ponytail: month blocks only. Add a stationary/moving-block variant if the
 * month boundary is ever suspected of mattering; for a 48-bar max hold on 1d
 * bars it does not.
 */
import { makeRng } from './rng';

const args = process.argv.slice(2);
const flagVal = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const B = Number(flagVal('b', '10000'));
const DIRECTION = flagVal('direction', 'all'); // long | short | all

interface Row {
  month: string;
  r: number; // net of cost
  direction: string;
}

function parse(path: string): Row[] {
  const fs = require('fs') as typeof import('fs');
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  const iTime = head.indexOf('time');
  const iR = head.indexOf('r');
  const iCost = head.indexOf('costR');
  const iDir = head.indexOf('direction');
  if (iTime < 0 || iR < 0 || iCost < 0 || iDir < 0) {
    throw new Error(`${path}: expected columns time,direction,r,costR`);
  }
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return {
      month: c[iTime].slice(0, 7), // YYYY-MM
      r: Number(c[iR]) - Number(c[iCost]),
      direction: c[iDir],
    };
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Deterministic RNG (see rng.ts) so a reported p-value reproduces exactly.
// The generator that used to live here was non-uniform enough to over-weight
// some months in the resample; any CI printed before that fix needs re-running.

function byMonth(rows: Row[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const r of rows) (m.get(r.month) ?? m.set(r.month, []).get(r.month)!).push(r.r);
  return m;
}

interface Result {
  point: number;
  lo: number;
  hi: number;
  pLeqZero: number;
  months: number;
  nA: number;
  nB: number;
}

/**
 * Resample months with replacement. `b` is optional — when absent this
 * bootstraps A's own expectancy; when present it bootstraps the DELTA
 * (A − B) using the same drawn months for both, so a month that happened
 * to be good for everything cannot inflate the difference.
 */
function bootstrap(a: Row[], b: Row[] | null, iters: number, seed = 42): Result {
  const ma = byMonth(a);
  const mb = b ? byMonth(b) : null;
  // Only months where BOTH sides have trades can inform a delta.
  const months = [...ma.keys()].filter((k) => !mb || (mb.get(k)?.length ?? 0) > 0);
  if (months.length < 2) throw new Error(`need >=2 shared months, got ${months.length}`);

  const rng = makeRng(seed);
  const point = mean(a.map((r) => r.r)) - (b ? mean(b.map((r) => r.r)) : 0);

  const deltas: number[] = [];
  for (let it = 0; it < iters; it++) {
    const av: number[] = [];
    const bv: number[] = [];
    for (let k = 0; k < months.length; k++) {
      const m = months[Math.floor(rng() * months.length)];
      av.push(...(ma.get(m) ?? []));
      if (mb) bv.push(...(mb.get(m) ?? []));
    }
    if (av.length === 0 || (mb && bv.length === 0)) continue;
    deltas.push(mean(av) - (mb ? mean(bv) : 0));
  }

  deltas.sort((x, y) => x - y);
  return {
    point,
    lo: deltas[Math.floor(0.025 * deltas.length)],
    hi: deltas[Math.floor(0.975 * deltas.length)],
    pLeqZero: deltas.filter((d) => d <= 0).length / deltas.length,
    months: months.length,
    nA: a.length,
    nB: b ? b.length : 0,
  };
}

function report(label: string, res: Result) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}`);
  console.log(`  point estimate   ${res.point >= 0 ? '+' : ''}${res.point.toFixed(4)}R`);
  console.log(
    `  95% CI           [${res.lo >= 0 ? '+' : ''}${res.lo.toFixed(4)}, ${res.hi >= 0 ? '+' : ''}${res.hi.toFixed(4)}]R`,
  );
  console.log(`  P(<= 0)          ${res.pLeqZero.toFixed(4)}`);
  console.log(
    `  blocks           ${res.months} months · n=${res.nA}${res.nB ? ` vs ${res.nB}` : ''}`,
  );
  console.log(
    res.lo > 0
      ? '  → CI excludes zero (positive). Survives clustering.'
      : res.hi < 0
        ? '  → CI excludes zero (NEGATIVE). Significantly worse than the comparison.'
        : '  → CI includes zero. NOT distinguishable from zero once correlation is respected.',
  );
}

// ── self-check ──────────────────────────────────────────────────────────
// Two cases with known answers. Runs in ~1s and fails loudly if the
// resampling or percentile logic breaks.
function selfCheck() {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`self-check FAILED: ${msg}`);
  };
  const rng = makeRng(7);
  const mk = (nMonths: number, per: number, mu: number): Row[] => {
    const out: Row[] = [];
    for (let m = 0; m < nMonths; m++) {
      // One shared shock per month => trades within a month are correlated,
      // which is exactly the structure the month block is meant to preserve.
      const shock = (rng() - 0.5) * 2;
      for (let k = 0; k < per; k++) {
        out.push({
          month: `2020-${String((m % 12) + 1).padStart(2, '0')}`,
          r: mu + shock + (rng() - 0.5),
          direction: 'long',
        });
      }
    }
    return out;
  };

  // 1. Identical distributions => delta CI must contain zero.
  const nullRes = bootstrap(mk(12, 30, 0.1), mk(12, 30, 0.1), 2000, 1);
  ok(nullRes.lo <= 0 && nullRes.hi >= 0, `null case CI should span 0, got [${nullRes.lo},${nullRes.hi}]`);

  // 2. A large true delta must be detected.
  const realRes = bootstrap(mk(12, 30, 1.5), mk(12, 30, 0.0), 2000, 1);
  ok(realRes.lo > 0, `real case CI should exclude 0, got [${realRes.lo},${realRes.hi}]`);

  // 3. Correlated months must widen the CI vs pretending trades are iid.
  // Same data, but each month gets its own label => no shared shock to
  // preserve, so blocks are effectively single trades and the CI shrinks.
  const corr = mk(12, 30, 0.1);
  const flat = corr.map((r, i) => ({ ...r, month: `x-${i}` }));
  const wide = bootstrap(corr, null, 2000, 1);
  const narrow = bootstrap(flat, null, 2000, 1);
  ok(wide.hi - wide.lo > narrow.hi - narrow.lo,
    'clustered CI should be wider than the iid-equivalent CI',
  );

  console.log('self-check passed (null spans 0, real excludes 0, clustering widens CI)');
}

if (args.includes('--self-check')) {
  selfCheck();
} else {
  const paths = args.filter((a) => a.endsWith('.csv'));
  if (paths.length === 0) throw new Error('pass at least one CSV');

  const pick = (rows: Row[]) =>
    DIRECTION === 'all' ? rows : rows.filter((r) => r.direction === DIRECTION);

  const strat = pick(parse(paths[0]));
  console.log(
    `\nblock bootstrap · ${B} resamples · month blocks · direction=${DIRECTION}`,
  );

  report('strategy expectancy', bootstrap(strat, null, B));

  if (paths[1]) {
    const rand = pick(parse(paths[1]));
    report('random control expectancy', bootstrap(rand, null, B));
    report('DELTA (strategy − random)', bootstrap(strat, rand, B));
  }
}
