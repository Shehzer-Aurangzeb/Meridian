/**
 * Plan backtest — replays what `pnpm analyze` ACTUALLY PRINTS.
 *
 *   pnpm backtest:plans BTC
 *   pnpm backtest:plans --coins BTC,ETH,SOL --bars 1200
 *   pnpm backtest:plans BTC --states ACTIONABLE,APPROACHING --random
 *
 * ─── Why this exists next to backtest.ts rather than inside it ────────────
 * backtest.ts scores the 5-condition CHECKLIST with an ATR-derived stop and a
 * fixed R target. The analysis path no longer emits that: `analyze` prints a
 * confluence zone, a three-step entry ladder, a stop one ATR beyond the zone,
 * and targets at the next zones. Those are different trades with different
 * geometry, so a number from backtest.ts says nothing about the tool as it
 * stands. This harness rebuilds the level map as of each historical bar and
 * scores the plan the tool would have printed then.
 *
 * ─── What is measured ────────────────────────────────────────────────────
 * For every 1h bar, the map is rebuilt from ONLY completed candles as of that
 * bar (12h/4h/1h at their live CANDLE_LIMITS), plans are built for both
 * directions, and any plan in an eligible distance state is taken if price
 * subsequently reaches its average entry. Exits follow the printed ladder.
 *
 * ─── Modelling choices, all conservative, all load-bearing ───────────────
 *  1. No look-ahead: `completedAsOf` requires open + duration <= the decision
 *     bar's close. A forming 12h candle already contains the future. Asserted
 *     in plan-replay.spec.ts and again at runtime on the first bar.
 *  2. Fill requires price to TOUCH the plan's average entry within --fill-bars.
 *     ponytail: one fill at the weighted-average price rather than three
 *     tranche fills — the reported R is computed off that same average, so
 *     this is the self-consistent simplification. Per-tranche accounting is
 *     the upgrade if partial fills start mattering.
 *  3. Stop before target inside a bar; breakeven after TP1; open weight marked
 *     to market at the window end (see scoreLadder).
 *  4. Cost = round-trip % / risk % — charged in R per closed trade, so a plan
 *     with a 0.5% stop pays four times what a 2% stop pays. Fees are
 *     proportional to size, so a laddered exit pays the same total as one.
 *  5. One position at a time PER DIRECTION, plus --cooldown bars after a close.
 *     A zone stays eligible for many consecutive bars; without this, one zone
 *     becomes twenty near-identical trades and n is fiction.
 *  6. --random replaces the distance-state trigger with entries at random
 *     bars, matched in count, same geometry, same costs. Crypto trended hard
 *     over any window; only the delta against this is edge.
 *
 * Every result must be quoted with the config line this prints. A number whose
 * configuration is lost is not a result (docs/STATE_OF_PLAY.md §14c).
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import {
  ATR_TIMEFRAME,
  LevelMapService,
  LEVEL_TIMEFRAMES,
} from '../../src/analysis/services/level-map.service';
import { TradePlanService, TradePlan, ZoneState } from '../../src/analysis/services/trade-plan.service';
import { CANDLE_LIMITS } from '../../src/common/constants/timeframes';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { findFirstFill } from '../../src/common/replay/replay';
import { completedAsOf, scoreLadder, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { makeRng } from './rng';

// Per-bar map builds log three lines each at debug level. 1000 bars of that
// buries the result.
Logger.overrideLogger(false);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── args ────────────────────────────────────────────────────────────────
// Flags are searched across the WHOLE argument list, and the leading symbol is
// only a symbol if it is not a flag. Splitting positional from flags first and
// then searching the tail is how `--coins BTC,ETH` becomes a request for the
// symbol "--COINS".
const args = process.argv.slice(2);
const coinArg = args[0]?.startsWith('--') ? undefined : args[0];
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COINS = str('coins', coinArg ?? 'BTC')
  .split(',')
  .map((c) => c.trim().toUpperCase());
const BARS = num('bars', 600); // 1h decision bars to walk
const STEP = num('step', 1); // walk every Nth bar
const FILL_BARS = num('fill-bars', 24); // give up if the zone is not reached
const MAX_BARS = num('max-bars', 72); // give up on an open position
const COOLDOWN = num('cooldown', 24); // bars after a close before re-entering
const FEE_PCT = num('fee', 0.05); // per side, %
const SLIP_PCT = num('slip', 0.02); // per side, %
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);
const STATES = str('states', 'ACTIONABLE')
  .split(',')
  .map((s) => s.trim().toUpperCase()) as ZoneState[];
const RANDOM = args.includes('--random');
const SEED = num('seed', 12345);
const CSV = str('csv', '');

const CONFIG =
  `coins=${COINS.join('/')} bars=${BARS} step=${STEP} states=${STATES.join('+')} ` +
  `fill-bars=${FILL_BARS} max-bars=${MAX_BARS} cooldown=${COOLDOWN} ` +
  `fee=${FEE_PCT}% slip=${SLIP_PCT}% (round trip ${ROUND_TRIP_PCT}%)` +
  `${RANDOM ? ` random-control seed=${SEED}` : ''}`;

interface Trade {
  coin: string;
  tier: 'PLAN' | 'RANDOM';
  direction: 'long' | 'short';
  /** Named `time` and `r` (gross) so bootstrap.ts reads this CSV unmodified. */
  time: Date;
  state: ZoneState;
  sources: number;
  entry: number;
  stop: number;
  riskPercent: number;
  plannedR: number;
  r: number;
  costR: number;
  netR: number;
  status: string;
  targetsHit: number;
  barsToFill: number;
  barsHeld: number;
}

