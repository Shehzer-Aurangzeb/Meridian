/**
 * Can the zones predict RANGE, once ATR is already accounted for?
 *
 *   npx ts-node test/manual/range.ts --self-check
 *   npx ts-node test/manual/range.ts test/manual/results/y3-exits.csv
 *
 * Direction is settled: the zones carry none. This asks the weaker question —
 * do they say anything about HOW FAR price travels in the next 48h?
 *
 * ─── The framing that makes this a real test ─────────────────────────────
 * Predicting raw range from ATR is trivially easy and means nothing: ATR IS a
 * range estimate, so a high correlation there is a tautology, not a finding.
 * The only interesting question is whether zone geometry explains anything
 * ATR does not.
 *
 * So the target is `range / ATR` — realised range with the ATR component
 * divided out. Against that target ATR has, by construction, nothing left to
 * contribute, and any correlation a zone measure shows is information ATR did
 * not already carry. A flat result there means range prediction is ATR in a
 * costume.
 *
 * READ-ONLY. Nothing here changes strategy logic or writes a plan.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { atrLatest } from '../../src/indicators/series';
import { makeRng } from './rng';

Logger.overrideLogger(false);

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

/** 48h forward window, matching the base-rate study's horizon. */
const HORIZON_H = num('horizon', 48);
const ATR_BARS = num('atr-bars', 100);
const BLOCK_DAYS = num('block-days', 14);
const B = num('b', 2000);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── stats ───────────────────────────────────────────────────────────────

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Average ranks for ties — without it, `sources` (values 2-5) would be junk. */
export function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

export const spearman = (x: number[], y: number[]): number => pearson(rank(x), rank(y));

/**
 * Block bootstrap of a correlation.
 *
 * Trades inside one fortnight share a market, and a 48h forward window
 * overlaps its neighbours — so pair-level resampling would treat ~1,900
 * observations as independent and hand back an interval several times too
 * tight. Whole time blocks are resampled instead, pairs kept together.
 */
export function blockCorr(
  pts: Array<{ time: number; x: number; y: number }>,
  blockDays: number,
  b: number,
  seed: number,
): { lo: number; hi: number; blocks: number } {
  if (pts.length < 10) return { lo: NaN, hi: NaN, blocks: 0 };
  const rng = makeRng(seed);
  const t0 = Math.min(...pts.map((p) => p.time));
  const ms = blockDays * 86_400_000;
  const by = new Map<number, Array<{ x: number; y: number }>>();
  for (const p of pts) {
    const k = Math.floor((p.time - t0) / ms);
    by.set(k, [...(by.get(k) ?? []), { x: p.x, y: p.y }]);
  }
  const blocks = [...by.values()];

  const draws: number[] = [];
  for (let i = 0; i < b; i += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < blocks.length; j += 1) {
      for (const p of blocks[Math.floor(rng() * blocks.length)]) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    const r = pearson(xs, ys);
    if (Number.isFinite(r)) draws.push(r);
  }
  draws.sort((a, b2) => a - b2);
  return {
    lo: draws[Math.floor(0.025 * (draws.length - 1))],
    hi: draws[Math.floor(0.975 * (draws.length - 1))],
    blocks: blocks.length,
  };
}

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  assert(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9, 'a perfect line is r = 1');
  assert(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9, 'and its mirror is -1');
  assert(pearson([1, 1, 1, 1], [1, 2, 3, 4]) === 0, 'a constant cannot correlate, and must not divide by zero');

  // Spearman must see a monotone curve Pearson underrates.
  const x = [1, 2, 3, 4, 5];
  const y = [1, 4, 9, 16, 25];
  assert(Math.abs(spearman(x, y) - 1) < 1e-9, 'a monotone curve is rank-perfect');
  assert(pearson(x, y) < 0.99, 'while Pearson reads it as slightly less than perfect');

  // Ties get average ranks, or a low-cardinality column reads as noise.
  assert(JSON.stringify(rank([5, 5, 1])) === JSON.stringify([2.5, 2.5, 1]), 'ties share the average rank');
  assert(JSON.stringify(rank([2, 2, 2])) === JSON.stringify([2, 2, 2]), 'all-ties is flat, not an ordering');

  // The bootstrap must widen with block-level structure and not collapse.
  const pts = Array.from({ length: 400 }, (_, i) => ({
    time: i * 3_600_000,
    x: i % 17,
    y: (i % 17) * (Math.floor(i / 80) % 2 === 0 ? 1 : -1),
  }));
  const ci = blockCorr(pts, 1, 500, 3);
  assert(ci.blocks > 4, 'a 400-hour span splits into more than four daily blocks');
  assert(ci.lo < 0 && ci.hi > 0, 'blocks that disagree in sign produce an interval spanning zero');

  console.log('self-check passed (pearson, spearman, tied ranks, block bootstrap)');
}

