/**
 * Exit-style arms, scored on IDENTICAL entries.
 *
 *   npx ts-node test/manual/exits.ts --self-check
 *   npx ts-node test/manual/exits.ts --report test/manual/results/y3-exits.csv
 *
 * The question is the payoff ratio: our losers are bigger than our winners,
 * and no entry filter touches that. So hold the entries fixed and vary only
 * what happens after the fill.
 *
 * ─── Why the arms must share one pass ────────────────────────────────────
 * `backtest-plans.ts` sets `cooldownUntil = i + barsToFill + barsHeld +
 * COOLDOWN`. barsHeld is an OUTPUT of the exit rule, so running each arm as
 * its own backtest would give each a different cooldown and therefore a
 * different set of later entries — and the comparison would silently be
 * about entries again. Scoring every arm against the same filled trade in one
 * pass makes that impossible.
 *
 * The cost of that choice, stated rather than hidden: the entry set belongs
 * to arm A. A real portfolio run on arm B's longer holds would have taken
 * different trades afterwards. These numbers isolate the exit effect; they
 * are not four live portfolios.
 */
import * as fs from 'fs';
import { Candle } from '../../src/common/types/candle.types';
import { scoreLadder } from '../../src/common/replay/plan-replay';
import { blockBootstrap } from './holdout';

export interface ArmSpec {
  name: string;
  /** Bars allowed before the position is marked to market. */
  maxBars: number;
  /** Multiplier on each target's DISTANCE FROM ENTRY. null = no fixed targets. */
  targetScale: number | null;
  /** Multiplier on the stop distance. Changes what 1R means for this arm. */
  stopScale: number;
  breakevenAfterTarget: number;
  trail: boolean;
  /**
   * Trail distance as a multiple of the INITIAL risk. Deliberately separate
   * from `stopScale`: varying the trail while the initial stop stays at 1 ATR
   * keeps riskPerUnit — and therefore the R unit and the cost in R — constant
   * across every variant. Move both together and the sweep would be comparing
   * different units to each other.
   */
  trailMult?: number;
}

export const ARMS: ArmSpec[] = [
  { name: 'A_current', maxBars: 480, targetScale: 1, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'B2_wide2x', maxBars: 960, targetScale: 2, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'B3_wide3x', maxBars: 960, targetScale: 3, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'D_tight', maxBars: 120, targetScale: 1, stopScale: 0.5, breakevenAfterTarget: 1, trail: false },
  // The trail-distance surface. C_trail_10 is the original arm C.
  ...[0.5, 0.75, 1, 1.5, 2].map((m) => ({
    name: `C_trail_${String(m).replace('.', '').padEnd(2, '0')}`,
    maxBars: 960,
    targetScale: null,
    stopScale: 1,
    breakevenAfterTarget: 0,
    trail: true,
    trailMult: m,
  })),
];

export const MAX_ARM_BARS = Math.max(...ARMS.map((a) => a.maxBars));

/**
 * Trailing stop, no fixed target. Ratchets by one initial-risk unit behind
 * the best price seen so far.
 *
 * The stop is tested BEFORE the bar's extreme updates the trail, matching
 * `scoreLadder`'s convention: OHLC carries no intra-bar ordering, so the
 * pessimistic branch is the only honest one. Letting the same bar first
 * ratchet the stop up and then test it would book gains from an ordering the
 * data does not record.
 */
export function scoreTrailing(
  post: Candle[],
  input: {
    direction: 'long' | 'short';
    entry: number;
    riskPerUnit: number;
    /** Trail distance. Defaults to riskPerUnit, which is the original arm C. */
    trailDistance?: number;
  },
): { r: number; status: string; barsHeld: number } {
  const long = input.direction === 'long';
  const { entry, riskPerUnit } = input;
  // R is always normalised by riskPerUnit, never by the trail — otherwise a
  // wider trail would silently shrink every reported R and the sweep would
  // measure the unit change rather than the rule change.
  const trailDistance = input.trailDistance ?? riskPerUnit;
  if (riskPerUnit === 0 || post.length === 0) return { r: 0, status: 'TIMEOUT', barsHeld: 0 };

  let stop = long ? entry - riskPerUnit : entry + riskPerUnit;
  let extreme = entry;

  for (let i = 0; i < post.length; i += 1) {
    const c = post[i];
    if (long ? c.low <= stop : c.high >= stop) {
      return {
        r: (long ? stop - entry : entry - stop) / riskPerUnit,
        status: 'STOPPED',
        barsHeld: i + 1,
      };
    }
    extreme = long ? Math.max(extreme, c.high) : Math.min(extreme, c.low);
    const trailed = long ? extreme - trailDistance : extreme + trailDistance;
    // Ratchet only — a trailing stop never loosens.
    stop = long ? Math.max(stop, trailed) : Math.min(stop, trailed);
  }

  const last = post[post.length - 1].close;
  return {
    r: (long ? last - entry : entry - last) / riskPerUnit,
    status: 'TIMEOUT',
    barsHeld: post.length,
  };
}