/** Everything about one bar's decision, kept so the control can reuse it. */
interface Signal {
  index: number;
  plan: TradePlan;
}

function tryTrade(
  coin: string,
  tier: Trade['tier'],
  h1: Candle[],
  index: number,
  plan: TradePlan,
): Trade | null {
  const action = plan.direction === 'long' ? 'LONG' : 'SHORT';

  // Fill scan starts at index+1: the bar whose close built the plan cannot
  // also be the bar that fills it.
  const window = h1.slice(index + 1, index + 1 + FILL_BARS);
  const fill = findFirstFill(window, action, plan.averageEntry);
  if (!fill) return null;

  const fillIdx = index + 1 + window.indexOf(fill);
  const post = h1.slice(fillIdx + 1, fillIdx + 1 + MAX_BARS);
  const scored = scoreLadder(post, {
    direction: plan.direction,
    averageEntry: plan.averageEntry,
    stop: plan.stop,
    riskPerUnit: plan.riskPerUnit,
    targets: plan.targets,
  });

  const costR = plan.riskPercent === 0 ? 0 : ROUND_TRIP_PCT / plan.riskPercent;

  return {
    coin,
    tier,
    direction: plan.direction,
    time: h1[index].time,
    state: plan.state,
    sources: plan.zone.sources.length,
    entry: plan.averageEntry,
    stop: plan.stop,
    riskPercent: plan.riskPercent,
    plannedR: plan.blendedR,
    r: scored.realizedR,
    costR,
    netR: scored.realizedR - costR,
    status: scored.status,
    targetsHit: scored.targetsHit,
    barsToFill: fillIdx - index,
    barsHeld: scored.barsHeld,
  };
}

