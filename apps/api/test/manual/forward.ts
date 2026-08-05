/**
 * STEP 1: does the sequenced dip→turn signal precede better forward returns
 * than random long entries on the same bars?
 *
 *   npx ts-node test/manual/forward.ts 1d --coins BTC,ETH,... --limit 1200 \
 *     --out test/manual/results/step1
 *   npx ts-node test/manual/forward.ts --self-check
 *
 * ─── Why forward returns and not a backtest ──────────────────────────────
 * The zone test taught us that a bad exit rule drowns the entry signal:
 * level-to-level TP1 gave a 0.25 reward/risk ratio, which needs an >80% win
 * rate just to break even, so the entry could not be seen through it. And 2R
 * is arbitrary — we picked it, the market did not.
 *
 * So this measures entry quality with NO exit rule at all: the raw forward
 * return at fixed horizons. Exits get designed later, against levels, in
 * step 3. Entry and exit are measured separately instead of confounded.
 *
 * Returns are in ATR UNITS, not percent — 1 ATR at the entry bar is the risk
 * currency of this project and it makes a 4% BTC move and a 12% altcoin move
 * comparable. Cost uses the same denominator: round-trip % over ATR %.
 *
 * ─── Pre-registered before the first run ─────────────────────────────────
 *   SIGNAL     dip (RSI <= 40 AND within 10% of the lower band), THEN QQE
 *              turns green within 20 bars.  Definition lives in signal.ts.
 *   WINDOW     20 bars. NOT fitted: the sequencing run measured zero dips
 *              going stale and a median wait of 1 bar, so the window does
 *              not bind. It is a guard, not a parameter.
 *   HORIZONS   5, 10, 20 bars. Declared together, reported together — no
 *              picking the best one afterwards.
 *   CONTROL    random long entries, matched COUNT PER COIN, drawn uniformly
 *              without replacement from the same eligible bars.
 *   ELIGIBLE   bars with a full indicator window, ATR > 0, and the LARGEST
 *              horizon still ahead of them. Identical set for both arms and
 *              all horizons, so the three horizons are comparable.
 *   INFERENCE  month-clustered block bootstrap (bootstrap.ts). No t-test.
 *   RUNS       one. No parameter sweep.
 *
 * Long side only, matching the signal.
 *
 * ponytail: no exit, no leverage, no compounding. This answers one question.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { ANALYSIS_CANDLE_LIMIT } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { TimeInterval } from '../../src/common/types/candle.types';
import { BarState, classify, walk } from './signal';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const flagVal = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const timeframe = ((args[0] && !args[0].startsWith('--') ? args[0] : '1d')) as TimeInterval;
const COINS = flagVal('coins', 'BTC')
  .split(',')
  .map((c) => c.trim().toUpperCase());
const LIMIT = Number(flagVal('limit', '1200'));
const HORIZONS = flagVal('horizons', '5,10,20')
  .split(',')
  .map(Number);
const OUT = flagVal('out', '');
const SEED = Number(flagVal('seed', '42'));

// Same cost model as backtest.ts: Kraken futures taker + slippage, charged
// against the risk unit rather than assumed flat.
const FEE_PCT = 0.05;
const SLIP_PCT = 0.02;
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);

// ── pure bits, so the self-check has something to bite on ────────────────

/** Forward return from bar j to bar j+h, denominated in ATR at bar j. */
export function forwardR(
  closes: readonly number[],
  atrs: readonly number[],
  j: number,
  h: number,
): number {
  return (closes[j + h] - closes[j]) / atrs[j];
}

/** Round-trip cost expressed in the same ATR units as forwardR. */
export function costR(close: number, atr: number): number {
  return ROUND_TRIP_PCT / ((atr / close) * 100);
}

/** `n` distinct members of `pool`, uniform, no replacement. */
export function sample<T>(pool: readonly T[], n: number, rng: () => number): T[] {
  const copy = [...pool];
  const take = Math.min(n, copy.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, take);
}

// ── measurement ──────────────────────────────────────────────────────────

interface Entry {
  coin: string;
  time: Date;
  index: number;
  /** forward return in ATR units, keyed by horizon */
  r: Map<number, number>;
  costR: number;
}

