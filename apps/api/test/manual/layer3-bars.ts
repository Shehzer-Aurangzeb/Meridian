/**
 * Layer 3's falsification bars, run before any liquidity product code.
 *
 *   pnpm --filter api layer3-bars
 *   pnpm --filter api layer3-bars -- --shuffle
 *
 *   3a  does a support zone with a thick resting BID shelf behind it bounce
 *       more often than one without?
 *       PASS: >= 8 percentage points between the top and bottom terciles of
 *       shelf thickness, surviving a 30-day block bootstrap on the holdout
 *
 *   3b  is the unwind lift real?
 *       PASS: the conditional >=5% adverse rate exceeds the base rate by an
 *       interval excluding zero, with >= 100 matches over >= 4 distinct blocks
 *
 * ─── Why 3a is the only genuinely new question left ──────────────────────
 * Twenty tests have asked whether something predicts the RETURN. This asks
 * whether resting size predicts a conditional FREQUENCY — whether a level with
 * real bids behind it holds more often than one without. It has never been
 * asked here, it is answerable entirely from data already on disk, and Layer 2
 * has just shown that the obvious zone features (type, confluence count,
 * regime) carry nothing, which makes depth the last candidate standing.
 *
 * A failure is survivable and was declared so in advance: the depth
 * percentiles remain facts about the book, and the liquidity map becomes a
 * display feature rather than an input to any probability.
 *
 * ─── The block condition on 3b is not decoration ─────────────────────────
 * In the magnitude gate, 17 trades landing inside a single 30-day block
 * produced a bootstrap interval of [2.62, 2.62] — zero width, resampling one
 * month against itself, and it looked exactly like certainty.
 *
 * ─── Limits enforced here, not just documented ───────────────────────────
 * The archive publishes depth only to +-5% of mid, so a zone further than that
 * from spot has NO shelf reading and is excluded rather than extrapolated. The
 * +-0.2% band is never read: it starts 2026-01-15 and cannot carry a
 * multi-year base rate.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { LevelMapService, LEVEL_TIMEFRAMES, ATR_TIMEFRAME } from '../../src/analysis/services/level-map.service';
import { CANDLE_LIMITS, Timeframe } from '../../src/common/constants/timeframes';
import { Candle } from '../../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { isTouch, resolveTouch, RESOLUTION_WINDOW_BARS } from '../../src/calibration/resolution';
import { MAX_SHELL_PERCENT, shellForDistance, percentileOf } from '../../src/liquidity/depth.math';
import { candlesFor } from './layer2-calibrate';
import { load, blockBootstrapMean, mean } from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const PANEL = str('panel', 'test/manual/results/panel.csv');
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const HOLDOUT_DAYS = num('holdout-days', 182);
const CADENCE_HOURS = num('cadence', 8);
const SEED = num('seed', 12345);
const SHUFFLE = args.includes('--shuffle');

/** Trailing window the shelf percentile is measured against, in hours. */
const SHELF_LOOKBACK_HOURS = num('shelf-lookback', 90 * 24);

// Bars, declared before any result.
const BAR_3A_POINTS = num('bar-3a', 8);
const BAR_3B_MIN_MATCHES = num('bar-3b-matches', 100);
const BAR_3B_MIN_BLOCKS = num('bar-3b-blocks', 4);

// Bar 3b's crowding definition, fixed before the run.
const CROWDED_FUNDING_PCTL = num('funding-pctl', 90);
const CROWDED_OI_CHANGE = num('oi-change', 0.05);
const CROWDED_PERCENT_B = num('percent-b', 0.95);
const ADVERSE_MOVE = num('adverse', 0.05);
const ADVERSE_WINDOW_HOURS = num('adverse-window', 24);

// ── bar 3a ────────────────────────────────────────────────────────────────

interface ShelfTouch {
  time: number;
  /** Percentile of the bid notional in the zone's shell, 0-100. */
  thickness: number;
  outcome: 0 | 1;
}