async function runCoin(coin: string): Promise<{
  trades: Trade[];
  bars: number;
  eligible: number;
  noFill: number;
  window: [Date, Date];
}> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const levelMap = new LevelMapService(
    binance,
    new SupportResistanceService(),
    new IndicatorsService(),
  );
  const planner = new TradePlanService();

  // Each timeframe needs its live window PLUS the replay span, so the oldest
  // decision bar sees exactly as much history as a live call would.
  const series = await Promise.all(
    LEVEL_TIMEFRAMES.map(async (timeframe) => {
      const spanBars = Math.ceil(
        (BARS * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[timeframe],
      );
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
  // The newest candle is still forming; it can be forward data but never a
  // decision bar.
  const lastDecision = h1.length - 2;
  const firstDecision = Math.max(CANDLE_LIMITS['1h'], lastDecision - BARS + 1);

  const trades: Trade[] = [];
  const allSignals: Record<'long' | 'short', Signal[]> = { long: [], short: [] };
  const cooldownUntil: Record<'long' | 'short', number> = { long: -1, short: -1 };
  let bars = 0;
  let eligible = 0;
  let noFill = 0;
  let asserted = false;

  for (let i = firstDecision; i <= lastDecision; i += STEP) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];

    const truncated = series.map((s) => ({
      timeframe: s.timeframe,
      candles: completedAsOf(
        s.candles,
        TIMEFRAME_MS[s.timeframe],
        asOf,
        CANDLE_LIMITS[s.timeframe],
      ),
    }));
    if (truncated.some((t) => t.candles.length < 50)) continue;

    if (!asserted) {
      // Runtime look-ahead guard, on real data rather than fixtures: no series
      // may contain a candle that had not closed, and the 1h series must end
      // exactly on the decision bar.
      for (const t of truncated) {
        const last = t.candles[t.candles.length - 1];
        const closesAt = last.time.getTime() + TIMEFRAME_MS[t.timeframe];
        if (closesAt > asOf) {
          throw new Error(
            `look-ahead: ${t.timeframe} candle closing ${new Date(closesAt).toISOString()} ` +
              `visible at ${new Date(asOf).toISOString()}`,
          );
        }
      }
      const lastH1 = truncated.find((t) => t.timeframe === '1h')?.candles.slice(-1)[0];
      if (lastH1?.time.getTime() !== h1[i].time.getTime()) {
        throw new Error('look-ahead: 1h series does not end on the decision bar');
      }
      asserted = true;
    }

    const atrCandles =
      truncated.find((t) => t.timeframe === ATR_TIMEFRAME)?.candles ?? [];
    const map = levelMap.buildFrom(coin, truncated, atrCandles);
    const plans = planner.buildPlans(map.zones, map.spot, map.atr);
    bars += 1;

    for (const plan of plans) {
      allSignals[plan.direction].push({ index: i, plan });

      if (!STATES.includes(plan.state)) continue;
      eligible += 1;
      if (i <= cooldownUntil[plan.direction]) continue;

      const trade = tryTrade(coin, 'PLAN', h1, i, plan);
      if (!trade) {
        noFill += 1;
        continue;
      }
      trades.push(trade);
      cooldownUntil[plan.direction] =
        i + trade.barsToFill + trade.barsHeld + COOLDOWN;
    }
  }

  // ── control: same geometry, random timing, matched count ───────────────
  if (RANDOM) {
    const rng = makeRng(SEED);
    for (const direction of ['long', 'short'] as const) {
      const taken = trades.filter(
        (t) => t.tier === 'PLAN' && t.direction === direction,
      ).length;
      const pool = allSignals[direction];
      // ponytail: sampled independently, without the one-at-a-time rule — this
      // is a distribution to compare against, not a portfolio to run.
      for (let n = 0; n < taken && pool.length > 0; n += 1) {
        const pick = pool[Math.floor(rng() * pool.length)];
        const trade = tryTrade(coin, 'RANDOM', h1, pick.index, pick.plan);
        if (trade) trades.push(trade);
      }
    }
  }

  return {
    trades,
    bars,
    eligible,
    noFill,
    window: [h1[firstDecision].time, h1[lastDecision].time],
  };
}

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

function summarise(label: string, trades: Trade[]): Record<string, string | number> {
  const net = trades.map((t) => t.netR);
  const wins = net.filter((r) => r > 0).length;
  return {
    group: label,
    n: trades.length,
    'win%': trades.length === 0 ? '—' : `${((wins / trades.length) * 100).toFixed(0)}%`,
    'net R/trade': mean(net).toFixed(3),
    'total R': net.reduce((a, b) => a + b, 0).toFixed(1),
    'gross R/trade': mean(trades.map((t) => t.r)).toFixed(3),
    'cost R/trade': mean(trades.map((t) => t.costR)).toFixed(3),
    'planned R': mean(trades.map((t) => t.plannedR)).toFixed(2),
    'risk%': mean(trades.map((t) => t.riskPercent)).toFixed(2),
    bars: Math.round(mean(trades.map((t) => t.barsHeld))),
  };
}

async function main(): Promise<void> {
  console.log(`\nPLAN BACKTEST — replays the printed trade plan`);
  console.log(`config  ${CONFIG}\n`);

  const all: Trade[] = [];

  for (const coin of COINS) {
    const startedAt = Date.now();
    const { trades, bars, eligible, noFill, window } = await runCoin(coin);
    all.push(...trades);
    const plan = trades.filter((t) => t.tier === 'PLAN');
    console.log(
      `${coin.padEnd(4)} ${bars} bars ` +
        `${window[0].toISOString().slice(0, 10)} → ${window[1].toISOString().slice(0, 10)} · ` +
        `${eligible} eligible plan(s) · ${plan.length} taken · ${noFill} never reached entry · ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  }

  const plan = all.filter((t) => t.tier === 'PLAN');
  if (plan.length === 0) {
    console.log('\nNo trades. Widen --states or --bars.');
    return;
  }

  console.log('');
  console.table([
    summarise('ALL PLANS', plan),
    summarise('  long', plan.filter((t) => t.direction === 'long')),
    summarise('  short', plan.filter((t) => t.direction === 'short')),
    ...COINS.map((c) => summarise(`  ${c}`, plan.filter((t) => t.coin === c))),
  ]);

  const byStatus = ['ALL_TARGETS', 'PARTIAL', 'TIMEOUT', 'STOPPED'].map((s) => ({
    status: s,
    n: plan.filter((t) => t.status === s).length,
    'share%': `${((plan.filter((t) => t.status === s).length / plan.length) * 100).toFixed(0)}%`,
    'net R/trade': mean(plan.filter((t) => t.status === s).map((t) => t.netR)).toFixed(2),
  }));
  console.table(byStatus);

  if (RANDOM) {
    const control = all.filter((t) => t.tier === 'RANDOM');
    console.log('\ncontrol — same plans, random timing');
    console.table([
      summarise('PLAN', plan),
      summarise('RANDOM', control),
      summarise('  random long', control.filter((t) => t.direction === 'long')),
      summarise('  random short', control.filter((t) => t.direction === 'short')),
    ]);
    console.log(
      `\nedge over random: ${(mean(plan.map((t) => t.netR)) - mean(control.map((t) => t.netR))).toFixed(3)}R/trade`,
    );
  }

  if (CSV) {
    const keys = Object.keys(plan[0]) as Array<keyof Trade>;
    const write = (path: string, rows: Trade[]): void => {
      fs.writeFileSync(
        path,
        `# ${CONFIG}\n${keys.join(',')}\n` +
          rows
            .map((t) =>
              keys
                .map((k) => (t[k] instanceof Date ? (t[k] as Date).toISOString() : t[k]))
                .join(','),
            )
            .join('\n'),
      );
      console.log(`wrote ${rows.length} trades to ${path} (config on line 1)`);
    };

    // Split by tier: bootstrap.ts takes strategy and control as two files, and
    // its columns are `time` / `r` / `costR`, which is why they are named that.
    console.log('');
    write(CSV, plan);
    const control = all.filter((t) => t.tier === 'RANDOM');
    if (control.length > 0) write(CSV.replace(/\.csv$/, '') + '.random.csv', control);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
