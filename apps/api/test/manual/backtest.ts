/**
 * Score-only backtest.
 *
 *   pnpm backtest BTC 1h
 *   pnpm backtest ETH 4h --rr 3 --atr 2 --max-bars 60
 *
 * Replays historical candles through the REAL pipeline (buildContext →
 * classifyFromContext → routeFromRegime) and scores what happened next.
 *
 * ─── What this measures ──────────────────────────────────────────────────
 * Whether the checklist SCORE has predictive power. It deliberately does not
 * call Claude, so entry/stop/target are derived from ATR rather than from a
 * trade plan. If the score is noise, no amount of prompt engineering on top
 * of it will help — that's the question this answers, cheaply.
 *
 * ─── Modelling choices (all conservative, all load-bearing) ──────────────
 *  1. Look-ahead: at candle i the pipeline sees candles[i-249 … i] — the same
 *     250-candle window `ANALYSIS_CANDLE_LIMIT` gives the live path. Asserted.
 *  2. Entry is the close of the signal candle. Live, Claude picks the entry.
 *  3. If a bar touches BOTH stop and target, it counts as a STOP. Intrabar
 *     order is unknowable from OHLC, so we take the pessimistic branch.
 *  4. One position at a time. Signals arriving while a trade is open are
 *     skipped and counted, not silently dropped.
 *  5. Costs are charged in R against every closed trade.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { ContinuousChecklistService } from '../../src/analysis/services/continuous-checklist.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { ChecklistStatus } from '../../src/analysis/interfaces/checklist.types';

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── args ────────────────────────────────────────────────────────────────
const [, , coinArg, tfArg, ...rest] = process.argv;
const flag = (name: string, fallback: number): number => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : fallback;
};

const coinsFlagIdx = rest.indexOf('--coins');
const COINS =
  coinsFlagIdx >= 0 && rest[coinsFlagIdx + 1]
    ? rest[coinsFlagIdx + 1].split(',').map((c) => c.trim().toUpperCase())
    : [(coinArg ?? 'BTC').toUpperCase()];
const timeframe = (tfArg ?? '1h') as TimeInterval;

// Paged via BinanceService.getCandlesPaged, so this is no longer capped at
// Binance's 1000/request. 250 candles are consumed as warm-up.
const LIMIT = flag('limit', 1000);
const ATR_MULT = flag('atr', 1.5); // stop distance = ATR × this
const RR = flag('rr', 2); // target = stop distance × this
const MAX_BARS = flag('max-bars', 48); // give up after N bars
// Cost model. At long holds the stop is wide and fees are a rounding error;
// at 20-minute holds the stop is tiny and the SAME fee can exceed 0.3R.
// So cost is derived per-trade from the actual stop distance rather than
// assumed flat. Defaults: Kraken futures taker 0.05%/side + 0.02% slippage.
const FEE_PCT = flag('fee', 0.05); // per side, %
const SLIP_PCT = flag('slip', 0.02); // per side, %
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);
const FLAT_COST = flag('cost', -1); // override with a flat R cost if > 0
const SCORER = rest.includes('--continuous') ? 'continuous' : 'binary';
const MIN_SCORE = flag('min-score', 0); // extra gate on top of the tier cut
const FOLDS = flag('folds', 0); // >0 splits the window into N sequential folds
const CSV = (() => {
  const i = rest.indexOf('--csv');
  return i >= 0 && rest[i + 1] ? rest[i + 1] : null;
})();

// Label horizon = max hold. The walk-forward skill's crypto rule is
// embargo >= 2x the label horizon; at 4h bars, 48 bars hold = 8 days,
// so the embargo is 96 bars / 16 days. Unused until we fit a parameter
// (nothing is currently tuned), but it defines the gap a train/test
// split must leave once we do.
const EMBARGO_BARS = MAX_BARS * 2;
const SQUEEZE_ARM_BARS = flag('arm', 12); // bars a squeeze stays armed

// Control experiment. Replaces the strategy with random entries at a
// matched rate, same exits, same costs. If the strategy cannot beat this,
// what looks like edge is just market drift (beta) captured by being long
// in a rising market.
const RANDOM = (() => {
  const i = rest.indexOf('--random');
  return i >= 0 ? (rest[i + 1] === 'match' ? 'match' : 'long') : null;
})();
const RANDOM_RATE = flag('random-rate', 0.025); // entries per eligible bar
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

type Outcome = 'WIN' | 'LOSS' | 'TIMEOUT';

interface Trade {
  index: number;
  time: Date;
  tier: ChecklistStatus;
  score: number;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  outcome: Outcome;
  r: number;
  barsHeld: number;
  exitIndex: number;
  coin: string;
  fundingBps: number | null; // funding rate at entry, in basis points
  fundingZ: number | null;   // vs trailing 90 funding periods (~30d)
  costR: number;             // round-trip cost as a fraction of 1R
}

/** Walk forward from the signal bar until stop, target, or MAX_BARS. */
function simulate(
  candles: Candle[],
  from: number,
  direction: 'long' | 'short',
  entry: number,
  stop: number,
  target: number,
): { outcome: Outcome; r: number; barsHeld: number; exitIndex: number } {
  const risk = Math.abs(entry - stop);

  for (let i = from + 1; i <= Math.min(from + MAX_BARS, candles.length - 1); i++) {
    const bar = candles[i];
    const hitStop =
      direction === 'long' ? bar.low <= stop : bar.high >= stop;
    const hitTarget =
      direction === 'long' ? bar.high >= target : bar.low <= target;

    // Pessimistic: a bar that spans both counts as a stop.
    if (hitStop) {
      return { outcome: 'LOSS', r: -1, barsHeld: i - from, exitIndex: i };
    }
    if (hitTarget) {
      return { outcome: 'WIN', r: RR, barsHeld: i - from, exitIndex: i };
    }
  }

  const exitIndex = Math.min(from + MAX_BARS, candles.length - 1);
  const exit = candles[exitIndex].close;
  const move = direction === 'long' ? exit - entry : entry - exit;
  return {
    outcome: 'TIMEOUT',
    r: risk === 0 ? 0 : move / risk,
    barsHeld: exitIndex - from,
    exitIndex,
  };
}

