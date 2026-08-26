/**
 * CP0 — build the golden set. Run ONCE, then never again.
 *
 *   npx ts-node scripts/golden-build.ts --bars 600
 *
 * Replays the plan backtest's decision walk and captures, for twenty trades,
 * everything needed to RE-SCORE them later without a network call:
 *
 *   input    the level-map outputs that feed `buildPlans` (zones, spot, atr)
 *   forward  the 1h candles after the decision bar, long enough to cover the
 *            fill window AND the hold window
 *   frozen   what the CURRENT code scores them as, today
 *
 * `golden-report.ts` rebuilds the plan from `input`, re-fills and re-scores it
 * against `forward` using whatever is in `src/` at that moment, and diffs the
 * result against `frozen`. Hermetic and deterministic: no Binance, no clock, no
 * database, so any movement is attributable to a code change and nothing else.
 *
 * ─── Extending ───────────────────────────────────────────────────────────
 *   npx ts-node scripts/golden-build.ts --extend --bars 2000
 *
 * Keeps every trade already in the set — same identity, same frozen inputs —
 * re-freezes their scored outputs at TODAY's code, and adds trades matching
 * whatever the set is currently blind to. CP1 needed this: all twenty original
 * members were sampled from a population where a fill meant price had reached
 * `averageEntry`, so eighteen of them fill 3/3 legs and cannot show a
 * partial-fill bug at all.
 *
 * Re-freezing is the point, not a compromise. The set measures ONE checkpoint
 * at a time; carrying stale numbers forward would report CP1's movement again
 * at CP2 and every checkpoint after it. The superseded file is archived beside
 * the new one.
 *
 * ─── Why this duplicates the harness walk ────────────────────────────────
 * `backtest-plans.ts` builds its plans inside a private loop and emits a CSV
 * that carries neither the zone edges nor the target ladder — so the golden set
 * cannot be reconstructed from its output. The walk is copied here rather than
 * refactored out of it, because CP0 is explicitly a no-code-change checkpoint
 * and carving a seam into the harness is a change.
 *
 * The copy is a build-time artifact and is run exactly once: after CP0 this
 * file never executes again, so it cannot drift into disagreeing with the
 * harness. Everything that RE-RUNS at each checkpoint (`findFirstFill`,
 * `scoreLadder`, `buildPlans`) is imported from `src/`, which is the code under
 * test.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../src/market-data/market-data.service';
import { CacheTelemetryService } from '../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../src/indicators/indicators.service';
import { SupportResistanceService } from '../src/analysis/services/support-resistance.service';
import {
  ATR_TIMEFRAME,
  LevelMapService,
  LEVEL_TIMEFRAMES,
} from '../src/analysis/services/level-map.service';
import { TradePlanService, ZoneState } from '../src/analysis/services/trade-plan.service';
import { CANDLE_LIMITS } from '../src/common/constants/timeframes';
import { Candle, TimeInterval } from '../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../src/common/replay/plan-replay';
import { ScoringConfig, scoreTrade } from '../src/common/replay/trade-scoring';
import { ConfluenceZone } from '../src/analysis/interfaces/support-resistance.types';
import { makeRng } from '../test/manual/rng';

Logger.overrideLogger(false);

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Same defaults as the frozen baseline's config line.
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,DOT,LINK,LTC')
  .split(',')
  .map((c) => c.trim().toUpperCase());
const BARS = num('bars', 600);
const FILL_BARS = num('fill-bars', 24);
const MAX_BARS = num('max-bars', 72);
const COOLDOWN = num('cooldown', 24);
// Stored per trade in the frozen file, so an existing set keeps the cost it
// was built with and a default change here cannot silently move the baseline.
const ROUND_TRIP_PCT = num('round-trip', 0.25);
const BREAKEVEN = num('breakeven', 1);
const STATES: ZoneState[] = ['ACTIONABLE'];
const OUT = str('out', 'test/manual/results/golden-set.json');
const SEED = num('seed', 20260815);
const EXTEND = args.includes('--extend');
/** How many one-leg and two-leg trades the extension adds. */
const WANT_ONE_LEG = num('one-leg', 5);
const WANT_TWO_LEG = num('two-leg', 5);