const maxH = Math.max(...HORIZONS);
const signalEntries: Entry[] = [];
const randomEntries: Entry[] = [];
let totalBars = 0;
let coinYears = 0;
let dipBars = 0;
let simultaneous = 0;
const rng = makeRng(SEED);

const BARS_PER_YEAR: Record<string, number> = { '1d': 365, '4h': 365 * 6, '1h': 365 * 24 };

async function run(coin: string) {
  const indicators = new IndicatorsService();
  const store = new Map<string, unknown>();
  const cache = {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
    del: (k: string) => Promise.resolve(store.delete(k)),
  } as unknown as Cache;
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) {
    console.log(`  ${coin}: only ${candles.length} candles, skipped`);
    return;
  }

  // states[j] describes candle j + ANALYSIS_CANDLE_LIMIT - 1. The final
  // candle is excluded because it may still be forming.
  const states: BarState[] = [];
  const closes: number[] = [];
  const atrs: number[] = [];
  const times: Date[] = [];
  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    const ctx = indicators.buildContext(coin, timeframe, window);
    states.push(classify(ctx));
    closes.push(candles[i].close);
    atrs.push(ctx.atr);
    times.push(candles[i].time);
  }

  totalBars += states.length;
  coinYears += states.length / (BARS_PER_YEAR[timeframe] ?? 365);

  const eligible: number[] = [];
  for (let j = 0; j + maxH < states.length; j++) {
    if (atrs[j] > 0) eligible.push(j);
  }
  const isEligible = new Set(eligible);

  const w = walk(states);
  dipBars += w.dipBars;
  simultaneous += w.simultaneous;

  const mk = (j: number): Entry => ({
    coin,
    time: times[j],
    index: j,
    r: new Map(HORIZONS.map((h) => [h, forwardR(closes, atrs, j, h)])),
    costR: costR(closes[j], atrs[j]),
  });

  const triggers = w.triggers.map((t) => t.at).filter((j) => isEligible.has(j));
  const dropped = w.triggers.length - triggers.length;
  signalEntries.push(...triggers.map(mk));

  // Matched count PER COIN — pooling would let one coin's volatility regime
  // dominate the control.
  randomEntries.push(...sample(eligible, triggers.length, rng).map(mk));

  console.log(
    `  ${coin}: ${states.length} bars · ${w.triggers.length} triggers` +
      `${dropped ? ` (${dropped} dropped, <${maxH} bars of future left)` : ''}` +
      ` · ${eligible.length} eligible bars`,
  );
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

function summarise(label: string, es: Entry[], h: number) {
  const gross = es.map((e) => e.r.get(h)!);
  const net = es.map((e) => e.r.get(h)! - e.costR);
  return {
    arm: label,
    n: es.length,
    'mean gross': mean(gross).toFixed(4),
    'mean net': mean(net).toFixed(4),
    'median net': (() => {
      const s = [...net].sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)].toFixed(4) : '—';
    })(),
    'sd': sd(gross).toFixed(3),
    'win %': ((net.filter((x) => x > 0).length / net.length) * 100).toFixed(1),
  };
}

function writeCsv(path: string, es: Entry[], h: number) {
  const fs = require('fs') as typeof import('fs');
  const rows = [
    'coin,time,index,direction,r,costR',
    ...es.map((e) =>
      [e.coin, e.time.toISOString(), e.index, 'long', e.r.get(h)!.toFixed(6), e.costR.toFixed(6)].join(','),
    ),
  ];
  fs.writeFileSync(path, rows.join('\n'));
}