/** Score one filled trade under one arm. `post` must be at least maxBars long. */
export function scoreArm(
  post: Candle[],
  plan: {
    direction: 'long' | 'short';
    averageEntry: number;
    riskPerUnit: number;
    targets: Array<{ price: number; weightPercent: number }>;
  },
  spec: ArmSpec,
  roundTripPct: number,
): { r: number; costR: number; netR: number; status: string; barsHeld: number } {
  const long = plan.direction === 'long';
  const risk = plan.riskPerUnit * spec.stopScale;
  const stop = long ? plan.averageEntry - risk : plan.averageEntry + risk;
  const window = post.slice(0, spec.maxBars);

  // Explicit branches rather than a `realizedR ?? r` union: the two scorers
  // name their result differently, and a silent `??` fallback would read 0R
  // as a real outcome the day one of them changes shape.
  let r: number;
  let status: string;
  let barsHeld: number;
  if (spec.trail) {
    const s = scoreTrailing(window, {
      direction: plan.direction,
      entry: plan.averageEntry,
      riskPerUnit: risk,
      trailDistance: risk * (spec.trailMult ?? 1),
    });
    ({ r, status, barsHeld } = s);
  } else {
    const s = scoreLadder(window, {
      direction: plan.direction,
      averageEntry: plan.averageEntry,
      stop,
      riskPerUnit: risk,
      targets: plan.targets.map((t) => ({
        // Scale the DISTANCE from entry, keeping the side and the weights.
        price: plan.averageEntry + (t.price - plan.averageEntry) * (spec.targetScale ?? 1),
        weightPercent: t.weightPercent,
      })),
      breakevenAfterTarget: spec.breakevenAfterTarget,
    });
    r = s.realizedR;
    status = s.status;
    barsHeld = s.barsHeld;
  }

  // Cost is charged against THIS arm's stop distance. A halved stop doubles
  // the toll in R, which is why arm D cannot be compared on R alone.
  const riskPercent = (risk / plan.averageEntry) * 100;
  const costR = riskPercent === 0 ? 0 : roundTripPct / riskPercent;
  return { r, costR, netR: r - costR, status, barsHeld };
}

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };
  const bar = (high: number, low: number, close = (high + low) / 2): Candle =>
    ({ time: new Date(0), open: close, high, low, close, volume: 0 }) as Candle;

  // ── trailing stop ──
  // Straight up then a collapse: the ratchet must book the trailed level, not
  // the original stop and not the peak.
  const up = [bar(102, 100), bar(104, 102), bar(106, 104), bar(106, 99)];
  const t1 = scoreTrailing(up, { direction: 'long', entry: 100, riskPerUnit: 2 });
  // After bar 3 the extreme is 106, so the stop sits at 104. Bar 4 dips to 99.
  assert(t1.status === 'STOPPED', 'a collapse through the trail stops the trade');
  assert(Math.abs(t1.r - 2) < 1e-9, `trailed exit at 104 on a 2-unit risk is +2R (got ${t1.r})`);
  assert(t1.barsHeld === 4, 'it stopped on the fourth bar');

  // Immediate loss: never ratcheted, so the exit is the original stop at -1R.
  const down = [bar(101, 97)];
  const t2 = scoreTrailing(down, { direction: 'long', entry: 100, riskPerUnit: 2 });
  assert(t2.status === 'STOPPED' && Math.abs(t2.r - -1) < 1e-9, 'an untouched trail exits at -1R');

  // The stop is tested BEFORE the same bar's high moves the trail. A bar that
  // spikes up and then breaks the old stop must count as stopped, not saved.
  const spike = [bar(120, 97)];
  const t3 = scoreTrailing(spike, { direction: 'long', entry: 100, riskPerUnit: 2 });
  assert(t3.status === 'STOPPED', 'a bar cannot ratchet its own stop out of the way');

  // Never loosens: a pullback after a run keeps the higher stop.
  const wobble = [bar(110, 100), bar(105, 103), bar(105, 100)];
  const t4 = scoreTrailing(wobble, { direction: 'long', entry: 100, riskPerUnit: 2 });
  assert(Math.abs(t4.r - 4) < 1e-9, `the ratchet holds at 108 after the peak (got ${t4.r})`);

  // Shorts mirror exactly — the same fixture reflected about the entry, so
  // it must produce the same +2R the long case did.
  const t5 = scoreTrailing(
    [bar(100, 98), bar(98, 96), bar(96, 94), bar(101, 94)],
    { direction: 'short', entry: 100, riskPerUnit: 2 },
  );
  assert(
    t5.status === 'STOPPED' && Math.abs(t5.r - 2) < 1e-9,
    `a short trails downward the same way (got ${t5.r})`,
  );

  // Runs to the end without stopping: marked to market, never assumed a win.
  const t6 = scoreTrailing([bar(101, 100, 101)], { direction: 'long', entry: 100, riskPerUnit: 2 });
  assert(t6.status === 'TIMEOUT' && Math.abs(t6.r - 0.5) < 1e-9, 'an open trail marks to market');

  // A wider trail must give the price more room, so it survives a pullback
  // the 1x trail would have stopped — and R is still measured in initial-risk
  // units, not trail units.
  const roomy = scoreTrailing(up, {
    direction: 'long', entry: 100, riskPerUnit: 2, trailDistance: 4,
  });
  // Extreme 106, trail 4 wide -> stop 102. Bar 4 dips to 99, so it stops at 102.
  assert(Math.abs(roomy.r - 1) < 1e-9, `a 2x trail exits at 102 = +1R (got ${roomy.r})`);
  assert(roomy.r < t1.r, 'the wider trail gives back more of the move');
  // The initial stop is NOT widened by the trail parameter.
  const tight = scoreTrailing([bar(101, 97)], {
    direction: 'long', entry: 100, riskPerUnit: 2, trailDistance: 8,
  });
  assert(
    tight.status === 'STOPPED' && Math.abs(tight.r - -1) < 1e-9,
    'a wide trail does not move the initial stop off -1R',
  );

  // ── target scaling ──
  // 2x must double the DISTANCE from entry, not the price.
  const plan = {
    direction: 'long' as const,
    averageEntry: 100,
    riskPerUnit: 2,
    targets: [{ price: 110, weightPercent: 100 }],
  };
  const wide = ARMS.find((a) => a.name === 'B2_wide2x')!;
  // Reaching 119 must NOT fill a 2x target at 120.
  const missed = scoreArm([bar(119, 105, 119)], plan, wide, 0.14);
  assert(missed.status === 'TIMEOUT', 'a 2x target sits at 120, so 119 does not fill it');
  const hit = scoreArm([bar(121, 105, 121)], plan, wide, 0.14);
  assert(hit.status === 'ALL_TARGETS', 'and 121 does');

  // ── cost scales with the arm's own stop ──
  const a = scoreArm([bar(101, 99, 101)], plan, ARMS[0], 0.14);
  const d = scoreArm([bar(101, 99, 101)], plan, ARMS.find((x) => x.name === 'D_tight')!, 0.14);
  assert(
    Math.abs(d.costR - 2 * a.costR) < 1e-9,
    'halving the stop doubles the toll measured in R',
  );

  console.log('self-check passed (trailing ratchet, bar ordering, shorts, target scaling, arm cost)');
}