function summarise(label: string, trades: Trade[]) {
  if (trades.length === 0) {
    return { label, n: 0, winRate: '—', expectancy: '—', totalR: '—' };
  }
  const wins = trades.filter((t) => t.r > 0);
  const totalR = trades.reduce((a, t) => a + t.r - t.costR, 0);
  return {
    label,
    n: trades.length,
    winRate: `${((wins.length / trades.length) * 100).toFixed(1)}%`,
    expectancy: `${(totalR / trades.length).toFixed(3)}R`,
    totalR: `${totalR.toFixed(1)}R`,
  };
}

interface RunStats {
  trades: Trade[];
  signals: number;
  squeezeSkipped: number;
  squeezeExpired: number;
  squeezeTraded: number;
  overlapSkipped: number;
  scoreHistogram: Map<number, number>;
  testBars: number;
  span: string;
}

async function runCoin(coin: string): Promise<RunStats> {
  const indicators = new IndicatorsService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const regimeSvc = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    regimeSvc,
    new SqueezeBreakoutService(binance),
    SCORER === 'continuous' ? new ContinuousChecklistService() : new ChecklistService(),
    binance,
    indicators,
  );

  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);

  // Funding rate is published every 8h; forward-fill onto each bar.
  // Fetched from the first candle so every trade has a value available.
  let funding: Array<{ time: Date; rate: number }> = [];
  try {
    funding = await binance.getFundingRates(coin, candles[0].time.getTime());
  } catch {
    console.warn(`funding unavailable for ${coin} — continuing without it`);
  }
  const fundingTimes = funding.map((f) => f.time.getTime());

  /** Most recent funding print at/before `t`, plus its z-score. */
  const fundingAt = (
    t: number,
  ): { bps: number | null; z: number | null } => {
    if (funding.length === 0) return { bps: null, z: null };
    let lo = 0,
      hi = fundingTimes.length - 1,
      idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fundingTimes[mid] <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (idx < 0) return { bps: null, z: null };

    const rate = funding[idx].rate;
    const bps = rate * 10_000;

    const win = funding.slice(Math.max(0, idx - 90), idx + 1).map((f) => f.rate);
    if (win.length < 30) return { bps, z: null };
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(
      win.reduce((a, v) => a + (v - mean) ** 2, 0) / win.length,
    );
    return { bps, z: sd === 0 ? 0 : (rate - mean) / sd };
  };
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) {
    throw new Error(
      `Need more than ${ANALYSIS_CANDLE_LIMIT} candles to replay, got ${candles.length}`,
    );
  }

  const trades: Trade[] = [];
  const scoreHistogram = new Map<number, number>(); // score bucket → bars
  let squeezeSkipped = 0;
  let squeezeExpired = 0;
  let squeezeTraded = 0;
  let overlapSkipped = 0;
  let signals = 0;
  let openUntil = -1;

  const startedAt = Date.now();

  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    // Exactly the window the live path fetches — no more, no less.
    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    if (window.length !== ANALYSIS_CANDLE_LIMIT) {
      throw new Error(`look-ahead guard: window ${window.length} at i=${i}`);
    }

    const ctx = indicators.buildContext(coin, timeframe, window);

    if (RANDOM) {
      if (i <= openUntil || rng() > RANDOM_RATE) continue;
      signals++;
      const dir: 'long' | 'short' =
        RANDOM === 'long' ? 'long' : rng() < 0.5 ? 'long' : 'short';
      const rEntry = candles[i].close;
      const rRisk = ctx.atr * ATR_MULT;
      if (!Number.isFinite(rRisk) || rRisk <= 0) continue;
      const rStop = dir === 'long' ? rEntry - rRisk : rEntry + rRisk;
      const rTarget = dir === 'long' ? rEntry + rRisk * RR : rEntry - rRisk * RR;
      const rSim = simulate(candles, i, dir, rEntry, rStop, rTarget);
      openUntil = rSim.exitIndex;
      trades.push({
        index: i, time: candles[i].time, tier: 'RANDOM' as ChecklistStatus,
        score: -1, direction: dir, entry: rEntry, stop: rStop, target: rTarget,
        outcome: rSim.outcome, r: rSim.r, barsHeld: rSim.barsHeld,
        exitIndex: rSim.exitIndex, coin,
        costR: FLAT_COST > 0 ? FLAT_COST : ROUND_TRIP_PCT / ((rRisk / rEntry) * 100),
        fundingBps: null, fundingZ: null,
      });
      continue;
    }

    const regime = regimeSvc.classifyFromContext(ctx);
    const result = coordinator.routeFromRegime(ctx, timeframe, regime);

    if (result.checklistResult) {
      const raw = result.checklistResult.totalScore;
      const bucket = SCORER === 'continuous' ? Math.floor(raw / 5) * 5 : raw;
      scoreHistogram.set(bucket, (scoreHistogram.get(bucket) ?? 0) + 1);
    }

    if (!result.shouldInvokeAI) continue;
    signals++;

    // ── Squeeze route ────────────────────────────────────────────────
    // Direction isn't in the setup — it's decided by WHICH trigger breaks.
    // Apply the documented confirmation rule rather than guessing:
    //   LONG  = close strictly above upperTrigger AND volume > 1.5x baseline
    //   SHORT = close strictly below lowerTrigger AND volume > 1.5x baseline
    // Wicks don't qualify. If no confirmed break inside the armed window,
    // the setup expires unarmed.
    if (!result.checklistResult) {
      const sq = result.squeezeSetup;
      if (!sq || i <= openUntil) {
        squeezeSkipped++;
        continue;
      }
      const armEnd = Math.min(i + SQUEEZE_ARM_BARS, candles.length - 2);
      let fired = -1;
      let dir: 'long' | 'short' | null = null;
      for (let j = i + 1; j <= armEnd; j++) {
        const b = candles[j];
        if (b.volume <= sq.volumeMultiplier * sq.volumeBaseline) continue;
        if (b.close > sq.upperTriggerPrice) { fired = j; dir = 'long'; break; }
        if (b.close < sq.lowerTriggerPrice) { fired = j; dir = 'short'; break; }
      }
      if (fired < 0 || !dir) {
        squeezeExpired++;
        continue;
      }

      const sEntry = candles[fired].close;
      const sRisk = ctx.atr * ATR_MULT;
      if (!Number.isFinite(sRisk) || sRisk <= 0) continue;
      const sStop = dir === 'long' ? sEntry - sRisk : sEntry + sRisk;
      const sTarget = dir === 'long' ? sEntry + sRisk * RR : sEntry - sRisk * RR;
      const sSim = simulate(candles, fired, dir, sEntry, sStop, sTarget);
      openUntil = sSim.exitIndex;
      squeezeTraded++;

      trades.push({
        index: fired,
        time: candles[fired].time,
        tier: 'SQUEEZE' as ChecklistStatus,
        score: -1,
        direction: dir,
        entry: sEntry,
        stop: sStop,
        target: sTarget,
        outcome: sSim.outcome,
        r: sSim.r,
        barsHeld: sSim.barsHeld,
        exitIndex: sSim.exitIndex,
        coin,
        costR: FLAT_COST > 0 ? FLAT_COST : ROUND_TRIP_PCT / ((sRisk / sEntry) * 100),
        ...(() => {
          const f = fundingAt(candles[fired].time.getTime());
          return { fundingBps: f.bps, fundingZ: f.z };
        })(),
      });
      continue;
    }
    if (result.checklistResult.totalScore < MIN_SCORE) continue;
    if (i <= openUntil) {
      overlapSkipped++;
      continue;
    }

    const direction = result.checklistResult.tradeType;
    const entry = candles[i].close;
    const risk = ctx.atr * ATR_MULT;
    if (!Number.isFinite(risk) || risk <= 0) continue;

    const stop = direction === 'long' ? entry - risk : entry + risk;
    const target = direction === 'long' ? entry + risk * RR : entry - risk * RR;

    const sim = simulate(candles, i, direction, entry, stop, target);
    openUntil = sim.exitIndex;

    trades.push({
      index: i,
      time: candles[i].time,
      tier: result.checklistResult.status,
      score: result.checklistResult.totalScore,
      direction,
      entry,
      stop,
      target,
      outcome: sim.outcome,
      r: sim.r,
      barsHeld: sim.barsHeld,
      exitIndex: sim.exitIndex,
      coin,
      costR:
        FLAT_COST > 0
          ? FLAT_COST
          : ROUND_TRIP_PCT / ((risk / entry) * 100),
      ...(() => {
        const f = fundingAt(candles[i].time.getTime());
        return { fundingBps: f.bps, fundingZ: f.z };
      })(),
    });
  }

  return {
    trades,
    signals,
    squeezeSkipped,
    squeezeExpired,
    squeezeTraded,
    overlapSkipped,
    scoreHistogram,
    testBars: candles.length - ANALYSIS_CANDLE_LIMIT,
    span: `${candles[ANALYSIS_CANDLE_LIMIT - 1].time.toISOString().slice(0, 10)} → ${candles[candles.length - 1].time.toISOString().slice(0, 10)}`,
  };
}

