/**
 * Chronological TUNE / HOLDOUT analysis over a plan-backtest CSV.
 *
 *   npx ts-node test/manual/holdout.ts results/y3.csv              # TUNE only
 *   npx ts-node test/manual/holdout.ts results/y3.csv --arm COUNTER --holdout
 *   npx ts-node test/manual/holdout.ts --self-check
 *
 * ─── The holdout gate ────────────────────────────────────────────────────
 * The split is chronological: oldest `--tune 0.7` of the calendar span is
 * TUNE, the newest remainder is HOLDOUT. Without `--holdout` this file cannot
 * report a holdout number at all — the rows are dropped at load, before any
 * statistic is computed, so there is nothing to peek at.
 *
 * `--holdout` also REQUIRES `--arm`, because a holdout that reports every arm
 * is not a holdout: picking the best of three after the fact spends the
 * evidence it was reserved to provide. One arm, named in advance, once.
 *
 * ponytail: one file, no state. The discipline is the argument parser, not a
 * ledger of what has already been looked at — a ledger nobody enforces is
 * worse than a rule that makes the wrong call impossible to phrase.
 */
import * as fs from 'fs';
import { makeRng } from './rng';
import { aggregate, scoreRow } from '../../src/common/replay/trade-scoring';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const TUNE_FRACTION = Number(flag('tune', '0.7'));
const BLOCK_DAYS = Number(flag('block-days', '14'));
const B = Number(flag('b', '2000'));
const SEED = Number(flag('seed', '12345'));
const USE_HOLDOUT = args.includes('--holdout');
const ARM = flag('arm', '');

// ── the row ─────────────────────────────────────────────────────────────

export interface Row {
  coin: string;
  time: number;
  direction: 'long' | 'short';
  structure: string;
  status: string;
  netR: number;
}

/**
 * How one finished trade counts toward an aggregate.
 *
 * Re-exported rather than defined: this used to be a second, independent copy
 * of the rule, and `backtest-plans.ts` averaged raw `netR` while this file
 * averaged the same rows with unresolved trades zeroed — two headline
 * expectancies from identical data. The rule now lives in
 * `src/common/replay/trade-scoring.ts` and every caller reads it from there.
 */
export const scoreOf = (r: Row): number => scoreRow(r);

/** Rows as (time, value) points, which is all the block bootstrap needs. */
export const scored = (rows: Row[]): Array<{ time: number; value: number }> =>
  rows.map((r) => ({ time: r.time, value: scoreOf(r) }));

export const isAligned = (r: Row): boolean =>
  (r.direction === 'long' && r.structure === 'HH/HL') ||
  (r.direction === 'short' && r.structure === 'LH/LL');

export const isCounter = (r: Row): boolean =>
  (r.direction === 'long' && r.structure === 'LH/LL') ||
  (r.direction === 'short' && r.structure === 'HH/HL');

export const ARMS: Record<string, (r: Row) => boolean> = {
  BASELINE: () => true,
  ALIGNED: isAligned,
  COUNTER: isCounter,
};

// ── stats ───────────────────────────────────────────────────────────────

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const quantile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
};

/**
 * Block bootstrap over calendar time.
 *
 * Trade-level resampling assumes independence, and ten coins inside one week
 * are closer to one observation than to forty. Drawing whole time blocks —
 * every coin's trades inside that block together — keeps whatever market-wide
 * move the block contained instead of averaging it away. It is the widest of
 * the three resampling schemes tried, and the honest one.
 */
export function blockBootstrap(
  points: Array<{ time: number; value: number }>,
  blockDays: number,
  b: number,
  seed: number,
): { lo: number; hi: number; blocks: number; pPositive: number } {
  if (points.length === 0) return { lo: NaN, hi: NaN, blocks: 0, pPositive: NaN };
  const rng = makeRng(seed);
  const t0 = Math.min(...points.map((r) => r.time));
  const ms = blockDays * 86_400_000;
  const byBlock = new Map<number, number[]>();
  for (const r of points) {
    const k = Math.floor((r.time - t0) / ms);
    const bucket = byBlock.get(k);
    if (bucket) bucket.push(r.value);
    else byBlock.set(k, [r.value]);
  }
  const blocks = [...byBlock.values()];

  const draws: number[] = [];
  for (let i = 0; i < b; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      const pick = blocks[Math.floor(rng() * blocks.length)];
      for (const v of pick) {
        sum += v;
        count += 1;
      }
    }
    if (count > 0) draws.push(sum / count);
  }
  return {
    lo: quantile(draws, 0.025),
    hi: quantile(draws, 0.975),
    blocks: blocks.length,
    pPositive: draws.filter((x) => x > 0).length / draws.length,
  };
}

