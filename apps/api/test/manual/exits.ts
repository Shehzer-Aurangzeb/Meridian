/**
 * Exit-style arms, scored on IDENTICAL entries.
 *
 *   npx ts-node test/manual/exits.ts --report results/arms.csv --split tune
 *   npx ts-node test/manual/exits.ts --stress results/arms.csv --split tune
 *
 * --split is REQUIRED: tune | holdout | all. There is no default, and
 * --split holdout prints a banner saying the rows are now spent.
 *
 * Correctness lives in exits.spec.ts, under `pnpm test`.
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
import {
  aggregate,
  ScorablePlan,
  ScoringConfig,
  scoreRow,
  scoreTrade,
  TradeScore,
} from '../../src/common/replay/trade-scoring';
import { blockBootstrap } from './holdout';

export interface ArmSpec {
  name: string;
  /**
   * Bars allowed before the position is marked to market. UNDEFINED means
   * inherit the base run's `--max-bars`, which is what makes `BASE_check` a
   * real invariant rather than a copy of the number that happens to match.
   */
  maxBars?: number;
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
  /**
   * Close when the re-analysis stops supporting the trade, naming WHICH
   * reading of "no longer supports" to use.
   *
   * The signals themselves come from the caller — `backtest-plans.ts` knows
   * what the map looked like at every bar; this file only knows which one an
   * arm listens to. An arm whose signal is not supplied behaves exactly like
   * the base arm, which is what makes it safe to leave in the list when
   * reporting against an older CSV.
   */
  exitOnSignal?: 'zone-gone' | 'no-plan';
}

