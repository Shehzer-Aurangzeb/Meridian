/**
 * LIGHT ZONE TEST — the §14b hypothesis, minimum viable version.
 *
 *   npx ts-node test/manual/zonetest.ts x 1d --coins BTC,ETH,... --csv out.csv
 *   npx ts-node test/manual/zonetest.ts --self-check
 *
 * ─── The hypothesis ─────────────────────────────────────────────────────
 * The 5-point checklist is a CONFIRMATION FILTER applied after price
 * arrives at a pre-marked zone. We previously wired it as a SCANNER that
 * fires whenever the score crosses a tier. This tests the inversion:
 *
 *   mark zones in advance → wait for price to arrive → confirm → enter
 *
 * ─── Every parameter is read from the playbook. NONE are tuned. ─────────
 * Declared here before the first run, per the no-optimisation rule.
 *
 *  | parameter          | value                  | playbook source        |
 *  |--------------------|------------------------|------------------------|
 *  | Fib ratios         | 0, .25, .5, .75, 1.0   | p8 "Key Levels"        |
 *  | Fib anchor         | swing low → swing high | p51 STEP 1             |
 *  | stop               | zone low − 1×ATR(14)   | p17 "ATR Stop Formula" |
 *  | ATR period         | 14                     | p17 Step 1 "default"   |
 *  | target             | first resistance above | p14 "TP1"              |
 *  | confirmation gate  | NONE — see below       | —                      |
 *  | confluence width   | 0.5%                   | SR_DEFAULTS (existing).|
 *  |                    |                        | p53's example zone is  |
 *  |                    |                        | 0.524%, so we are      |
 *  |                    |                        | marginally stricter.   |
 *  | swing lookback     | 2 bars each side       | SR_DEFAULTS (existing) |
 *  | min levels to arm  | 2 independent          | p53 "convergence"      |
 *
 * Ambiguous in the playbook, so fixed in advance and NOT swept:
 *  - How long a zone stays armed → MAX_BARS (48), the same horizon a trade
 *    is allowed to live. One horizon in the system, not two.
 *  - "Recent range" for the Fib swing → the full 250-bar analysis window.
 *    S/R clusters use the last 100 bars (SR_DEFAULTS.LOOKBACK_CANDLES).
 *    This approximates the playbook's 12h-macro / 4h-swing split inside a
 *    single timeframe.
 *
 * ─── Why there is no confirmation gate (pre-registered 3 Aug 2026) ──────
 * The first run applied the playbook's 3-of-5 gate (60/100) and produced
 * ZERO trades from 1,101 zone arrivals. Diagnosis, from the funnel below:
 *
 *   - 735 of 839 arrivals were evaluated as SHORT setups, while price was
 *     arriving at a SUPPORT zone. The checklist derives its own direction
 *     and disagreed with the zone 88% of the time.
 *   - Consequently "RSI Condition" passed 0/839 (a short tests rsi >= 60;
 *     at support it is low) and "Bollinger Band Extreme" passed 0/839
 *     (a short tests the UPPER band; at support price is near the lower).
 *   - "Support/Resistance Confluence" passed 1.2%, while price stood inside
 *     a multi-level confluence zone by construction — the checklist's
 *     price-anchored grid disagrees with the zone engine almost entirely.
 *
 * That is broken wiring, not a threshold, and it made the gated test
 * unevaluable rather than negative. So this run tests the ACTUAL claim of
 * STATE_OF_PLAY 14b in isolation: does arriving at a pre-marked confluence
 * zone beat entering at a random bar, given identical playbook exits?
 * Direction is long by construction. The score is still recorded so we can
 * ask afterwards whether it ranks — but it does not gate anything.
 *
 * ─── Deliberately NOT in the light version ──────────────────────────────
 * Trend lines, order blocks, true multi-timeframe fetch, scaled 20/20/60
 * entries, TP2/TP3. Those are the full build, and only earn their keep if
 * this passes. Single entry, single target (TP1), one position at a time.
 *
 * ponytail: no parameter sweep, no --atr flag, no --rr flag. Adding one
 * would rebuild the mirage that killed the baseline (see STATE_OF_PLAY 14c).
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { SR_DEFAULTS } from '../../src/analysis/interfaces/support-resistance.types';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';

// ── playbook constants ──────────────────────────────────────────────────
const FIB_RATIOS = [0, 0.25, 0.5, 0.75, 1.0]; // p8
const ATR_STOP_MULT = 1.0; // p17: Support − ATR (not a multiple of ATR)
const CONFLUENCE_PCT = SR_DEFAULTS.CLUSTER_THRESHOLD; // 0.5%
const SWING_LOOKBACK = SR_DEFAULTS.SWING_LOOKBACK; // 2
const MIN_CONFLUENCE = 2; // p53: convergence of 2+ independent levels
const SR_LOOKBACK = SR_DEFAULTS.LOOKBACK_CANDLES; // 100
const MAX_BARS = 48; // trade life AND zone arm window

// Cost model — identical to backtest.ts so results are comparable.
const FEE_PCT = 0.05;
const SLIP_PCT = 0.02;
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);

// ── args ────────────────────────────────────────────────────────────────
const [, , coinArg, tfArg, ...rest] = process.argv;
const flag = (name: string, fallback: number): number => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : fallback;
};
const coinsIdx = rest.indexOf('--coins');
const COINS =
  coinsIdx >= 0 && rest[coinsIdx + 1]
    ? rest[coinsIdx + 1].split(',').map((c) => c.trim().toUpperCase())
    : [(coinArg ?? 'BTC').toUpperCase()];
const timeframe = (tfArg ?? '1d') as TimeInterval;
const LIMIT = flag('limit', 3300);
const RANDOM = rest.includes('--random');
const RANDOM_RATE = flag('random-rate', 0.025);
const CSV = (() => {
  const i = rest.indexOf('--csv');
  return i >= 0 && rest[i + 1] ? rest[i + 1] : null;
})();

let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

interface Level {
  price: number;
  kind: 'fib' | 'swing';
  type: 'support' | 'resistance';
}

interface Zone {
  low: number;
  high: number;
  count: number; // independent levels agreeing
  armedAt: number; // bar index
}

const diag = {
  barsSeen: 0,
  noZoneBelow: 0,
  armed: 0,
  expired: 0,
  touched: 0,
  noTarget: 0,
  badStop: 0,
  entered: 0,
  scoresAtTouch: new Map<number, number>(),
  condPass: new Map<string, number>(),
  condSeen: new Map<string, number>(),
  dirAtTouch: new Map<string, number>(),
};

interface ZTrade {
  coin: string;
  time: Date;
  index: number;
  exitIndex: number;
  score: number;
  direction: 'long';
  entry: number;
  stop: number;
  target: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  r: number;
  barsHeld: number;
  costR: number;
  waitBars: number; // bars the zone sat armed before being touched
  confluence: number;
}

// ── level construction (playbook) ───────────────────────────────────────

/** Swing high/low: strictly beyond `lookback` bars either side. */
export function findSwings(
  candles: Candle[],
  lookback = SWING_LOOKBACK,
): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