async function main() {
  const startedAt = Date.now();
  const runs: Array<{ coin: string; stats: RunStats }> = [];
  for (const c of COINS) {
    runs.push({ coin: c, stats: await runCoin(c) });
  }

  const trades = runs.flatMap((r) => r.stats.trades);
  const signals = runs.reduce((a, r) => a + r.stats.signals, 0);
  const squeezeSkipped = runs.reduce((a, r) => a + r.stats.squeezeSkipped, 0);
  const squeezeExpired = runs.reduce((a, r) => a + r.stats.squeezeExpired, 0);
  const squeezeTraded = runs.reduce((a, r) => a + r.stats.squeezeTraded, 0);
  const overlapSkipped = runs.reduce((a, r) => a + r.stats.overlapSkipped, 0);
  const scoreHistogram = new Map<number, number>();
  for (const r of runs) {
    for (const [k, v] of r.stats.scoreHistogram) {
      scoreHistogram.set(k, (scoreHistogram.get(k) ?? 0) + v);
    }
  }
  const testBars = runs.reduce((a, r) => a + r.stats.testBars, 0);
  const span = runs[0].stats.span;
  const coin = COINS.length === 1 ? COINS[0] : `${COINS.length} coins`;

  // ── report ────────────────────────────────────────────────────────────
  console.log(`\n${coin} · ${timeframe} · ${testBars} test bars · ${span}`);
  console.log(
    `scorer ${SCORER}${MIN_SCORE ? ` · min-score ${MIN_SCORE}` : ''} · stop ATR×${ATR_MULT} · target ${RR}R · max hold ${MAX_BARS} bars`,
  );
  console.log(
    FLAT_COST > 0
      ? `cost: flat ${FLAT_COST}R/trade`
      : `cost: ${FEE_PCT}% fee + ${SLIP_PCT}% slip per side = ${ROUND_TRIP_PCT.toFixed(3)}% round trip, charged against each trade's stop distance`,
  );
  console.log(
    `\n${signals} signals → ${trades.length} traded ` +
      `(${overlapSkipped} skipped: position already open · squeeze: ${squeezeTraded} confirmed, ${squeezeExpired} expired unarmed, ${squeezeSkipped} blocked)`,
  );

  const checklistBars = [...scoreHistogram.values()].reduce((a, b) => a + b, 0);
  console.log('\n── score distribution (all checklist-routed bars) ' + '─'.repeat(12));
  console.table(
    [...scoreHistogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([score, bars]) => ({
        score,
        bars,
        pct: `${((bars / checklistBars) * 100).toFixed(1)}%`,
        bar: '█'.repeat(Math.round((bars / checklistBars) * 60)),
      })),
  );

  if (trades.length === 0) {
    console.log('\nNo trades. Nothing to measure.');
    return;
  }

  if (runs.length > 1) {
    console.log('── by coin ' + '─'.repeat(50));
    console.table(runs.map((r) => summarise(r.coin, r.stats.trades)));
  }

  console.log('\n── by tier ' + '─'.repeat(50));
  console.table(
    (['APEX_SETUP', 'STRATEGIC_TRADE', 'TACTICAL_SETUP', 'SQUEEZE' as ChecklistStatus] as ChecklistStatus[])
      .map((tier) => summarise(tier, trades.filter((t) => t.tier === tier)))
      .concat(summarise('ALL', trades)),
  );

  // The decisive question: does a higher score produce a better outcome?
  const width = SCORER === 'continuous' ? 10 : 20;
  const buckets = new Map<number, Trade[]>();
  for (const t of trades) {
    const b = Math.floor(t.score / width) * width;
    (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(t);
  }
  console.log('── by score bucket (does the score rank?) ' + '─'.repeat(20));
  console.table(
    [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, ts]) => summarise(`${b}-${b + width - 1}`, ts)),
  );

  // ── Walk-forward folds: is the result stable, or one lucky stretch? ──
  // Trades are assigned to the fold containing their ENTRY. A trade whose
  // exit crosses the fold boundary is PURGED — counting it would let one
  // fold's result depend on price action belonging to the next.
  if (FOLDS > 1) {
    const barsPerFold = Math.floor((runs[0].stats.testBars || 1) / FOLDS);
    const folds: Trade[][] = Array.from({ length: FOLDS }, () => []);
    let purged = 0;

    for (const t of trades) {
      const rel = t.index - (ANALYSIS_CANDLE_LIMIT - 1);
      const f = Math.min(FOLDS - 1, Math.floor(rel / barsPerFold));
      const foldEnd = (f + 1) * barsPerFold + (ANALYSIS_CANDLE_LIMIT - 1);
      if (t.exitIndex >= foldEnd) {
        purged++; // straddles the boundary
        continue;
      }
      folds[f].push(t);
    }

    console.log(
      `── walk-forward: ${FOLDS} folds ` +
        `(~${barsPerFold} bars each, ${purged} trades purged at boundaries) ` +
        '─'.repeat(6),
    );
    console.table(folds.map((f, i) => summarise(`fold ${i + 1}`, f)));

    const exps = folds
      .filter((f) => f.length >= 10)
      .map((f) => f.reduce((a, t) => a + t.r - t.costR, 0) / f.length);
    if (exps.length >= 2) {
      const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
      const sd = Math.sqrt(
        exps.reduce((a, e) => a + (e - mean) ** 2, 0) / exps.length,
      );
      const positive = exps.filter((e) => e > 0).length;
      console.log(
        `folds with n>=10: ${exps.length} · positive: ${positive}/${exps.length} · ` +
          `mean ${mean.toFixed(3)}R · spread(sd) ${sd.toFixed(3)}R`,
      );
      console.log(
        sd > Math.abs(mean)
          ? '→ fold-to-fold spread exceeds the mean. Consistent with noise.'
          : '→ mean exceeds fold-to-fold spread. Worth a closer look.',
      );
    }
  }

  if (CSV) {
    const fs = require('fs') as typeof import('fs');
    const rows = [
      'coin,time,index,exitIndex,tier,score,direction,entry,stop,target,outcome,r,barsHeld,costR',
      ...trades.map((t) =>
        [
          t.coin,
          t.time.toISOString(),
          t.index,
          t.exitIndex,
          t.tier,
          t.score,
          t.direction,
          t.entry,
          t.stop,
          t.target,
          t.outcome,
          t.r,
          t.barsHeld,
          t.costR,
        ].join(','),
      ),
    ];
    fs.writeFileSync(CSV, rows.join('\n'));
    console.log(`\nwrote ${trades.length} trades → ${CSV}`);
  }

  // ── Does funding rate rank outcomes? (measure before integrating) ────
  const withF = trades.filter((t) => t.fundingBps !== null);
  if (withF.length > 50) {
    const band = (b: number) =>
      b < -0.5 ? '1 <-0.5bp (shorts pay)'
      : b < 0.5 ? '2 -0.5..0.5bp (flat)'
      : b < 2   ? '3 0.5..2bp (mild long)'
      : b < 5   ? '4 2..5bp (crowded long)'
      :           '5 >5bp (very crowded)';

    const byBand = new Map<string, Trade[]>();
    for (const t of withF) {
      const k = band(t.fundingBps!);
      (byBand.get(k) ?? byBand.set(k, []).get(k)!).push(t);
    }

    console.log('── by funding rate at entry ' + '─'.repeat(33));
    console.table(
      [...byBand.entries()].sort().map(([k, ts]) => summarise(k, ts)),
    );

    console.log('── funding × direction ' + '─'.repeat(38));
    console.table(
      [...byBand.entries()].sort().flatMap(([k, ts]) => [
        summarise(`${k} · long`, ts.filter((t) => t.direction === 'long')),
        summarise(`${k} · short`, ts.filter((t) => t.direction === 'short')),
      ]),
    );

    // Correlation between funding and realised R — the compact version of
    // the same question. |r| under ~0.05 means no usable relationship.
    const xs = withF.map((t) => t.fundingBps!);
    const ys = withF.map((t) => t.r - t.costR);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const corr = num / Math.sqrt(dx * dy);
    console.log(
      `corr(funding, R) = ${corr.toFixed(4)} over ${withF.length} trades ` +
        `→ ${Math.abs(corr) < 0.05 ? 'no usable relationship' : 'worth investigating'}`,
    );
  }

  console.log('── by direction ' + '─'.repeat(45));
  console.table([
    summarise('long', trades.filter((t) => t.direction === 'long')),
    summarise('short', trades.filter((t) => t.direction === 'short')),
  ]);

  const outcomes = { WIN: 0, LOSS: 0, TIMEOUT: 0 };
  for (const t of trades) outcomes[t.outcome]++;
  console.log('── outcomes ' + '─'.repeat(49));
  console.table(outcomes);

  const costs = trades.map((t) => t.costR).sort((a, b) => a - b);
  const medCost = costs[Math.floor(costs.length / 2)];
  const avgBars = trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length;
  console.log(
    `\nmedian cost ${medCost.toFixed(3)}R/trade · avg hold ${avgBars.toFixed(1)} bars`,
  );

  const totalR = trades.reduce((a, t) => a + t.r - t.costR, 0);
  const expectancy = totalR / trades.length;
  console.log(
    `\nEXPECTANCY  ${expectancy.toFixed(3)}R/trade   (${totalR.toFixed(1)}R total over ${trades.length} trades)`,
  );
  console.log(
    expectancy > 0
      ? '→ positive. Necessary, not sufficient: needs walk-forward + out-of-sample before it means anything.'
      : '→ negative. The score does not predict outcome under these exit rules.',
  );
  console.log(`\nreplayed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