/** Forward bars kept per trade: worst-case fill at the end of the window, then a full hold. */
const FORWARD_BARS = FILL_BARS + MAX_BARS + 2;

const SCORING: ScoringConfig = {
  fillBars: FILL_BARS,
  maxBars: MAX_BARS,
  breakevenAfterTarget: BREAKEVEN,
  roundTripPct: ROUND_TRIP_PCT,
};

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

export interface GoldenTrade {
  id: string;
  coin: string;
  decisionTime: string;
  direction: 'long' | 'short';
  category: string[];
  /** Feeds `TradePlanService.buildPlans` — the whole plan is rebuilt from this. */
  input: { spot: number; atr: number; zones: ConfluenceZone[] };
  /** h1 candles from decisionIndex + 1 onward. `forward[0]` is the first fillable bar. */
  forward: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  config: {
    fillBars: number;
    maxBars: number;
    breakevenAfterTarget: number;
    roundTripPct: number;
  };
  /** What the code scored on the day the golden set was built. Never edited again. */
  frozen: {
    state: ZoneState;
    zone: { low: number; high: number; center: number; sources: number };
    entries: Array<{ price: number; weightPercent: number }>;
    averageEntry: number;
    stop: number;
    riskPercent: number;
    riskPerUnit: number;
    targets: Array<{ price: number; weightPercent: number; rMultiple: number }>;
    targetWeightSum: number;
    plannedR: number;
    legsFilled: number;
    filledFraction: number;
    fillPrice: number | null;
    fillTime: string | null;
    barsToFill: number | null;
    status: string;
    targetsHit: number;
    grossR: number;
    costR: number;
    netR: number;
    barsHeld: number;
  };
}

interface Candidate extends GoldenTrade {
  _sortKey: number;
}