/**
 * Playbook fibs: anchor on the swing LOW and swing HIGH of the range,
 * drawn low → high (p51 STEP 1). 0/.25/.5 are support, .75/1.0 resistance
 * (p52 colour coding).
 */
export function playbookFibs(swingLow: number, swingHigh: number): Level[] {
  const range = swingHigh - swingLow;
  return FIB_RATIOS.map((r) => ({
    price: swingLow + range * r,
    kind: 'fib' as const,
    type: (r <= 0.5 ? 'support' : 'resistance') as 'support' | 'resistance',
  }));
}

/**
 * Group levels that sit within CONFLUENCE_PCT of each other into a zone.
 * A zone is the span of its members (p53: "Confluence Zone: 28,600-28,750").
 * Only zones with >= MIN_CONFLUENCE independent levels qualify.
 */
export function buildZones(levels: Level[]): Zone[] {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const zones: Zone[] = [];
  let group: Level[] = [];

  const flush = () => {
    if (group.length >= MIN_CONFLUENCE) {
      zones.push({
        low: group[0].price,
        high: group[group.length - 1].price,
        count: group.length,
        armedAt: -1,
      });
    }
    group = [];
  };

  for (const l of sorted) {
    if (group.length === 0) {
      group = [l];
      continue;
    }
    // Compare against the group's first member so a chain of small gaps
    // cannot drift a "zone" arbitrarily wide.
    const spreadPct = ((l.price - group[0].price) / group[0].price) * 100;
    if (spreadPct <= CONFLUENCE_PCT) group.push(l);
    else {
      flush();
      group = [l];
    }
  }
  flush();
  return zones;
}