/** Hourly bid notional per shell for one coin, from BookProfile. */
async function shelfSeries(
  prisma: PrismaClient,
  coin: string,
): Promise<Map<number, number[]>> {
  const rows = await prisma.$queryRaw<Array<{ h: Date; shell: number; bid: number }>>`
    SELECT date_trunc('hour', ts) AS h, shell, AVG("bidNotional")::float8 AS bid
    FROM "BookProfile"
    WHERE symbol = ${coin}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  const out = new Map<number, number[]>();
  for (const r of rows) {
    const key = r.h.getTime();
    const cell = out.get(key) ?? new Array<number>(MAX_SHELL_PERCENT).fill(NaN);
    cell[r.shell - 1] = r.bid;
    out.set(key, cell);
  }
  return out;
}

async function replayShelf(
  binance: BinanceService,
  levelMap: LevelMapService,
  prisma: PrismaClient,
  coin: string,
  holdoutFromMs: number,
): Promise<{ touches: ShelfTouch[]; skippedNoShelf: number; skippedBeyondRange: number }> {
  const series = new Map<Timeframe, Candle[]>();
  for (const tf of LEVEL_TIMEFRAMES) {
    const span = Math.ceil((32_000 * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[tf]);
    series.set(tf, await candlesFor(binance, coin, tf, CANDLE_LIMITS[tf] + span + 10));
  }
  const h1 = series.get('1h') ?? [];
  const shelf = await shelfSeries(prisma, coin);

  // Hourly series per shell, in time order, for the trailing percentile.
  const shelfTimes = [...shelf.keys()].sort((a, b) => a - b);
  const shelfIndex = new Map(shelfTimes.map((t, i) => [t, i]));
  const perShell: number[][] = Array.from({ length: MAX_SHELL_PERCENT }, () =>
    shelfTimes.map((t) => shelf.get(t)![0]),
  );
  for (let s = 0; s < MAX_SHELL_PERCENT; s += 1) {
    perShell[s] = shelfTimes.map((t) => shelf.get(t)![s]);
  }

  const touches: ShelfTouch[] = [];
  let skippedNoShelf = 0;
  let skippedBeyondRange = 0;
  const lastUsable = h1.length - (CADENCE_HOURS + RESOLUTION_WINDOW_BARS + 1);

  for (let i = 300; i < lastUsable; i += CADENCE_HOURS) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];

    const sliced: Array<{ timeframe: Timeframe; candles: Candle[] }> = [];
    let ok = true;
    for (const tf of LEVEL_TIMEFRAMES) {
      const all = series.get(tf) ?? [];
      const need = CANDLE_LIMITS[tf];
      const cut = all.findIndex((c) => c.time.getTime() + TIMEFRAME_MS[tf] > asOf);
      const end = cut < 0 ? all.length : cut;
      const done = completedAsOf(all.slice(Math.max(0, end - need - 5), end + 2), TIMEFRAME_MS[tf], asOf, need);
      if (done.length < 20) { ok = false; break; }
      sliced.push({ timeframe: tf, candles: done });
    }
    if (!ok) continue;

    const atrCandles = sliced.find((s) => s.timeframe === ATR_TIMEFRAME)?.candles ?? [];
    if (atrCandles.length < 20) continue;

    let map;
    try {
      map = levelMap.buildFrom(coin, sliced, atrCandles);
    } catch {
      continue;
    }
    if (!(map.atr > 0)) continue;

    // Support zones only. The question is about resting BID size behind a
    // level that is holding price up; a resistance zone's analogue is the ask
    // side and is a different study.
    for (const zone of map.zones.filter((z) => z.type === 'support')) {
      const shellNo = shellForDistance(zone.distancePercent);
      if (shellNo === null) {
        skippedBeyondRange += 1;
        continue;
      }

      for (let j = i + 1; j <= i + CADENCE_HOURS && j < h1.length; j += 1) {
        if (!isTouch(h1[j], zone, map.atr)) continue;

        const touchMs = h1[j].time.getTime();
        const hourKey = Math.floor(touchMs / 3_600_000) * 3_600_000;
        const idx = shelfIndex.get(hourKey);
        if (idx === undefined) { skippedNoShelf += 1; break; }
        const value = perShell[shellNo - 1][idx];
        if (!Number.isFinite(value)) { skippedNoShelf += 1; break; }

        const lo = Math.max(0, idx - SHELF_LOOKBACK_HOURS);
        const history = perShell[shellNo - 1].slice(lo, idx).filter(Number.isFinite);
        if (history.length < 500) { skippedNoShelf += 1; break; }

        const outcome = resolveTouch(zone, map.atr, h1.slice(j + 1, j + 1 + RESOLUTION_WINDOW_BARS));
        if (outcome === 'bounce' || outcome === 'break') {
          touches.push({
            time: touchMs,
            thickness: percentileOf(value, history),
            outcome: outcome === 'bounce' ? 1 : 0,
          });
        }
        break;
      }
    }
  }
  return { touches, skippedNoShelf, skippedBeyondRange };
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  Logger.overrideLogger(['error', 'warn']);

  const store = new Map<string, unknown>();
  const cache = {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
    del: (k: string) => Promise.resolve(store.delete(k)),
  } as unknown as Cache;
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();
  const levelMap = new LevelMapService(binance, new SupportResistanceService(), indicators);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const panel = load(PANEL);
  const nC = panel.coins.length;
  const nT = panel.times.length;
  const holdoutLo = nT - HOLDOUT_DAYS * 24;
  const holdoutFromMs = panel.times[holdoutLo];

  console.log(`\nLAYER 3 — FALSIFICATION BARS${SHUFFLE ? '  [SHUFFLED CONTROL]' : ''}`);
  console.log(`holdout    last ${HOLDOUT_DAYS} days from ${new Date(holdoutFromMs).toISOString().slice(0, 10)}`);
  console.log(`\n── bars, declared before any result ──`);
  console.log(`3a  >= ${BAR_3A_POINTS} point bounce-rate gap between top and bottom shelf terciles,`);
  console.log(`    bootstrap interval on the gap excluding zero`);
  console.log(`3b  conditional adverse rate above base, interval excluding zero,`);
  console.log(`    >= ${BAR_3B_MIN_MATCHES} matches over >= ${BAR_3B_MIN_BLOCKS} distinct 30-day blocks`);
  console.log(`limits  depth only to +-${MAX_SHELL_PERCENT}% of mid; zones beyond that are EXCLUDED, never extrapolated\n`);

  // ══ 3a ══════════════════════════════════════════════════════════════════
  console.log('── 3a: does a thick bid shelf make a support zone hold? ──');
  const all: ShelfTouch[] = [];
  let noShelf = 0;
  let beyond = 0;
  for (const coin of COINS) {
    const got = await replayShelf(binance, levelMap, prisma, coin, holdoutFromMs);
    all.push(...got.touches);
    noShelf += got.skippedNoShelf;
    beyond += got.skippedBeyondRange;
    process.stdout.write(`  ${coin} `);
  }
  console.log('');

  const holdout = all.filter((t) => t.time >= holdoutFromMs);
  console.log(`  resolved touches with a shelf reading: ${all.length.toLocaleString()} (holdout ${holdout.length.toLocaleString()})`);
  console.log(`  skipped: ${beyond.toLocaleString()} zones beyond +-${MAX_SHELL_PERCENT}%, ${noShelf.toLocaleString()} with no usable book history`);

  let pass3a = false;
  if (holdout.length < 300) {
    console.log('  too few holdout touches to judge');
  } else {
    const scored = SHUFFLE
      ? (() => {
          // Permute thickness across touches, breaking the link to the outcome
          // while leaving both distributions intact.
          const rng = makeRng(SEED);
          const th = holdout.map((t) => t.thickness);
          for (let i = th.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [th[i], th[j]] = [th[j], th[i]];
          }
          return holdout.map((t, i) => ({ ...t, thickness: th[i] }));
        })()
      : holdout;

    const sorted = [...scored].sort((a, b) => a.thickness - b.thickness);
    const third = Math.floor(sorted.length / 3);
    const bottom = sorted.slice(0, third);
    const top = sorted.slice(sorted.length - third);
    const rate = (xs: ShelfTouch[]): number => xs.reduce((s, x) => s + x.outcome, 0) / xs.length;
    const gap = (rate(top) - rate(bottom)) * 100;

    // Bootstrap the GAP itself, not the two rates separately: both terciles are
    // drawn from the same weeks, and a paired resample cancels the common move.
    const rng = makeRng(SEED);
    const byBlock = new Map<number, ShelfTouch[]>();
    const t0ms = Math.min(...scored.map((t) => t.time));
    for (const t of scored) {
      const b = Math.floor((t.time - t0ms) / (30 * 86_400_000));
      byBlock.set(b, [...(byBlock.get(b) ?? []), t]);
    }
    const blocks = [...byBlock.values()];
    const draws: number[] = [];
    for (let d = 0; d < 2000; d += 1) {
      const sample: ShelfTouch[] = [];
      for (let b = 0; b < blocks.length; b += 1) sample.push(...blocks[Math.floor(rng() * blocks.length)]);
      const s = [...sample].sort((a, b) => a.thickness - b.thickness);
      const t3 = Math.floor(s.length / 3);
      if (t3 === 0) continue;
      draws.push((rate(s.slice(s.length - t3)) - rate(s.slice(0, t3))) * 100);
    }
    draws.sort((a, b) => a - b);
    const lo = draws[Math.floor(0.025 * (draws.length - 1))];
    const hi = draws[Math.floor(0.975 * (draws.length - 1))];

    console.log(`  bottom tercile bounce ${(rate(bottom) * 100).toFixed(1)}% (n=${bottom.length.toLocaleString()})`);
    console.log(`  top tercile bounce    ${(rate(top) * 100).toFixed(1)}% (n=${top.length.toLocaleString()})`);
    console.log(`  gap ${gap.toFixed(2)} points, 95% block bootstrap [${lo.toFixed(2)}, ${hi.toFixed(2)}] over ${blocks.length} blocks`);
    pass3a = gap >= BAR_3A_POINTS && lo > 0;
    console.log(`  3a: ${pass3a ? 'PASS' : 'FAIL'} (bar >= ${BAR_3A_POINTS} points AND interval above zero)`);
  }

  // ══ 3b ══════════════════════════════════════════════════════════════════
  console.log('\n── 3b: is the unwind lift real? ──');
  console.log(
    `  crowded = funding >= ${CROWDED_FUNDING_PCTL}th percentile (trailing, per coin)` +
      ` AND 24h OI change >= ${(CROWDED_OI_CHANGE * 100).toFixed(0)}% AND %B >= ${CROWDED_PERCENT_B}`,
  );
  console.log(`  adverse = a fall of ${(ADVERSE_MOVE * 100).toFixed(0)}% or more within ${ADVERSE_WINDOW_HOURS}h`);

  const close = panel.data.get('close')!;
  const funding = panel.data.get('fundingRate')!;
  const oi = panel.data.get('openInterest')!;
  const pb = panel.data.get('percentB')!;

  const matches: Array<{ time: number; value: number }> = [];
  const allOutcomes: number[] = [];
  const oiDropsOnAdverse: number[] = [];

  for (let ci = 0; ci < nC; ci += 1) {
    const fundHist: number[] = [];
    for (let ti = 0; ti < nT - ADVERSE_WINDOW_HOURS; ti += 1) {
      const at = ti * nC + ci;
      const f = funding[at];
      const price = close[at];
      if (!Number.isFinite(price) || price <= 0) continue;

      // Worst drawdown over the window, from this bar's close.
      let worst = 0;
      for (let k = 1; k <= ADVERSE_WINDOW_HOURS; k += 1) {
        const p = close[(ti + k) * nC + ci];
        if (!Number.isFinite(p) || p <= 0) continue;
        worst = Math.min(worst, p / price - 1);
      }
      const adverse = worst <= -ADVERSE_MOVE ? 1 : 0;
      allOutcomes.push(adverse);

      if (Number.isFinite(f)) fundHist.push(f);
      if (ti < holdoutLo) continue; // the bar is scored on the holdout

      // Crowded?
      if (!Number.isFinite(f) || fundHist.length < 2000) continue;
      const window = fundHist.slice(-SHELF_LOOKBACK_HOURS);
      if (percentileOf(f, window) < CROWDED_FUNDING_PCTL) continue;

      const oiNow = oi[at];
      const oiPast = ti >= 24 ? oi[(ti - 24) * nC + ci] : NaN;
      if (!Number.isFinite(oiNow) || !Number.isFinite(oiPast) || oiPast <= 0) continue;
      if (oiNow / oiPast - 1 < CROWDED_OI_CHANGE) continue;

      if (!Number.isFinite(pb[at]) || pb[at] < CROWDED_PERCENT_B) continue;

      matches.push({ time: panel.times[ti], value: adverse });
      if (adverse === 1) {
        const oiAfter = oi[(ti + ADVERSE_WINDOW_HOURS) * nC + ci];
        if (Number.isFinite(oiAfter) && oiPast > 0) oiDropsOnAdverse.push(oiAfter / oiNow - 1);
      }
    }
  }

  const baseRate = mean(allOutcomes);
  const condRate = matches.length === 0 ? NaN : mean(matches.map((m) => m.value));
  const boot = blockBootstrapMean(matches, 30, 2000, SEED);
  const blocks = boot.blocks;

  console.log(`  matches ${matches.length.toLocaleString()} over ${blocks} distinct 30-day blocks`);
  console.log(`  conditional adverse rate ${(condRate * 100).toFixed(1)}%  vs base rate ${(baseRate * 100).toFixed(1)}%`);
  console.log(
    `  conditional 95% block bootstrap [${(boot.lo * 100).toFixed(1)}%, ${(boot.hi * 100).toFixed(1)}%]` +
      ` — lift is real only if the LOWER bound clears the base rate`,
  );
  if (oiDropsOnAdverse.length > 0) {
    const sorted = [...oiDropsOnAdverse].sort((a, b) => a - b);
    console.log(
      `  on those adverse occasions, open interest moved a median ` +
        `${(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1)}% over the window ` +
        `(n=${oiDropsOnAdverse.length.toLocaleString()}) — the observable footprint of forced unwinding`,
    );
  }
  const enough = matches.length >= BAR_3B_MIN_MATCHES && blocks >= BAR_3B_MIN_BLOCKS;
  const pass3b = enough && boot.lo > baseRate;
  if (!enough) {
    console.log(
      `  NOT ENOUGH EVIDENCE: needs >= ${BAR_3B_MIN_MATCHES} matches over >= ${BAR_3B_MIN_BLOCKS} blocks. ` +
        `An interval from fewer blocks resamples the same weeks against themselves.`,
    );
  }
  console.log(`  3b: ${pass3b ? 'PASS' : 'FAIL'}`);

  console.log('\n── verdict ──');
  console.log(`3a shelf study ${pass3a ? 'PASS' : 'FAIL'}   3b unwind lift ${pass3b ? 'PASS' : 'FAIL'}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