if (require.main === module && args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── build ───────────────────────────────────────────────────────────────

interface Obs {
  coin: string;
  time: number;
  /** Realised 48h high-low travel, in price. */
  rawRange: number;
  /** The same, divided by ATR at entry — what ATR cannot already explain. */
  rangeAtr: number;
  atr: number;
  entry: number;
  /** Blended target distance in risk units: the zone-SPACING measure. */
  plannedR: number;
  /** Confluence sources behind the zone. */
  sources: number;
  /** Entry-to-stop distance as % of entry: the zone+ATR stop geometry. */
  riskPercent: number;
}

async function main(): Promise<void> {
  const path = args.find((a) => a.endsWith('.csv'));
  if (!path) throw new Error('pass the plan-backtest CSV as the first argument');

  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  const rows = lines
    .slice(head + 1)
    .map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter((r) => r.tier === 'PLAN');

  const binance = new BinanceService(cache, new CacheTelemetryService());
  const coins = [...new Set(rows.map((r) => r.coin))];
  const obs: Obs[] = [];
  let missing = 0;

  for (const coin of coins) {
    const h1 = await binance.getCandlesPaged(coin, '1h', 27000);
    const h4 = await binance.getCandlesPaged(coin, '4h', 7000);
    const at = new Map(h1.map((c, i) => [c.time.toISOString(), i]));

    for (const r of rows.filter((x) => x.coin === coin)) {
      const i = at.get(r.time);
      if (i === undefined) {
        missing += 1;
        continue;
      }
      // asOf is the decision bar's CLOSE, matching the harness.
      const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];
      const prior = completedAsOf(h4, TIMEFRAME_MS['4h'], asOf, ATR_BARS);
      if (prior.length < 20) {
        missing += 1;
        continue;
      }
      const atr = atrLatest(
        prior.map((c) => c.high),
        prior.map((c) => c.low),
        prior.map((c) => c.close),
      );
      // Strictly forward: bar i is the decision and is excluded.
      const fwd = h1.slice(i + 1, i + 1 + HORIZON_H);
      if (fwd.length < HORIZON_H || !Number.isFinite(atr) || atr === 0) {
        missing += 1;
        continue;
      }
      const rawRange = Math.max(...fwd.map((c) => c.high)) - Math.min(...fwd.map((c) => c.low));
      obs.push({
        coin,
        time: h1[i].time.getTime(),
        rawRange,
        rangeAtr: rawRange / atr,
        atr,
        entry: Number(r.entry),
        plannedR: Number(r.plannedR),
        sources: Number(r.sources),
        riskPercent: Number(r.riskPercent),
      });
    }
    console.log(`${coin.padEnd(5)} ${obs.filter((o) => o.coin === coin).length} observations`);
  }

  obs.sort((a, b) => a.time - b.time);
  const t0 = obs[0].time;
  const t1 = obs[obs.length - 1].time;
  const cut = t0 + (t1 - t0) * 0.7;
  const tune = obs.filter((o) => o.time < cut);
  const hold = obs.filter((o) => o.time >= cut);
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nZONES vs RANGE — ${HORIZON_H}h forward high-low travel`);
  console.log(`${obs.length} observations (${missing} dropped) · TUNE ${tune.length} · HOLDOUT ${hold.length}`);
  console.log(`HOLDOUT ${day(cut)} → ${day(t1)}\n`);

  const line = (
    label: string,
    set: Obs[],
    xf: (o: Obs) => number,
    yf: (o: Obs) => number,
  ): Record<string, string | number> => {
    const x = set.map(xf);
    const y = set.map(yf);
    const ci = blockCorr(
      set.map((o, i) => ({ time: o.time, x: x[i], y: y[i] })),
      BLOCK_DAYS,
      B,
      12345,
    );
    const r = pearson(x, y);
    return {
      predictor: label,
      n: set.length,
      pearson: r.toFixed(3),
      spearman: spearman(x, y).toFixed(3),
      'r^2': (r * r).toFixed(3),
      '95% CI': `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
      blocks: ci.blocks,
    };
  };

  console.log('1. BASELINE — ATR predicting RAW range (expected to be strong; it is a tautology)');
  console.table([
    line('ATR -> raw range (TUNE)', tune, (o) => o.atr, (o) => o.rawRange),
    line('ATR -> raw range (HOLDOUT)', hold, (o) => o.atr, (o) => o.rawRange),
  ]);

  console.log('\n2. THE REAL TEST — zone geometry vs range AFTER ATR is divided out (HOLDOUT)');
  console.table([
    line('plannedR (zone spacing)', hold, (o) => o.plannedR, (o) => o.rangeAtr),
    line('sources (confluence count)', hold, (o) => o.sources, (o) => o.rangeAtr),
    line('riskPercent (stop geometry)', hold, (o) => o.riskPercent, (o) => o.rangeAtr),
    line('ATR itself (control)', hold, (o) => o.atr, (o) => o.rangeAtr),
    // riskPercent is roughly (1 ATR + zone gap) / price, so it shares ATR with
    // the target's denominator. If ATR/price alone reproduces riskPercent's
    // correlation, riskPercent contributes no zone information and the number
    // is a ratio artifact rather than a finding.
    line('ATR/price (artifact control)', hold, (o) => o.atr / o.entry, (o) => o.rangeAtr),
  ]);

  console.log('\n   same on TUNE, to show it is not a holdout accident');
  console.table([
    line('plannedR (zone spacing)', tune, (o) => o.plannedR, (o) => o.rangeAtr),
    line('sources (confluence count)', tune, (o) => o.sources, (o) => o.rangeAtr),
    line('riskPercent (stop geometry)', tune, (o) => o.riskPercent, (o) => o.rangeAtr),
    line('ATR/price (artifact control)', tune, (o) => o.atr / o.entry, (o) => o.rangeAtr),
  ]);

  // What the target actually looks like, so the correlations have a scale.
  const rs = hold.map((o) => o.rangeAtr).sort((a, b) => a - b);
  console.log(
    `\nrealised range/ATR on HOLDOUT — median ${rs[Math.floor(rs.length / 2)].toFixed(2)}` +
      ` · p10 ${rs[Math.floor(rs.length * 0.1)].toFixed(2)}` +
      ` · p90 ${rs[Math.floor(rs.length * 0.9)].toFixed(2)}`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