/** All levels visible from a window: fibs off the full swing + recent S/R. */
function levelsFor(window: Candle[]): Level[] {
  const swings = findSwings(window);
  if (swings.highs.length === 0 || swings.lows.length === 0) return [];

  // Fib anchor: the extremes of the whole analysis window (macro view).
  const swingLow = Math.min(...swings.lows);
  const swingHigh = Math.max(...swings.highs);
  const levels = playbookFibs(swingLow, swingHigh);

  // Finer S/R: swings inside the recent lookback only.
  const recent = window.slice(-SR_LOOKBACK);
  const rs = findSwings(recent);
  for (const h of rs.highs) levels.push({ price: h, kind: 'swing', type: 'resistance' });
  for (const l of rs.lows) levels.push({ price: l, kind: 'swing', type: 'support' });
  return levels;
}

/** First resistance strictly above `price` (p14 TP1). */
function firstResistanceAbove(levels: Level[], price: number): number | null {
  const above = levels
    .filter((l) => l.price > price * 1.0001)
    .map((l) => l.price)
    .sort((a, b) => a - b);
  return above.length ? above[0] : null;
}

/** Nearest support at/below `price` — used for the random control's stop. */
function nearestSupportBelow(levels: Level[], price: number): number | null {
  const below = levels
    .filter((l) => l.price < price)
    .map((l) => l.price)
    .sort((a, b) => b - a);
  return below.length ? below[0] : null;
}

function simulate(
  candles: Candle[],
  from: number,
  entry: number,
  stop: number,
  target: number,
): { outcome: 'WIN' | 'LOSS' | 'TIMEOUT'; r: number; barsHeld: number; exitIndex: number } {
  const risk = entry - stop;
  const rr = (target - entry) / risk;
  for (let i = from + 1; i <= Math.min(from + MAX_BARS, candles.length - 1); i++) {
    const bar = candles[i];
    // Pessimistic: a bar spanning both counts as a stop.
    if (bar.low <= stop) return { outcome: 'LOSS', r: -1, barsHeld: i - from, exitIndex: i };
    if (bar.high >= target) return { outcome: 'WIN', r: rr, barsHeld: i - from, exitIndex: i };
  }
  const exitIndex = Math.min(from + MAX_BARS, candles.length - 1);
  return {
    outcome: 'TIMEOUT',
    r: risk === 0 ? 0 : (candles[exitIndex].close - entry) / risk,
    barsHeld: exitIndex - from,
    exitIndex,
  };
}