/**
 * The same block bootstrap, on the DIFFERENCE between two arms.
 *
 * Not two calls to `blockBootstrap` with the intervals subtracted. That treats
 * the arms as independent when both are drawn from the same weeks of the same
 * market, so it over-states the width — and the width is the whole answer here.
 * A draw picks a block and takes BOTH arms' trades from it, so a week that was
 * kind to the strategy was kind to the control in the same draw.
 *
 * Blocks are keyed off a shared `t0` across both arms, or the two series would
 * be cut on different boundaries and "the same block" would mean two things.
 *
 * A draw where either arm ended up with no trades is skipped rather than
 * counted as a zero difference — no trades is not a result of zero.
 */
export function blockBootstrapDiff(
  a: Array<{ time: number; value: number }>,
  b: Array<{ time: number; value: number }>,
  blockDays: number,
  draws: number,
  seed: number,
): { lo: number; hi: number; blocks: number; pPositive: number; point: number } {
  const empty = { lo: NaN, hi: NaN, blocks: 0, pPositive: NaN, point: NaN };
  if (a.length === 0 || b.length === 0) return empty;

  const rng = makeRng(seed);
  const t0 = Math.min(...a.map((r) => r.time), ...b.map((r) => r.time));
  const ms = blockDays * 86_400_000;
  const keyOf = (t: number): number => Math.floor((t - t0) / ms);

  // Every block either series touches, so a block present in only one arm still
  // gets drawn — and contributes to that arm alone, which is the truth about it.
  const byBlock = new Map<number, { a: number[]; b: number[] }>();
  const put = (arm: 'a' | 'b', rows: typeof a): void => {
    for (const r of rows) {
      const k = keyOf(r.time);
      let cell = byBlock.get(k);
      if (!cell) byBlock.set(k, (cell = { a: [], b: [] }));
      cell[arm].push(r.value);
    }
  };
  put('a', a);
  put('b', b);
  const blocks = [...byBlock.values()];

  const out: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sumA = 0, nA = 0, sumB = 0, nB = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      const pick = blocks[Math.floor(rng() * blocks.length)];
      for (const v of pick.a) { sumA += v; nA += 1; }
      for (const v of pick.b) { sumB += v; nB += 1; }
    }
    if (nA > 0 && nB > 0) out.push(sumA / nA - sumB / nB);
  }
  if (out.length === 0) return empty;

  return {
    lo: quantile(out, 0.025),
    hi: quantile(out, 0.975),
    blocks: blocks.length,
    pPositive: out.filter((x) => x > 0).length / out.length,
    point: mean(a.map((r) => r.value)) - mean(b.map((r) => r.value)),
  };
}

export interface Profile {
  n: number;
  winRate: string;
  avgWin: string;
  avgLose: string;
  payoff: string;
  expectancy: string;
  totalR: string;
  /** Open positions and their mark. Present on every row, by design. */
  open: number;
  openMeanR: string;
  /** The same expectancy with the open positions dropped instead of marked. */
  expResolved: string;
  gap: string;
}

const n3 = (x: number): string => (Number.isNaN(x) ? '—' : x.toFixed(3));

/**
 * A display wrapper over the shared `aggregate` — no statistic is computed
 * here. This file used to own a second copy of the rule, which is how it came
 * to report −0.1455R against the harness's −0.0178R from the same rows.
 */
export function profile(rows: Row[]): Profile {
  const a = aggregate(rows);
  return {
    n: a.n,
    winRate: Number.isNaN(a.winRate) ? '—' : `${(a.winRate * 100).toFixed(0)}%`,
    avgWin: n3(a.avgWin),
    avgLose: n3(a.avgLose),
    payoff: Number.isNaN(a.payoff) ? '—' : `${a.payoff.toFixed(2)}:1`,
    expectancy: n3(a.expectancy),
    totalR: a.n ? a.totalR.toFixed(1) : '—',
    open: a.unresolved,
    openMeanR: n3(a.unresolvedMeanR),
    expResolved: n3(a.expectancyResolved),
    gap: n3(a.markingGap),
  };
}

// ── BTC regime ──────────────────────────────────────────────────────────

export type Regime = 'bull' | 'bear' | 'chop';

/**
 * Market backdrop from BTC alone, because every coin here trades against it.
 *
 * Deliberately crude and stated rather than tuned: price versus a 200-bar SMA
 * on 12h (~100 days), plus the SMA's own slope over 10 bars. Both must agree,
 * so a cross without follow-through reads as chop rather than flipping the
 * label. This is a DESCRIPTION of the backdrop used to slice results, never an
 * input to a trade — nothing downstream reads it.
 */