export const ARMS: ArmSpec[] = [
  // The control. Every parameter neutral and `maxBars` inherited, so it IS the
  // base trade — asserted bit-identical in exits.spec.ts. If it ever diverges,
  // this file has grown its own model again and no arm number means anything.
  { name: 'BASE_check', targetScale: 1, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'A_current', maxBars: 480, targetScale: 1, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'B2_wide2x', maxBars: 960, targetScale: 2, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'B3_wide3x', maxBars: 960, targetScale: 3, stopScale: 1, breakevenAfterTarget: 1, trail: false },
  { name: 'D_tight', maxBars: 120, targetScale: 1, stopScale: 0.5, breakevenAfterTarget: 1, trail: false },
  // Everything else here exits on PRICE. This one exits on the ANALYSIS: same
  // entries, same stop, same targets as BASE_check — the only difference is
  // that it closes when a later re-analysis no longer supports the trade.
  // BASE_check is therefore its exact control; the pair differ in one rule.
  // The zone the plan was built on is no longer marked anywhere in the map.
  {
    name: 'E_zonegone',
    targetScale: 1,
    stopScale: 1,
    breakevenAfterTarget: 1,
    trail: false,
    exitOnSignal: 'zone-gone',
  },
  // Stricter: the tool would not print this trade at all now. Fires far more
  // often, and for a reason worth knowing about — price moving INTO the zone
  // stops it being the nearest one on that side, so a trade going WELL can
  // trip this. Measured rather than assumed away.
  {
    name: 'E_noplan',
    targetScale: 1,
    stopScale: 1,
    breakevenAfterTarget: 1,
    trail: false,
    exitOnSignal: 'no-plan',
  },
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

/**
 * The longest hold any arm can ask for. The decision walk reserves
 * `FILL_BARS + max(MAX_BARS, MAX_ARM_BARS)` bars at the end of the series, so
 * no arm can read the still-forming candle — the 960-bar arms used to run 864
 * bars past the base trade's reserve and straight into it.
 *
 * Arms with no `maxBars` inherit the base config and are already covered by it.
 */
export const MAX_ARM_BARS = Math.max(0, ...ARMS.map((a) => a.maxBars ?? 0));

/**
 * Score one filled trade under one arm.
 *
 * `forward` is the SAME slice the base trade got — starting at the bar after
 * the decision bar, not after the fill — because every arm must re-derive the
 * entry through `scoreTrade` rather than be handed one. This file used to run
 * its own model: a single full-size fill at `averageEntry`, resolution starting
 * at `fillIdx + 1`, and targets allowed on the fill bar. All three were fixed
 * in the base path at CP1, CP3 and CP3.5, and none of the fixes reached here,
 * so `arms.csv` was comparing exit rules measured under different entry
 * assumptions.
 *
 * An arm is now nothing but a set of PARAMETERS to the shared scorer.
 */
export function scoreArm(
  forward: Candle[],
  plan: ScorablePlan,
  spec: ArmSpec,
  base: ScoringConfig,
  /**
   * "Has the analysis stopped supporting this trade by bar n of `forward`?",
   * one function per reading of the question. Supplied per trade by the
   * caller, and only the one an arm names is consulted. Omitted, an
   * `exitOnSignal` arm is the base arm.
   */
  signals?: Partial<Record<NonNullable<ArmSpec['exitOnSignal']>, (barIndex: number) => boolean>>,
): TradeScore {
  const long = plan.direction === 'long';
  const neutralStop = spec.stopScale === 1;
  const risk = neutralStop ? plan.riskPerUnit : plan.riskPerUnit * spec.stopScale;

  // At 1x the plan's own numbers are passed VERBATIM rather than recomputed.
  // `averageEntry − (averageEntry − stop)` is not bit-identical to `stop` in
  // floating point, and the BASE_check invariant has to be exact.
  const armPlan: ScorablePlan = {
    ...plan,
    stop: neutralStop
      ? plan.stop
      : long
        ? plan.averageEntry - risk
        : plan.averageEntry + risk,
    riskPerUnit: risk,
    riskPercent: neutralStop
      ? plan.riskPercent
      : plan.averageEntry === 0
        ? 0
        : (risk / plan.averageEntry) * 100,
    targets:
      spec.targetScale === null
        ? [] // trailing arms exit on the trail alone
        : spec.targetScale === 1
          ? plan.targets
          : plan.targets.map((t) => ({
              // Scale the DISTANCE from entry, keeping the side and the weights.
              price:
                plan.averageEntry +
                (t.price - plan.averageEntry) * (spec.targetScale as number),
              weightPercent: t.weightPercent,
            })),
  };

  // Cost is charged against THIS arm's stop distance, via `riskPercent` above.
  // A halved stop doubles the toll in R, which is why arm D cannot be compared
  // on R alone.
  return scoreTrade(forward, armPlan, {
    ...base,
    maxBars: spec.maxBars ?? base.maxBars,
    breakevenAfterTarget: spec.breakevenAfterTarget,
    // R stays normalised by the arm's initial risk, never by the trail, so a
    // wider trail cannot silently shrink every reported R.
    trailDistance: spec.trail ? risk * (spec.trailMult ?? 1) : undefined,
    exitSignal: spec.exitOnSignal ? signals?.[spec.exitOnSignal] : undefined,
  });
}

// The self-check block that lived here is now `exits.spec.ts`, run by `pnpm
// test` with the rest of the suite. It was checking `scoreTrailing`, which no
// longer exists — the trail is a parameter to `scoreTrade`.

// ── which rows ──────────────────────────────────────────────────────────

export type Split = 'tune' | 'holdout' | 'all';

/**
 * Chronological cut, matching `holdout.ts --tune`. Kept as a literal here
 * rather than imported because `holdout.ts` derives its own from argv at module
 * load; the two must agree, and `exits.spec.ts` asserts the boundary this
 * produces on the arms file's span.
 */
export const TUNE_FRACTION = 0.7;

export interface Selection<T> {
  split: Split;
  rows: T[];
  /** Span of the SELECTED rows. */
  from: number;
  to: number;
  /** Span of the whole file, and the boundary between the two halves. */
  spanFrom: number;
  spanTo: number;
  cut: number;
  total: number;
}

/**
 * Read the split off argv. There is NO default.
 *
 * Both entry points used to slice HOLDOUT silently — `report()` said so only in
 * its title, `stress()` printed TUNE and HOLDOUT side by side. Either way the
 * holdout got spent by anyone who typed the command without reading the source.
 * A run that will not start is the only version of this rule that holds.
 */
export function parseSplit(argv: string[]): Split {
  const i = argv.indexOf('--split');
  const value = i >= 0 ? argv[i + 1] : undefined;
  if (!value) {
    throw new Error(
      'refusing: --split is required, one of tune | holdout | all.\n' +
        '  --split tune     the oldest 70% by calendar time. Use this.\n' +
        '  --split holdout  the newest 30%. One shot, and it is spent afterwards.\n' +
        '  --split all      both, for a description of the file — never for a decision.\n' +
        'There is no default, because a silent default is how a holdout gets read by accident.',
    );
  }
  if (value !== 'tune' && value !== 'holdout' && value !== 'all') {
    throw new Error(`unknown --split ${value}; one of tune | holdout | all`);
  }
  return value;
}

/**
 * Cut a time-sorted set into the requested split.
 *
 * `tune` and `holdout` are disjoint and their union is `all` — asserted in
 * `exits.spec.ts`, because an off-by-one on `<` vs `<=` here would leak a
 * holdout row into every TUNE number quietly and permanently.
 */
export function selectSplit<T extends { time: number }>(
  all: T[],
  split: Split,
): Selection<T> {
  if (all.length === 0) throw new Error('no rows to split');
  const sorted = [...all].sort((a, b) => a.time - b.time);
  const spanFrom = sorted[0].time;
  const spanTo = sorted[sorted.length - 1].time;
  const cut = spanFrom + (spanTo - spanFrom) * TUNE_FRACTION;

  const rows =
    split === 'all'
      ? sorted
      : split === 'tune'
        ? sorted.filter((r) => r.time < cut)
        : sorted.filter((r) => r.time >= cut);

  return {
    split,
    rows,
    from: rows.length ? rows[0].time : NaN,
    to: rows.length ? rows[rows.length - 1].time : NaN,
    spanFrom,
    spanTo,
    cut,
    total: sorted.length,
  };
}

const day = (t: number): string =>
  Number.isNaN(t) ? '—' : new Date(t).toISOString().slice(0, 10);

/**
 * The banner every table prints. A number whose rows are unstated is not a
 * result, so this is not optional and not abbreviated.
 */
export function splitHeader<T>(title: string, source: string, sel: Selection<T>): string {
  const pct = sel.total === 0 ? 0 : (sel.rows.length / sel.total) * 100;
  const lines = [
    ``,
    `${title}`,
    `source   ${source}`,
    `file     ${day(sel.spanFrom)} → ${day(sel.spanTo)}  ${sel.total} trades  ` +
      `(cut at ${day(sel.cut)})`,
    `SPLIT    ${sel.split.toUpperCase()}  ${day(sel.from)} → ${day(sel.to)}  ` +
      `${sel.rows.length} trades (${pct.toFixed(0)}%), identical across every arm`,
  ];
  if (sel.split === 'holdout') {
    lines.push(
      ``,
      `  ######################################################################`,
      `  ##  HOLDOUT. These rows are spent the moment this prints.           ##`,
      `  ##  Every arm you see here has now been selected on. Nothing         ##`,
      `  ##  measured after this is out-of-sample, and re-running does not    ##`,
      `  ##  undo it.                                                         ##`,
      `  ######################################################################`,
    );
  }
  if (sel.split === 'all') {
    lines.push(
      ``,
      `  NOTE: --split all includes the holdout rows. Descriptive only —`,
      `  no arm may be chosen, tuned or killed on this output.`,
    );
  }
  return lines.join('\n') + '\n';
}

// ── report ──────────────────────────────────────────────────────────────

function report(path: string, split: Split): void {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  const all = lines
    .slice(head + 1)
    .map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter((r) => r.tier === 'PLAN')
    .map((r) => ({ time: new Date(r.time).getTime(), cells: r }));

  const sel = selectSplit(all, split);
  // Named for the split, not for a guess about which one. This function used
  // to hard-code the holdout half and say so only in its title.
  const rows = sel.rows;
  console.log(splitHeader('EXIT ARMS — SAME ENTRIES, DIFFERENT EXITS', path, sel));

  // One basis, not two. There used to be a "TIMEOUT at 0R" table beside a
  // marked-to-market one, and picking between them after the fact is how a
  // long-hold arm gets to choose the convention that suits it. `aggregate`
  // reports the mark AND the resolved-only figure on the same row, so the
  // choice is visible instead of offered.
  const n3 = (x: number): string => (Number.isNaN(x) ? '—' : x.toFixed(3));
  console.table(
    ARMS.map((a) => {
      const scored = rows.map((r) => ({
        status: r.cells[`${a.name}_status`],
        netR: Number(r.cells[`${a.name}_netR`]),
      }));
      const g = aggregate(scored);
      const pts = rows.map((r, i) => ({ time: r.time, value: scoreRow(scored[i]) }));
      const ci = blockBootstrap(pts, 14, 2000, 12345);
      return {
        arm: a.name,
        n: g.n,
        'win%': `${(g.winRate * 100).toFixed(1)}%`,
        'avg winner': n3(g.avgWin),
        'avg loser': n3(g.avgLose),
        PAYOFF: Number.isNaN(g.payoff) ? '—' : `${g.payoff.toFixed(2)}:1`,
        expectancy: n3(g.expectancy),
        '95% CI': `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
        open: g.unresolved,
        'open meanR': n3(g.unresolvedMeanR),
        'exp resolved': n3(g.expectancyResolved),
        gap: n3(g.markingGap),
        'med bars': median(rows.map((r) => Number(r.cells[`${a.name}_barsHeld`]))).toFixed(0),
      };
    }),
  );
  console.log('');

  // ── gross, cost, and the cost stress ────────────────────────────────────
  // An arm that only clears the toll at exactly the modelled fee is not an
  // edge, it is a bet on the fee. Each arm pays ITS OWN cost — a halved stop
  // doubles the toll in R — so this cannot be read off a single mean.
  console.log('cost sensitivity — each arm at multiples of the 0.14% round trip');
  console.table(
    ARMS.map((a) => {
      const gross = rows.map((r) => Number(r.cells[`${a.name}_r`]));
      const cost = rows.map((r) => Number(r.cells[`${a.name}_costR`]));
      const at = (k: number): number =>
        aggregate(
          rows.map((r) => ({
            status: r.cells[`${a.name}_status`],
            netR: netAt(r as Row, a.name, k),
          })),
        ).expectancy;
      return {
        arm: a.name,
        'gross R/trade': n3(avg(gross)),
        'cost R/trade': n3(avg(cost)),
        'exp @1x': n3(at(1)),
        'exp @1.5x': n3(at(1.5)),
        'exp @2x': n3(at(2)),
        'survives 1.5x?': at(1.5) > 0 ? 'yes' : 'NO',
      };
    }),
  );
  console.log('');

  console.log('payoff needed to break even at a given win rate:  payoff = (1-p)/p');
  console.log('  at 55% win -> 0.82:1 · at 50% -> 1.00:1 · at 45% -> 1.22:1 · at 40% -> 1.50:1');
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

// The --report entry point lives at the bottom of the file: `report` reads
// `avg` and `netAt`, which are declared below it, and calling it from here hit
// their temporal dead zone.

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
 * netR for one arm at a multiple of the base cost model.
 *
 * `costR = roundTripPct / riskPercent · filledFraction` is linear in
 * `roundTripPct`, so scaling THIS ARM'S OWN stored `costR` is both exact and
 * the only correct way to do it.
 *
 * It used to recompute the toll as `roundTripPct / r.riskPercent`, reading the
 * `riskPercent` COLUMN — which is the base plan's, not the arm's. That charged
 * `D_tight` (stopScale 0.5) half the toll it actually pays, and charged every
 * partially-filled trade for size it never acquired. Both errors flattered the
 * arms against the base, and both grew with the multiple.
 */
export const netAt = (r: Row, arm: string, multiple: number): number =>
  // Unresolved positions are marked to market and pay their toll like any
  // other, per `scoreRow`. They used to score a flat 0R here — no gain and no
  // cost — which silently rewarded whichever arm timed out most.
  scoreRow({
    status: r.cells[`${arm}_status`],
    netR: Number(r.cells[`${arm}_r`]) - Number(r.cells[`${arm}_costR`]) * multiple,
  });

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function profileOf(rows: Row[], arm: string, toll: number) {
  // Re-derived at `toll`, then handed to the shared aggregate. Nothing here
  // decides what a trade is worth.
  const scored = rows.map((r) => ({
    status: r.cells[`${arm}_status`],
    netR: netAt(r, arm, toll),
  }));
  const g = aggregate(scored);
  const ci = blockBootstrap(
    rows.map((r, i) => ({ time: r.time, value: scoreRow(scored[i]) })),
    14,
    2000,
    12345,
  );
  return {
    n: g.n,
    win: g.winRate,
    payoff: g.payoff,
    exp: g.expectancy,
    open: g.unresolved,
    openMeanR: g.unresolvedMeanR,
    expResolved: g.expectancyResolved,
    gap: g.markingGap,
    lo: ci.lo,
    hi: ci.hi,
    blocks: ci.blocks,
  };
}

const pctS = (x: number): string => `${(x * 100).toFixed(1)}%`;
const ciS = (p: { lo: number; hi: number }): string =>
  `[${p.lo.toFixed(3)}, ${p.hi.toFixed(3)}]`;

async function stress(path: string, split: Split): Promise<void> {
  const sel = selectSplit(loadRows(path), split);
  // ONE set of rows for every table below. The first table used to print a
  // TUNE column beside a HOLDOUT column, which meant reading the holdout was
  // the default behaviour of the command rather than a decision.
  const hold = sel.rows;
  // netAt takes a MULTIPLE of the run's own cost model, not a percentage.
  // `ROUND_TRIP_PCT` is for labels only — the arithmetic scales each arm's
  // stored costR, which already carries its stop scale and its filled size.
  const BASE = 1;
  const ROUND_TRIP_PCT = 0.25;

  console.log(splitHeader(`ARM C STRESS TESTS`, path, sel));

  // ── 1. trail distance surface ──
  console.log('1. TRAIL DISTANCE — plateau or spike?');
  console.table(
    TRAILS.map((name) => {
      const h = profileOf(hold, name, BASE);
      return {
        trail: `${ARMS.find((a) => a.name === name)!.trailMult}x risk`,
        split: sel.split,
        n: h.n,
        expectancy: h.exp.toFixed(3),
        payoff: `${h.payoff.toFixed(2)}:1`,
        'win%': pctS(h.win),
        open: h.open,
        'exp resolved': Number.isNaN(h.expResolved) ? '—' : h.expResolved.toFixed(3),
        '95% CI': ciS(h),
        'clears 0?': h.lo > 0 ? 'YES' : 'no',
      };
    }),
  );

  // ── 2. per coin and per structure ──
  console.log(`\n2. CONCENTRATION (${sel.split}) — is ${C} carried by a few coins or one structure?`);
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
  // Warm-up over the WHOLE file's span, not the split's — the 200-bar SMA has
  // to be running before the first selected trade, whichever split that is.
  const need = Math.ceil((sel.spanTo - sel.spanFrom) / 43_200_000) + 260;
  const btc = await binance.getCandlesPaged('BTC', '12h', need);
  const series = btcRegimes(btc.map((c) => c.close), btc.map((c) => c.time.getTime()));

  console.log(`\n3. BTC BACKDROP (${sel.split}) — a trailing stop can live on trends and die in chop`);
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
      const p = profileOf(hold, C, k);
      return {
        toll: `${k}x  (${(ROUND_TRIP_PCT * k).toFixed(2)}% round trip)`,
        'mean costR': avg(hold.map((r) => Number(r.cells[`${C}_costR`]) * k)).toFixed(3),
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
  stress(process.argv[i + 1], parseSplit(process.argv)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

if (require.main === module && process.argv.includes('--report')) {
  const i = process.argv.indexOf('--report');
  // parseSplit throws before anything is read, so a missing --split cannot
  // print a single number.
  report(process.argv[i + 1], parseSplit(process.argv));
  process.exit(0);
}