async function runCoin(coin: string): Promise<ZTrade[]> {
  const indicators = new IndicatorsService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const regimeSvc = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    regimeSvc,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
  );

  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) {
    throw new Error(`need > ${ANALYSIS_CANDLE_LIMIT} candles, got ${candles.length}`);
  }

  const trades: ZTrade[] = [];
  let openUntil = -1;
  let armed: Zone | null = null;
  // Diagnostics: a zero-trade result must distinguish "hypothesis failed"
  // from "the funnel never fires". Counted at every drop-off point.
  const d = diag;

  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    if (i <= openUntil) continue;

    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    if (window.length !== ANALYSIS_CANDLE_LIMIT) {
      throw new Error(`look-ahead guard: window ${window.length} at i=${i}`);
    }
    const price = candles[i].close;

    // ── random control: identical exits, random location, no gate ──────
    if (RANDOM) {
      if (rng() > RANDOM_RATE) continue;
      const levels = levelsFor(window);
      if (levels.length === 0) continue;
      const sup = nearestSupportBelow(levels, price);
      const tgt = firstResistanceAbove(levels, price);
      if (sup === null || tgt === null) continue;
      const ctx = indicators.buildContext(coin, timeframe, window);
      const stop = sup - ctx.atr * ATR_STOP_MULT;
      if (!Number.isFinite(stop) || stop <= 0 || stop >= price) continue;
      const sim = simulate(candles, i, price, stop, tgt);
      openUntil = sim.exitIndex;
      trades.push({
        coin, time: candles[i].time, index: i, exitIndex: sim.exitIndex,
        score: -1, direction: 'long', entry: price, stop, target: tgt,
        outcome: sim.outcome, r: sim.r, barsHeld: sim.barsHeld,
        costR: ROUND_TRIP_PCT / (((price - stop) / price) * 100),
        waitBars: 0, confluence: 0,
      });
      continue;
    }

    d.barsSeen++;

    // ── arm a zone below price, if none is armed ───────────────────────
    if (!armed) {
      const zones = buildZones(levelsFor(window)).filter((z) => z.high < price);
      if (zones.length === 0) {
        d.noZoneBelow++;
        continue;
      }
      // Nearest zone below price is the one price would reach first.
      armed = zones.reduce((best, z) => (z.high > best.high ? z : best));
      armed.armedAt = i;
      d.armed++;
      continue;
    }

    // ── armed: expire, or trigger on touch ────────────────────────────
    if (i - armed.armedAt > MAX_BARS) {
      armed = null;
      d.expired++;
      continue;
    }
    if (candles[i].low > armed.high) continue; // price has not arrived
    d.touched++;

    // Price reached the zone. NOW apply the confirmation filter, using
    // only data up to this bar.
    const ctx = indicators.buildContext(coin, timeframe, window);
    const regime = regimeSvc.classifyFromContext(ctx);
    const routed = coordinator.routeFromRegime(ctx, timeframe, regime);
    const score = routed.checklistResult?.totalScore ?? -1;
    const waitBars = i - armed.armedAt;
    const zone = armed;
    armed = null; // touched: consumed either way

    d.scoresAtTouch.set(score, (d.scoresAtTouch.get(score) ?? 0) + 1);
    if (routed.checklistResult) {
      const dt = routed.checklistResult.tradeType;
      d.dirAtTouch.set(dt, (d.dirAtTouch.get(dt) ?? 0) + 1);
      for (const c of routed.checklistResult.conditions) {
        if (c.passed) d.condPass.set(c.name, (d.condPass.get(c.name) ?? 0) + 1);
        d.condSeen.set(c.name, (d.condSeen.get(c.name) ?? 0) + 1);
      }
    }

    // NO CONFIRMATION GATE — see the header. The score is recorded for
    // analysis but does not gate entry. Direction is long by construction:
    // arriving at a SUPPORT zone is a long setup, so the checklist's
    // self-derived direction is deliberately ignored.

    // Limit fill at the zone's upper edge (p56: resting orders in the zone).
    const entry = Math.min(zone.high, candles[i].open);
    const stop = zone.low - ctx.atr * ATR_STOP_MULT;
    const target = firstResistanceAbove(levelsFor(window), entry);
    if (target === null) {
      d.noTarget++;
      continue; // no marked resistance above: no TP1
    }
    if (!Number.isFinite(stop) || stop <= 0 || stop >= entry) {
      d.badStop++;
      continue;
    }
    d.entered++;

    const sim = simulate(candles, i, entry, stop, target);
    openUntil = sim.exitIndex;
    trades.push({
      coin, time: candles[i].time, index: i, exitIndex: sim.exitIndex,
      score, direction: 'long', entry, stop, target,
      outcome: sim.outcome, r: sim.r, barsHeld: sim.barsHeld,
      costR: ROUND_TRIP_PCT / (((entry - stop) / entry) * 100),
      waitBars, confluence: zone.count,
    });
  }

  return trades;
}