async function runCoin(coin: string): Promise<Candidate[]> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();
  const supportResistance = new SupportResistanceService();
  const levelMap = new LevelMapService(binance, supportResistance, indicators);
  const planner = new TradePlanService();

  const series = await Promise.all(
    LEVEL_TIMEFRAMES.map(async (timeframe) => {
      const spanBars = Math.ceil((BARS * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[timeframe]);
      return {
        timeframe,
        candles: await binance.getCandlesPaged(
          coin,
          timeframe as TimeInterval,
          CANDLE_LIMITS[timeframe] + spanBars + 5,
        ),
      };
    }),
  );

  const h1 = series.find((s) => s.timeframe === '1h')?.candles ?? [];
  // Same bounds as the harness: the newest candle is still forming, so it can be
  // forward data but never a decision bar.
  const lastDecision = h1.length - 2;
  const firstDecision = Math.max(CANDLE_LIMITS['1h'], lastDecision - BARS + 1);

  const out: Candidate[] = [];
  const cooldownUntil: Record<'long' | 'short', number> = { long: -1, short: -1 };

  for (let i = firstDecision; i <= lastDecision; i += 1) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];

    const truncated = series.map((s) => ({
      timeframe: s.timeframe,
      candles: completedAsOf(s.candles, TIMEFRAME_MS[s.timeframe], asOf, CANDLE_LIMITS[s.timeframe]),
    }));
    if (truncated.some((t) => t.candles.length < 50)) continue;

    const atrCandles = truncated.find((t) => t.timeframe === ATR_TIMEFRAME)?.candles ?? [];
    const map = levelMap.buildFrom(coin, truncated, atrCandles);
    const plans = planner.buildPlans(map.zones, map.spot, map.atr);

    for (const plan of plans) {
      if (!STATES.includes(plan.state)) continue;
      if (i <= cooldownUntil[plan.direction]) continue;

      const forward = h1.slice(i + 1, i + 1 + FORWARD_BARS);
      const scored = scoreTrade(forward, plan, SCORING);
      if (!scored.filled) continue;
      const fillIdx = i + 1 + (scored.fillIndex as number);
      const weightSum = plan.targets.reduce((a, t) => a + t.weightPercent, 0);

      const category: string[] = [];
      if (scored.status === 'TIMEOUT') category.push('timeout');
      if (weightSum < 100) category.push('partial-weights');
      if (scored.status === 'STOPPED' || scored.status === 'PARTIAL') category.push('stopped');
      if (scored.targetsHit >= 1) category.push('reached-tp1');

      out.push({
        id: `${coin}-${h1[i].time.toISOString()}-${plan.direction}`,
        coin,
        decisionTime: h1[i].time.toISOString(),
        direction: plan.direction,
        category,
        input: { spot: map.spot, atr: map.atr, zones: map.zones },
        forward: forward.map((c) => ({
          time: c.time.toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        config: {
          fillBars: FILL_BARS,
          maxBars: MAX_BARS,
          breakevenAfterTarget: BREAKEVEN,
          roundTripPct: ROUND_TRIP_PCT,
        },
        frozen: {
          state: plan.state,
          zone: {
            low: plan.zone.low,
            high: plan.zone.high,
            center: plan.zone.center,
            sources: plan.zone.sources.length,
          },
          entries: plan.entries.map((e) => ({ price: e.price, weightPercent: e.weightPercent })),
          averageEntry: plan.averageEntry,
          stop: plan.stop,
          riskPercent: plan.riskPercent,
          riskPerUnit: plan.riskPerUnit,
          targets: plan.targets.map((t) => ({
            price: t.price,
            weightPercent: t.weightPercent,
            rMultiple: t.rMultiple,
          })),
          targetWeightSum: weightSum,
          plannedR: plan.blendedR,
          legsFilled: scored.legsFilled,
          filledFraction: scored.filledFraction,
          fillPrice: scored.entryPrice as number,
          fillTime: forward[scored.fillIndex as number].time.toISOString(),
          barsToFill: scored.barsToFill as number,
          status: scored.status,
          targetsHit: scored.targetsHit,
          grossR: scored.grossR,
          costR: scored.costR,
          netR: scored.netR,
          barsHeld: scored.barsHeld,
        },
        _sortKey: i,
      });

      cooldownUntil[plan.direction] =
        i + (scored.barsToFill as number) + scored.barsHeld + COOLDOWN;
    }
  }

  return out;
}

/**
 * Interleave candidates round-robin by coin, shuffled within each coin.
 *
 * Two problems being solved at once. Straight concatenation front-loads
 * whichever coin ran first, so the set ends up describing three symbols out of
 * ten. And walking each coin's candidates in index order takes the EARLIEST
 * matches, so all twenty land in the same few days at the start of the window —
 * one market regime, which is exactly the concentration that lets a
 * regime-dependent bug through.
 *
 * The shuffle is seeded, so the set is reproducible from this file alone.
 */
function interleave(pool: Candidate[], seed: number): Candidate[] {
  const byCoin = new Map<string, Candidate[]>();
  for (const c of pool) {
    const list = byCoin.get(c.coin);
    if (list) list.push(c);
    else byCoin.set(c.coin, [c]);
  }

  const rng = makeRng(seed);
  const queues = [...byCoin.values()].map((q) => {
    const a = [...q];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });

  const out: Candidate[] = [];
  for (let i = 0; out.length < pool.length; i += 1) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/** Take up to `want` from `pool` that satisfy `pred` and are not already chosen. */
function take(
  pool: Candidate[],
  chosen: Map<string, Candidate>,
  pred: (c: Candidate) => boolean,
  want: number,
): void {
  for (const c of pool) {
    if (chosen.has(c.id) || !pred(c)) continue;
    chosen.set(c.id, c);
    want -= 1;
    if (want <= 0) return;
  }
}

/**
 * Re-score one stored trade with today's code, keeping its inputs untouched.
 *
 * The same three lines `golden-report.ts` runs, which is the point: what the
 * report measures is what the set records.
 */
function refreeze(t: GoldenTrade): GoldenTrade {
  const planner = new TradePlanService();
  const candles: Candle[] = t.forward.map((c) => ({ ...c, time: new Date(c.time) }));
  const plans = planner.buildPlans(t.input.zones, t.input.spot, t.input.atr);
  const plan = plans.find((p) => p.direction === t.direction);
  if (!plan) throw new Error(`${t.id}: its plan no longer builds from the stored zones`);

  const scored = scoreTrade(candles, plan, t.config);
  if (!scored.filled) throw new Error(`${t.id}: no longer fills against its stored candles`);

  return {
    ...t,
    frozen: {
      state: plan.state,
      zone: {
        low: plan.zone.low,
        high: plan.zone.high,
        center: plan.zone.center,
        sources: plan.zone.sources.length,
      },
      entries: plan.entries.map((e) => ({ price: e.price, weightPercent: e.weightPercent })),
      averageEntry: plan.averageEntry,
      stop: plan.stop,
      riskPercent: plan.riskPercent,
      riskPerUnit: plan.riskPerUnit,
      targets: plan.targets.map((x) => ({
        price: x.price,
        weightPercent: x.weightPercent,
        rMultiple: x.rMultiple,
      })),
      targetWeightSum: plan.targets.reduce((a, x) => a + x.weightPercent, 0),
      plannedR: plan.blendedR,
      legsFilled: scored.legsFilled,
      filledFraction: scored.filledFraction,
      fillPrice: scored.entryPrice as number,
      fillTime: candles[scored.fillIndex as number].time.toISOString(),
      barsToFill: scored.barsToFill as number,
      status: scored.status,
      targetsHit: scored.targetsHit,
      grossR: scored.grossR,
      costR: scored.costR,
      netR: scored.netR,
      barsHeld: scored.barsHeld,
    },
  };
}

async function main(): Promise<void> {
  console.log(`\nGOLDEN SET BUILD — ${COINS.join('/')} bars=${BARS} fill=${FILL_BARS} hold=${MAX_BARS}\n`);

  const all: Candidate[] = [];
  for (const coin of COINS) {
    const t0 = Date.now();
    const trades = await runCoin(coin);
    all.push(...trades);
    console.log(`  ${coin.padEnd(5)} ${String(trades.length).padStart(3)} trades  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  console.log(`\n${all.length} candidate trades\n`);

  const pool = interleave(all, SEED);
  const chosen = new Map<string, Candidate>();
  const byId = new Map(all.map((c) => [c.id, c]));

  // Categories overlap, so the set is only honest if each is independently
  // covered. Declared before the selection so an extension can REPAIR a
  // shortfall rather than only discover one at the end.
  const coverage: Record<string, (c: Candidate) => boolean> = {
    timeout: (c) => c.frozen.status === 'TIMEOUT',
    'partial-weights': (c) => c.frozen.targetWeightSum < 100,
    stopped: (c) => c.frozen.status === 'STOPPED' || c.frozen.status === 'PARTIAL',
    'reached-tp1': (c) => c.frozen.targetsHit >= 1,
  };
  if (EXTEND) {
    coverage['one-leg fills'] = (c) => c.frozen.legsFilled === 1;
    coverage['two-leg fills'] = (c) => c.frozen.legsFilled === 2;
  }
  const MIN_PER_CATEGORY = 5;

  // ── extension: keep every existing member, re-frozen at today's code ─────
  let carried = 0;
  if (EXTEND) {
    const prior = JSON.parse(fs.readFileSync(OUT, 'utf8')) as { trades: GoldenTrade[] };
    fs.writeFileSync(
      OUT.replace(/\.json$/, `-superseded-${prior.trades.length}.json`),
      JSON.stringify(prior, null, 2),
    );
    for (const t of prior.trades) {
      // Re-scored from the trade's OWN frozen inputs, not by re-finding it in
      // the walk. A checkpoint that changes `barsToFill` shifts every cooldown
      // window after it, so a member can drop out of the live population while
      // remaining a perfectly good test case — its zones, its candles and its
      // config are all in the file. This is what makes the set hermetic.
      chosen.set(t.id, { ...refreeze(t), _sortKey: 0 });
      carried += 1;
    }
    console.log(`  carried ${carried} existing trades, re-frozen at current code`);

    // Preferred shape first — a partial fill on a 1- or 2-target plan is
    // exactly what C1 mangles — then top up from any partial fill if the
    // preferred pool is thin. `topUp` counts what is already in, so the
    // fallback cannot double the quota.
    // The quota counts NEW members only: two of the carried twenty already
    // fill two legs, and letting them satisfy the quota would ship 29 trades
    // when 30 were asked for.
    const carriedIds = new Set(chosen.keys());
    const topUp = (pred: (c: Candidate) => boolean, want: number): void => {
      const have = [...chosen.values()].filter(
        (c) => !carriedIds.has(c.id) && pred(c),
      ).length;
      if (have < want) take(pool, chosen, pred, want - have);
    };
    const oneLeg = (c: Candidate): boolean => c.frozen.legsFilled === 1;
    const twoLeg = (c: Candidate): boolean => c.frozen.legsFilled === 2;
    topUp((c) => oneLeg(c) && c.frozen.targets.length <= 2, WANT_ONE_LEG);
    topUp(oneLeg, WANT_ONE_LEG);
    topUp((c) => twoLeg(c) && c.frozen.targets.length <= 2, WANT_TWO_LEG);
    topUp(twoLeg, WANT_TWO_LEG);

    // A correctness fix DRAINS categories: CP2 and CP3.5 between them converted
    // half the set's TIMEOUTs into resolved trades, so a re-freeze that carried
    // only the existing members would have walked into CP4 — the checkpoint
    // that rewrites TIMEOUT scoring — with four TIMEOUTs to detect it with.
    // Refill from the current population instead of relaxing the guard, and say
    // so out loud, because this grows the set.
    for (const [name, pred] of Object.entries(coverage)) {
      const have = [...chosen.values()].filter(pred).length;
      if (have >= MIN_PER_CATEGORY) continue;
      console.log(`  coverage ${name} fell to ${have}; adding ${MIN_PER_CATEGORY - have}`);
      take(pool, chosen, pred, MIN_PER_CATEGORY - have);
    }
  } else {
    take(pool, chosen, (c) => c.frozen.status === 'TIMEOUT', 5);
    take(pool, chosen, (c) => c.frozen.targetWeightSum < 100, 5);
    take(pool, chosen, (c) => c.frozen.status === 'STOPPED' || c.frozen.status === 'PARTIAL', 5);
    take(pool, chosen, (c) => c.frozen.targetsHit >= 1, 5);
  }

  // Fail loudly rather than ship a thin category — the repair above may not
  // have found enough candidates.
  for (const [name, pred] of Object.entries(coverage)) {
    const n = [...chosen.values()].filter(pred).length;
    if (n < MIN_PER_CATEGORY) {
      throw new Error(`golden set covers only ${n} ${name} trades, need ${MIN_PER_CATEGORY}`);
    }
    console.log(`  coverage ${name.padEnd(16)} ${n}`);
  }

  const golden = [...chosen.values()]
    .sort((a, b) => (a.coin === b.coin ? a._sortKey - b._sortKey : a.coin.localeCompare(b.coin)))
    .map(({ _sortKey, ...t }) => t);

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        note: 'Frozen inputs + frozen scored outputs. Re-scored by scripts/golden-report.ts. Never edit `frozen`.',
        config: { coins: COINS, bars: BARS, seed: SEED, fillBars: FILL_BARS, maxBars: MAX_BARS, cooldown: COOLDOWN, roundTripPct: ROUND_TRIP_PCT, breakeven: BREAKEVEN, states: STATES },
        candidatePopulation: all.length,
        trades: golden,
      },
      null,
      2,
    ),
  );

  console.log(`wrote ${golden.length} trades to ${OUT}\n`);
  console.table(
    golden.map((t) => ({
      id: `${t.coin} ${t.decisionTime.slice(0, 16)}`,
      dir: t.direction,
      status: t.frozen.status,
      tgts: t.frozen.targets.length,
      'wt%': t.frozen.targetWeightSum,
      hit: t.frozen.targetsHit,
      netR: t.frozen.netR.toFixed(3),
      cats: t.category.join('+'),
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