async function main() {
  console.log(
    `\nforward-return test · ${timeframe} · ${COINS.length} coin(s) · limit ${LIMIT} · seed ${SEED}`,
  );
  console.log(`horizons ${HORIZONS.join(', ')} bars · returns in ATR units · long only\n`);

  for (const c of COINS) await run(c);

  if (signalEntries.length === 0) throw new Error('no signals — nothing to measure');

  console.log(
    `\n${totalBars} bars · ~${coinYears.toFixed(1)} coin-years · ` +
      `dip state on ${dipBars} bars · ${simultaneous} simultaneous (old encoding)`,
  );
  console.log(
    `signal n=${signalEntries.length} (${(signalEntries.length / coinYears).toFixed(2)}/coin-year) · ` +
      `random n=${randomEntries.length}`,
  );
  console.log(
    `cost: ${FEE_PCT}% fee + ${SLIP_PCT}% slip per side = ${ROUND_TRIP_PCT.toFixed(3)}% round trip,\n` +
      `      charged against each entry's ATR — median ${(() => {
        const s = signalEntries.map((e) => e.costR).sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)].toFixed(3);
      })()}R`,
  );

  for (const h of HORIZONS) {
    console.log(`\n── forward ${h} bars ` + '─'.repeat(Math.max(0, 40 - String(h).length)));
    console.table([summarise('signal', signalEntries, h), summarise('random long', randomEntries, h)]);
    const d = mean(signalEntries.map((e) => e.r.get(h)!)) - mean(randomEntries.map((e) => e.r.get(h)!));
    // Cost is identical in expectation across arms, so the delta is gross.
    console.log(`  raw delta (signal − random): ${d >= 0 ? '+' : ''}${d.toFixed(4)} ATR`);

    if (OUT) {
      writeCsv(`${OUT}-signal-h${h}.csv`, signalEntries, h);
      writeCsv(`${OUT}-random-h${h}.csv`, randomEntries, h);
    }
  }

  console.log(
    '\n  The point estimates above are NOT the result. They ignore the\n' +
      '  clustering that killed every previous finding. Run the bootstrap:',
  );
  for (const h of HORIZONS) {
    console.log(
      `    npx ts-node test/manual/bootstrap.ts ${OUT || '<out>'}-signal-h${h}.csv ` +
        `${OUT || '<out>'}-random-h${h}.csv --direction long`,
    );
  }
}

// ── self-check ──────────────────────────────────────────────────────────
// The forward-return arithmetic and the control sampler are the two places
// a silent error would flatter or bury the result. Both are pure; check them.
function selfCheck() {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`self-check FAILED: ${msg}`);
  };

  // 1. On a ramp of +1/bar with ATR 2, the 5-bar forward return is 5/2.
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const atrs = Array.from({ length: 20 }, () => 2);
  ok(forwardR(closes, atrs, 3, 5) === 2.5, `ramp fwd should be 2.5, got ${forwardR(closes, atrs, 3, 5)}`);
  // Falling price must give a negative long return — sign is not symmetric by accident.
  const down = closes.map((c) => 200 - c);
  ok(forwardR(down, atrs, 3, 5) === -2.5, 'falling price must be negative for a long');

  // 2. Cost scales inversely with ATR: a tighter risk unit is a bigger cost in R.
  const wide = costR(100, 10);
  const tight = costR(100, 1);
  ok(tight > wide, 'a smaller ATR must cost MORE in R');
  ok(Math.abs(costR(100, 10) - ROUND_TRIP_PCT / 10) < 1e-12, 'costR arithmetic');

  // 3. Sampler: right count, in range, distinct, seed-reproducible, seed-sensitive.
  const pool = Array.from({ length: 100 }, (_, i) => i);
  const a = sample(pool, 30, makeRng(1));
  const b = sample(pool, 30, makeRng(1));
  const c = sample(pool, 30, makeRng(2));
  ok(a.length === 30, `sampler count, got ${a.length}`);
  ok(new Set(a).size === 30, 'sampler must not repeat a bar');
  ok(a.every((x) => pool.includes(x)), 'sampler stayed in the pool');
  ok(a.join() === b.join(), 'same seed must reproduce exactly');
  ok(a.join() !== c.join(), 'a different seed must give a different draw');
  ok(sample(pool, 500, makeRng(1)).length === 100, 'asking for more than the pool returns the pool');

  // 4. The sampler is unbiased over the pool — a control skewed toward late
  //    bars would compare the signal against a different market.
  const counts = new Array(20).fill(0);
  const r = makeRng(9);
  for (let i = 0; i < 4000; i++) for (const x of sample(Array.from({ length: 20 }, (_, k) => k), 5, r)) counts[x]++;
  const expected = (4000 * 5) / 20;
  ok(
    counts.every((n) => Math.abs(n - expected) < expected * 0.15),
    `sampler bias: ${counts.join(',')} vs expected ~${expected}`,
  );

  console.log('self-check passed (forward return, cost denominator, sampler count/uniqueness/seed/uniformity)');
}

if (args.includes('--self-check')) {
  selfCheck();
} else {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