// ── self-check ──────────────────────────────────────────────────────────
function selfCheck() {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`self-check FAILED: ${msg}`);
  };

  // Playbook fibs, using the playbook's own worked example (p52):
  // swing low 25,000 → swing high 40,000 gives .25=28,750 .5=32,500 .75=36,250
  const fibs = playbookFibs(25000, 40000);
  ok(fibs.length === 5, 'five fib levels');
  ok(fibs[1].price === 28750, `0.25 should be 28750, got ${fibs[1].price}`);
  ok(fibs[2].price === 32500, `0.5 should be 32500, got ${fibs[2].price}`);
  ok(fibs[3].price === 36250, `0.75 should be 36250, got ${fibs[3].price}`);
  ok(fibs[0].type === 'support' && fibs[4].type === 'resistance', 'fib types');

  // Confluence: the playbook's zone example (p53) is 28,600-28,750, which
  // spans 0.524% — marginally WIDER than SR_DEFAULTS' 0.5% tolerance. We
  // keep 0.5%, because it is a pre-existing codebase constant rather than a
  // number reverse-engineered from one illustration, and being stricter is
  // the conservative direction. Consequence: that example groups 3 of its 4
  // levels. Asserted explicitly so the trade-off stays visible.
  const zones = buildZones([
    { price: 28750, kind: 'fib', type: 'support' },
    { price: 28600, kind: 'swing', type: 'support' },
    { price: 28700, kind: 'swing', type: 'support' },
    { price: 28650, kind: 'swing', type: 'support' },
  ]);
  ok(zones.length === 1, `expected 1 zone, got ${zones.length}`);
  ok(zones[0].count === 3, `expected 3 members at 0.5%, got ${zones[0].count}`);
  ok(zones[0].low === 28600 && zones[0].high === 28700, 'zone spans its members');

  // A lone level must NOT form a zone (needs MIN_CONFLUENCE).
  ok(buildZones([{ price: 100, kind: 'fib', type: 'support' }]).length === 0, 'single level');

  // Far-apart levels must not merge.
  ok(
    buildZones([
      { price: 100, kind: 'fib', type: 'support' },
      { price: 200, kind: 'fib', type: 'support' },
    ]).length === 0,
    'distant levels must not merge',
  );

  // Swing detection on a synthetic peak/trough.
  const mk = (h: number, l: number): Candle =>
    ({ time: new Date(0), open: l, high: h, low: l, close: h, volume: 1 }) as Candle;
  const sw = findSwings(
    [mk(1, 1), mk(2, 2), mk(9, 9), mk(2, 2), mk(1, 1)].map((c, i) =>
      i === 2 ? mk(9, 9) : c,
    ),
  );
  ok(sw.highs.includes(9), 'peak detected as swing high');

  console.log('self-check passed (playbook fib values, p53 confluence zone, swings)');
}