if (require.main === module && process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────

function report(path: string): void {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  const rows = lines
    .slice(head + 1)
    .map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter((r) => r.tier === 'PLAN')
    .map((r) => ({ time: new Date(r.time).getTime(), cells: r }));

  rows.sort((a, b) => a.time - b.time);
  const t0 = rows[0].time;
  const t1 = rows[rows.length - 1].time;
  const cut = t0 + (t1 - t0) * 0.7;
  const holdout = rows.filter((r) => r.time >= cut);
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nEXIT ARMS — SAME ENTRIES, DIFFERENT EXITS (HOLDOUT ONLY)`);
  console.log(`source   ${path}`);
  console.log(`holdout  ${day(cut)} → ${day(t1)}  ${holdout.length} trades, identical across every arm\n`);

  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // Two bases, because TIMEOUT rates differ wildly between arms and the basis
  // decides the answer. Marked-to-market flatters the long-hold arms; 0R is
  // the conservative convention used everywhere else in this project.
  for (const [basis, score] of [
    ['TIMEOUT at 0R (project convention)', (net: number, st: string) => (st === 'TIMEOUT' ? 0 : net)],
    ['TIMEOUT marked to market', (net: number) => net],
  ] as Array<[string, (net: number, st: string) => number]>) {
    console.log(`── basis: ${basis} ──`);
    console.table(
      ARMS.map((a) => {
        const vals = holdout.map((r) =>
          score(Number(r.cells[`${a.name}_netR`]), r.cells[`${a.name}_status`]),
        );
        const pts = holdout.map((r, i) => ({ time: r.time, value: vals[i] }));
        const w = vals.filter((v) => v > 0);
        const l = vals.filter((v) => v <= 0);
        const avgW = mean(w);
        const avgL = Math.abs(mean(l));
        const ci = blockBootstrap(pts, 14, 2000, 12345);
        const timeouts = holdout.filter((r) => r.cells[`${a.name}_status`] === 'TIMEOUT').length;
        return {
          arm: a.name,
          n: vals.length,
          'win%': `${((w.length / vals.length) * 100).toFixed(1)}%`,
          'avg winner': avgW.toFixed(3),
          'avg loser': `-${avgL.toFixed(3)}`,
          PAYOFF: avgL === 0 ? '—' : `${(avgW / avgL).toFixed(2)}:1`,
          expectancy: mean(vals).toFixed(3),
          '95% CI': `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
          'TIMEOUT%': `${((timeouts / vals.length) * 100).toFixed(0)}%`,
          'med bars': median(holdout.map((r) => Number(r.cells[`${a.name}_barsHeld`]))).toFixed(0),
        };
      }),
    );
    console.log('');
  }

  console.log('payoff needed to break even at a given win rate:  payoff = (1-p)/p');
  console.log('  at 55% win -> 0.82:1 · at 50% -> 1.00:1 · at 45% -> 1.22:1 · at 40% -> 1.50:1');
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