export function btcRegimes(
  closes: number[],
  times: number[],
  period = 200,
  slopeLookback = 10,
): Array<{ time: number; regime: Regime }> {
  const out: Array<{ time: number; regime: Regime }> = [];
  let sum = 0;
  const sma: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    sma.push(i >= period - 1 ? sum / period : NaN);
  }
  for (let i = 0; i < closes.length; i += 1) {
    const s = sma[i];
    const prior = sma[i - slopeLookback];
    let regime: Regime = 'chop';
    if (Number.isFinite(s) && Number.isFinite(prior)) {
      if (closes[i] > s && s > prior) regime = 'bull';
      else if (closes[i] < s && s < prior) regime = 'bear';
    }
    out.push({ time: times[i], regime });
  }
  return out;
}

/** Regime in force at `t` — the most recent bar that had CLOSED by then. */
export function regimeAt(
  series: Array<{ time: number; regime: Regime }>,
  t: number,
  barMs: number,
): Regime {
  let best: Regime = 'chop';
  for (const s of series) {
    if (s.time + barMs <= t) best = s.regime;
    else break;
  }
  return best;
}

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };
  const row = (o: Partial<Row>): Row =>
    ({
      coin: 'X',
      time: 0,
      direction: 'long',
      structure: 'ranging',
      status: 'STOPPED',
      netR: 0,
      ...o,
    }) as Row;

  assert(scoreOf(row({ status: 'TIMEOUT', netR: 5 })) === 5, 'unresolved keeps its mark');
  assert(scoreOf(row({ status: 'STOPPED', netR: -1 })) === -1, 'resolved keeps its R');

  // An unresolved winner must not be binned as a loss — the defect that moved
  // the reported expectancy by 0.13R across 60 of 626 trades.
  const mixed = [
    row({ status: 'TIMEOUT', netR: 2 }),
    row({ status: 'STOPPED', netR: -1 }),
  ];
  const p = profile(mixed);
  assert(p.winRate === '50%', `an unresolved +2R is a win, not a loss (got ${p.winRate})`);
  assert(p.expectancy === '0.500', `marked to market: (2 − 1)/2 (got ${p.expectancy})`);
  assert(p.open === 1 && p.openMeanR === '2.000', 'the open position is reported, not hidden');
  assert(p.expResolved === '-1.000', 'and again with it dropped rather than marked');
  assert(p.gap === '1.500', 'the gap between the two conventions is stated');

  assert(isAligned(row({ direction: 'long', structure: 'HH/HL' })), 'long in an uptrend is aligned');
  assert(isCounter(row({ direction: 'long', structure: 'LH/LL' })), 'long in a downtrend is counter');
  // Ranging belongs to NEITHER arm — the two must not overlap or the totals
  // would double-count, and must not cover ranging or COUNTER stops matching
  // the 84-day definition.
  const rangingRow = row({ structure: 'ranging' });
  assert(!isAligned(rangingRow) && !isCounter(rangingRow), 'ranging is in neither arm');
  assert(
    !ARMS.ALIGNED(row({ direction: 'short', structure: 'HH/HL' })),
    'a short in an uptrend is not aligned',
  );

  // Bootstrap: a constant series has a degenerate interval at its own value.
  const flat = Array.from({ length: 40 }, (_, i) => row({ time: i * 86_400_000, netR: 0.5 }));
  const ci = blockBootstrap(scored(flat), 14, 200, 1);
  assert(Math.abs(ci.lo - 0.5) < 1e-9 && Math.abs(ci.hi - 0.5) < 1e-9, 'no spread, no interval');
  assert(ci.blocks > 1, 'a 40-day span splits into more than one 14-day block');

  // …and BLOCK-to-block variation must produce a real one. Alternating the
  // sign per block rather than per trade is the point: a series that is noisy
  // WITHIN blocks but identical ACROSS them has nothing for a block bootstrap
  // to resample, and the interval correctly collapses. Only spread between
  // blocks widens it.
  const perBlock = Array.from({ length: 224 }, (_, i) =>
    row({ time: i * 43_200_000, netR: Math.floor(i / 28) % 2 === 0 ? 1 : -1 }),
  );
  const ci2 = blockBootstrap(scored(perBlock), 14, 500, 7);
  assert(ci2.lo < 0 && ci2.hi > 0, 'block-level spread brackets zero');
  assert(ci2.hi - ci2.lo > 0.5, 'eight blocks of +/-1 is a wide interval, not a point');

  // Regime: rising closes above a rising average are a bull, and the label
  // must not appear before the SMA has enough history.
  const rising = Array.from({ length: 260 }, (_, i) => 100 + i);
  const times = rising.map((_, i) => i * 43_200_000);
  const reg = btcRegimes(rising, times);
  assert(reg[reg.length - 1].regime === 'bull', 'a monotone rise is a bull');
  assert(reg[50].regime === 'chop', 'no verdict before the SMA has its window');

  const falling = Array.from({ length: 260 }, (_, i) => 1000 - i);
  assert(
    btcRegimes(falling, times)[259].regime === 'bear',
    'a monotone fall is a bear',
  );

  // regimeAt must not read a bar that had not closed yet.
  const series = [
    { time: 0, regime: 'bull' as Regime },
    { time: 43_200_000, regime: 'bear' as Regime },
  ];
  assert(regimeAt(series, 43_200_000, 43_200_000) === 'bull', 'the forming bar is invisible');
  assert(regimeAt(series, 86_400_000, 43_200_000) === 'bear', 'a closed bar is visible');

  console.log('self-check passed (scoring, arms, block bootstrap, BTC regime, no look-ahead)');
}