async function main() {
  const startedAt = Date.now();
  const all: ZTrade[] = [];
  for (const c of COINS) all.push(...(await runCoin(c)));

  console.log(
    `\n${COINS.length === 1 ? COINS[0] : `${COINS.length} coins`} · ${timeframe} · ` +
      `${RANDOM ? 'RANDOM CONTROL' : 'ZONE STRATEGY'}`,
  );
  console.log(
    `playbook params: fib ${FIB_RATIOS.join('/')} · stop = zone low − ${ATR_STOP_MULT}×ATR · ` +
      `TP1 = first resistance · NO confirmation gate · ` +
      `confluence ${CONFLUENCE_PCT}% / ${MIN_CONFLUENCE}+ levels · arm ${MAX_BARS} bars`,
  );

  if (!RANDOM) {
    console.log('\n── funnel ' + '─'.repeat(50));
    console.table({
      'bars evaluated': diag.barsSeen,
      'no zone below price': diag.noZoneBelow,
      'zones armed': diag.armed,
      'expired unreached': diag.expired,
      'price reached zone': diag.touched,
      'no TP1 resistance': diag.noTarget,
      'unusable stop': diag.badStop,
      ENTERED: diag.entered,
    });
    if (diag.dirAtTouch.size > 0) {
      console.log('checklist tradeType at the moment price reached a SUPPORT zone:');
      console.table([...diag.dirAtTouch.entries()].map(([dir, n]) => ({ tradeType: dir, n })));
    }
    if (diag.condSeen.size > 0) {
      console.log('condition pass-rate at zone arrival (checklist-routed only):');
      console.table(
        [...diag.condSeen.entries()].map(([name, seen]) => ({
          condition: name,
          passed: diag.condPass.get(name) ?? 0,
          seen,
          rate: `${(((diag.condPass.get(name) ?? 0) / seen) * 100).toFixed(1)}%`,
        })),
      );
    }
    if (diag.scoresAtTouch.size > 0) {
      console.log('score at the moment price reached the zone:');
      console.table(
        [...diag.scoresAtTouch.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([score, n]) => ({
            score,
            n,
            pct: `${((n / diag.touched) * 100).toFixed(1)}%`,
          })),
      );
    }
  }

  if (all.length === 0) {
    console.log('\nNo trades.');
    return;
  }

  const net = all.map((t) => t.r - t.costR);
  const exp = net.reduce((a, b) => a + b, 0) / net.length;
  const wins = all.filter((t) => t.r > 0).length;
  const rrs = all.map((t) => (t.target - t.entry) / (t.entry - t.stop));
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  const outcomes = { WIN: 0, LOSS: 0, TIMEOUT: 0 };
  for (const t of all) outcomes[t.outcome]++;
  console.table(outcomes);

  console.log(
    `\nn ${all.length} · win ${((wins / all.length) * 100).toFixed(1)}% · ` +
      `median RR ${med(rrs).toFixed(2)} · median cost ${med(all.map((t) => t.costR)).toFixed(3)}R · ` +
      `avg hold ${(all.reduce((a, t) => a + t.barsHeld, 0) / all.length).toFixed(1)} bars`,
  );
  if (!RANDOM) {
    console.log(
      `median wait ${med(all.map((t) => t.waitBars))} bars · ` +
        `median confluence ${med(all.map((t) => t.confluence))} levels`,
    );
  }
  console.log(`\nEXPECTANCY  ${exp.toFixed(3)}R/trade   (${net.reduce((a, b) => a + b, 0).toFixed(1)}R total)`);

  if (CSV) {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(
      CSV,
      [
        'coin,time,index,exitIndex,tier,score,direction,entry,stop,target,outcome,r,barsHeld,costR',
        ...all.map((t) =>
          [
            t.coin, t.time.toISOString(), t.index, t.exitIndex,
            RANDOM ? 'RANDOM' : 'ZONE', t.score, t.direction,
            t.entry, t.stop, t.target, t.outcome, t.r, t.barsHeld, t.costR,
          ].join(','),
        ),
      ].join('\n'),
    );
    console.log(`\nwrote ${all.length} trades → ${CSV}`);
  }
  console.log(`\nreplayed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (rest.includes('--self-check') || process.argv.includes('--self-check')) {
  selfCheck();
} else {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