if (require.main === module && process.argv.includes('--report')) {
  const i = process.argv.indexOf('--report');
  report(process.argv[i + 1]);
  process.exit(0);
}

// ── stress: everything that could make arm C not real ───────────────────

const TRAILS = ARMS.filter((a) => a.trail).map((a) => a.name);
/** The arm under test. Everything below is about this one column family. */
const C = 'C_trail_10';

interface Row {
  time: number;
  coin: string;
  structure: string;
  riskPercent: number;
  cells: Record<string, string>;
}

function loadRows(path: string): Row[] {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  return lines
    .slice(head + 1)
    .map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter((r) => r.tier === 'PLAN')
    .map((r) => ({
      time: new Date(r.time).getTime(),
      coin: r.coin,
      structure: r.structure,
      riskPercent: Number(r.riskPercent),
      cells: r,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * netR for one arm at an arbitrary cost multiple.
 *
 * Re-derived from gross R and the trade's own stop distance rather than read
 * from the stored netR, because the stored figure is fixed at 1x toll. Cost
 * scales with the stop, so a 3x toll is NOT a flat 3x subtraction per trade.
 */
const netAt = (r: Row, arm: string, roundTripPct: number): number => {
  // Unresolved positions score a flat 0R, the convention `holdout.ts` uses
  // everywhere: no gain, and no toll for a round trip that never happened.
  if (r.cells[`${arm}_status`] === 'TIMEOUT') return 0;
  const cost = r.riskPercent === 0 ? 0 : roundTripPct / r.riskPercent;
  return Number(r.cells[`${arm}_r`]) - cost;
};

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function profileOf(rows: Row[], arm: string, toll: number) {
  const v = rows.map((r) => netAt(r, arm, toll));
  const w = v.filter((x) => x > 0);
  const l = v.filter((x) => x <= 0);
  const aw = avg(w);
  const al = Math.abs(avg(l));
  const ci = blockBootstrap(
    rows.map((r, i) => ({ time: r.time, value: v[i] })),
    14,
    2000,
    12345,
  );
  return {
    n: v.length,
    win: w.length / v.length,
    payoff: al ? aw / al : NaN,
    exp: avg(v),
    lo: ci.lo,
    hi: ci.hi,
    blocks: ci.blocks,
  };
}

const pctS = (x: number): string => `${(x * 100).toFixed(1)}%`;
const ciS = (p: { lo: number; hi: number }): string =>
  `[${p.lo.toFixed(3)}, ${p.hi.toFixed(3)}]`;

async function stress(path: string): Promise<void> {
  const all = loadRows(path);
  const t0 = all[0].time;
  const t1 = all[all.length - 1].time;
  const cut = t0 + (t1 - t0) * 0.7;
  const tune = all.filter((r) => r.time < cut);
  const hold = all.filter((r) => r.time >= cut);
  const BASE = 0.14;
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nARM C STRESS TESTS — ${path}`);
  console.log(
    `TUNE ${day(t0)}→${day(cut)} ${tune.length} · HOLDOUT ${day(cut)}→${day(t1)} ${hold.length}` +
      ` · same entries throughout\n`,
  );

  // ── 1. trail distance surface ──
  console.log('1. TRAIL DISTANCE — plateau or spike?');
  console.table(
    TRAILS.map((name) => {
      const h = profileOf(hold, name, BASE);
      const t = profileOf(tune, name, BASE);
      return {
        trail: `${ARMS.find((a) => a.name === name)!.trailMult}x risk`,
        'TUNE exp': t.exp.toFixed(3),
        'HOLDOUT exp': h.exp.toFixed(3),
        'HOLDOUT payoff': `${h.payoff.toFixed(2)}:1`,
        'HOLDOUT win%': pctS(h.win),
        '95% CI': ciS(h),
        'clears 0?': h.lo > 0 ? 'YES' : 'no',
      };
    }),
  );

  // ── 2. per coin and per structure ──
  console.log(`\n2. CONCENTRATION — is ${C} carried by a few coins or one structure?`);
  const byKey = (rows: Row[], key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const coinRows = [...byKey(hold, (r) => r.coin).entries()]
    .map(([coin, rs]) => ({ coin, ...profileOf(rs, C, BASE) }))
    .sort((a, b) => b.exp - a.exp);
  console.table(
    coinRows.map((c) => ({
      coin: c.coin,
      n: c.n,
      'win%': pctS(c.win),
      payoff: `${c.payoff.toFixed(2)}:1`,
      expectancy: c.exp.toFixed(3),
      '95% CI': ciS(c),
    })),
  );
  const pos = coinRows.filter((c) => c.exp > 0).length;
  const total = hold.reduce((s, r) => s + netAt(r, C, BASE), 0);
  const top2 = coinRows.slice(0, 2).reduce((s, c) => s + c.exp * c.n, 0);
  console.log(
    `  ${pos}/${coinRows.length} coins positive · top 2 coins contribute ` +
      `${((top2 / total) * 100).toFixed(0)}% of total R ` +
      `${top2 / total > 0.6 ? '— CONCENTRATED' : '— broadly spread'}`,
  );

  console.log('\n   by structure at entry');
  console.table(
    [...byKey(hold, (r) => r.structure).entries()].map(([structure, rs]) => {
      const p = profileOf(rs, C, BASE);
      return {
        structure,
        n: p.n,
        'win%': pctS(p.win),
        payoff: `${p.payoff.toFixed(2)}:1`,
        expectancy: p.exp.toFixed(3),
        '95% CI': ciS(p),
      };
    }),
  );

  // ── 3. BTC backdrop ──
  const { BinanceService } = await import('../../src/market-data/market-data.service');
  const { CacheTelemetryService } = await import('../../src/market-data/cache-telemetry.service');
  const { btcRegimes, regimeAt } = await import('./holdout');
  const store = new Map<string, unknown>();
  const cache = {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
    del: (k: string) => Promise.resolve(store.delete(k)),
  } as never;
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const need = Math.ceil((t1 - t0) / 43_200_000) + 260;
  const btc = await binance.getCandlesPaged('BTC', '12h', need);
  const series = btcRegimes(btc.map((c) => c.close), btc.map((c) => c.time.getTime()));

  console.log('\n3. BTC BACKDROP — a trailing stop can live on trends and die in chop');
  console.table(
    [...byKey(hold, (r) => regimeAt(series, r.time, 43_200_000)).entries()]
      .sort()
      .map(([regime, rs]) => {
        const p = profileOf(rs, C, BASE);
        return {
          backdrop: regime,
          n: p.n,
          'win%': pctS(p.win),
          payoff: `${p.payoff.toFixed(2)}:1`,
          expectancy: p.exp.toFixed(3),
          '95% CI': ciS(p),
          blocks: p.blocks,
        };
      }),
  );

  // ── 4. cost stress ──
  console.log('\n4. COST STRESS — cost scales with each trade\'s own stop, so this is not a flat subtraction');
  console.table(
    [1, 1.5, 2, 3].map((k) => {
      const p = profileOf(hold, C, BASE * k);
      return {
        toll: `${k}x  (${(BASE * k).toFixed(2)}% round trip)`,
        'mean costR': avg(hold.map((r) => (BASE * k) / r.riskPercent)).toFixed(3),
        'win%': pctS(p.win),
        payoff: `${p.payoff.toFixed(2)}:1`,
        expectancy: p.exp.toFixed(3),
        '95% CI': ciS(p),
        'still positive?': p.exp > 0 ? 'yes' : 'NO',
      };
    }),
  );
}

if (require.main === module && process.argv.includes('--stress')) {
  const i = process.argv.indexOf('--stress');
  stress(process.argv[i + 1]).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