// `require.main` guarded like the report below it: without that, importing
// this file from another tool that was itself run with --self-check would run
// THIS file's checks, exit 0, and let the caller's own checks never run —
// green output for a suite that never executed.
if (require.main === module && args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── load ────────────────────────────────────────────────────────────────

/**
 * One arm of a `backtest:plans --csv` dump.
 *
 * Exported so nothing writes a fourth CSV parser for these files. `tier` picks
 * the arm: the strategy rows are PLAN, the random control's are RANDOM and live
 * in the sibling `.random.csv`.
 */
export function load(path: string, tier: string = 'PLAN'): Row[] {
  const lines = fs
    .readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => !l.startsWith('#'));
  const head = lines[0].split(',');
  const idx = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`${path}: missing column ${name}`);
    return i;
  };
  const [iCoin, iTier, iDir, iStruct, iTime, iStatus, iNet] = [
    'coin', 'tier', 'direction', 'structure', 'time', 'status', 'netR',
  ].map(idx);
  return lines
    .slice(1)
    .map((l) => l.split(','))
    .filter((c) => c[iTier] === tier)
    .map((c) => ({
      coin: c[iCoin],
      time: new Date(c[iTime]).getTime(),
      direction: c[iDir] as Row['direction'],
      structure: c[iStruct],
      status: c[iStatus],
      netR: Number(c[iNet]),
    }));
}

/**
 * The report. Guarded so this file can be imported for its helpers —
 * P3 onward reuse `blockBootstrap` — without a bare import firing off a
 * CSV read and a console dump as a side effect.
 */
function report(): void {
  const csvPath = args.find((a) => !a.startsWith('--') && a.endsWith('.csv'));
  if (!csvPath) throw new Error('pass the plan-backtest CSV as the first argument');

  const all = load(csvPath).sort((a, b) => a.time - b.time);
  const t0 = all[0].time;
  const t1 = all[all.length - 1].time;
  const cut = t0 + (t1 - t0) * TUNE_FRACTION;

  const tune = all.filter((r) => r.time < cut);
  const holdout = all.filter((r) => r.time >= cut);

  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nsource   ${csvPath}`);
  console.log(`span     ${day(t0)} → ${day(t1)}  (${all.length} plan trades)`);
  console.log(
    `TUNE     ${day(t0)} → ${day(cut)}  ${tune.length} trades ` +
      `(${((tune.length / all.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `HOLDOUT  ${day(cut)} → ${day(t1)}  ${holdout.length} trades ` +
      `(${((holdout.length / all.length) * 100).toFixed(0)}%)`,
  );

  if (USE_HOLDOUT && !ARM) {
    throw new Error(
      'refusing: --holdout requires --arm. Reporting every arm on the holdout ' +
        'is selection on the holdout, which spends exactly the evidence it was ' +
        'held back to provide.',
    );
  }
  if (ARM && !ARMS[ARM]) {
    throw new Error(`unknown arm ${ARM}; one of ${Object.keys(ARMS).join(', ')}`);
  }

  // The gate. Holdout rows are dropped here, before any statistic exists.
  const rows = USE_HOLDOUT ? holdout : tune;
  console.log(
    USE_HOLDOUT
      ? `\n>>> HOLDOUT RUN — arm ${ARM}, one shot, no adjustment after this <<<\n`
      : `\nusing TUNE only. Holdout rows dropped at load.\n`,
  );

  // ── report ──────────────────────────────────────────────────────────────

  const armRow = (name: string, set: Row[]): Record<string, string | number> => {
    const p = profile(set);
    const ci = blockBootstrap(scored(set), BLOCK_DAYS, B, SEED);
    return {
      arm: name,
      n: p.n,
      'win%': p.winRate,
      'avg winner': p.avgWin,
      'avg loser': p.avgLose,
      payoff: p.payoff,
      expectancy: p.expectancy,
      'total R': p.totalR,
      // Always visible: the headline marks open positions to market, so the
      // count, their mark, and the number without them travel beside it.
      open: p.open,
      'open meanR': p.openMeanR,
      'exp resolved': p.expResolved,
      gap: p.gap,
      'CI low': Number.isFinite(ci.lo) ? ci.lo.toFixed(3) : '—',
      'CI high': Number.isFinite(ci.hi) ? ci.hi.toFixed(3) : '—',
      'crosses 0': !Number.isFinite(ci.lo) ? '—' : ci.lo < 0 && ci.hi > 0 ? 'YES' : 'no',
      'P(>0)': Number.isFinite(ci.pPositive) ? `${(ci.pPositive * 100).toFixed(0)}%` : '—',
    };
  };

  async function main(): Promise<void> {
    if (USE_HOLDOUT) {
      console.log(`arm ${ARM} · ${BLOCK_DAYS}-day blocks · ${B} resamples · seed ${SEED}`);
      console.table([armRow(ARM, rows.filter(ARMS[ARM]))]);
      return;
    }

    console.log(`three arms on TUNE · ${BLOCK_DAYS}-day blocks · ${B} resamples · seed ${SEED}`);
    console.table(Object.keys(ARMS).map((k) => armRow(k, rows.filter(ARMS[k]))));

    // Robustness on the one free parameter in the interval: block width.
    console.log('\nsame arms at other block widths (expectancy is unchanged; only the CI moves)');
    console.table(
      [7, 28, 56].flatMap((d) =>
        Object.keys(ARMS).map((k) => {
          const set = rows.filter(ARMS[k]);
          const ci = blockBootstrap(scored(set), d, B, SEED);
          return {
            'block days': d,
            arm: k,
            'CI low': ci.lo.toFixed(3),
            'CI high': ci.hi.toFixed(3),
            blocks: ci.blocks,
            'crosses 0': ci.lo < 0 && ci.hi > 0 ? 'YES' : 'no',
          };
        }),
      ),
    );

    // ── BTC backdrop ──────────────────────────────────────────────────────
    const { BinanceService } = await import('../../src/market-data/market-data.service');
    const { CacheTelemetryService } = await import(
      '../../src/market-data/cache-telemetry.service'
    );
    const { Logger } = await import('@nestjs/common');
    Logger.overrideLogger(false);

    const store = new Map<string, unknown>();
    const cache = {
      get: (k: string) => Promise.resolve(store.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
      del: (k: string) => Promise.resolve(store.delete(k)),
    } as never;

    const binance = new BinanceService(cache, new CacheTelemetryService());
    // 12h bars over the full span plus the 200-bar SMA warm-up.
    const need = Math.ceil((t1 - t0) / 43_200_000) + 260;
    const btc = await binance.getCandlesPaged('BTC', '12h', need);
    const series = btcRegimes(
      btc.map((c) => c.close),
      btc.map((c) => c.time.getTime()),
    );

    const labelled = rows.map((r) => ({
      row: r,
      regime: regimeAt(series, r.time, 43_200_000),
    }));

    console.log('\nBTC backdrop on TUNE (12h close vs 200-SMA, SMA slope over 10 bars)');
    console.table(
      (['bull', 'bear', 'chop'] as Regime[]).map((g) => {
        const set = labelled.filter((x) => x.regime === g);
        return {
          backdrop: g,
          'trades': set.length,
          'share': `${((set.length / labelled.length) * 100).toFixed(0)}%`,
          'first': set.length ? day(Math.min(...set.map((x) => x.row.time))) : '—',
          'last': set.length ? day(Math.max(...set.map((x) => x.row.time))) : '—',
        };
      }),
    );

    for (const arm of ['ALIGNED', 'COUNTER', 'BASELINE']) {
      console.log(`\n${arm} by BTC backdrop`);
      console.table(
        (['bull', 'bear', 'chop'] as Regime[]).map((g) => {
          const set = labelled
            .filter((x) => x.regime === g)
            .map((x) => x.row)
            .filter(ARMS[arm]);
          return { backdrop: g, ...armRow(arm, set) };
        }),
      );
    }
  }

  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

if (require.main === module) report();
