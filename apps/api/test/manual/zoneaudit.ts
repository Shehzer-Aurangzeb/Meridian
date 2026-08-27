/**
 * ZONE_AUDIT.md measurements. One question per run.
 *
 *   npx ts-node --transpile-only test/manual/zoneaudit.ts --q1 --coins BTC,ETH,SOL --bars 200
 *   npx ts-node --transpile-only test/manual/zoneaudit.ts --q2 --coins BTC,ETH,SOL --bars 200
 *   npx ts-node --transpile-only test/manual/zoneaudit.ts --self-check
 *
 * Q1  are the zones an artefact of the grouping ORDER?
 * Q2  is the confluence real, or can two marks from one method fake it?
 *
 * Read-only: fetches candles, writes nothing.
 */
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import {
  ATR_TIMEFRAME,
  LevelMap,
  LevelMapService,
  LEVEL_TIMEFRAMES,
} from '../../src/analysis/services/level-map.service';
import { TradePlanService } from '../../src/analysis/services/trade-plan.service';
import {
  ConfluenceZone,
  MarkedLevel,
  SR_DEFAULTS,
  ZoneTier,
  TIER_ORDER,
} from '../../src/analysis/interfaces/support-resistance.types';
import { CANDLE_LIMITS } from '../../src/common/constants/timeframes';
import { TimeInterval } from '../../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { makeRng } from './rng';

// Each map build logs three debug lines; hundreds of bars of that buries the result.
Logger.overrideLogger(false);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COINS = str('coins', 'BTC,ETH,SOL').split(',').map((c) => c.trim().toUpperCase());
const BARS = num('bars', 200);
const JITTER_PCT = num('jitter', 0.05);
const SEED = num('seed', 12345);

const THRESHOLD = SR_DEFAULTS.CLUSTER_THRESHOLD;
const MAX_SPAN = SR_DEFAULTS.CLUSTER_THRESHOLD * 2;
const MIN_SOURCES = 2;

const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (a: number, b: number) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(0)}%`);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// ── shared replay ───────────────────────────────────────────────────────

/** Rebuilds the level map at every 1h bar in the window, exactly as it stood then. */
async function eachMap(
  coin: string,
  binance: BinanceService,
  levelMap: LevelMapService,
  visit: (map: LevelMap, bar: number) => void,
): Promise<number> {
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
  // Nothing here scores a trade, so the only bar to exclude is the forming one.
  const lastDecision = h1.length - 2;
  const firstDecision = Math.max(CANDLE_LIMITS['1h'], lastDecision - BARS + 1);
  if (lastDecision < firstDecision) {
    throw new Error(`${coin}: ${h1.length} 1h candles is too few. Lower --bars.`);
  }

  let bars = 0;
  for (let i = firstDecision; i <= lastDecision; i++) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];
    const truncated = series.map((s) => ({
      timeframe: s.timeframe,
      candles: completedAsOf(s.candles, TIMEFRAME_MS[s.timeframe], asOf, CANDLE_LIMITS[s.timeframe]),
    }));
    if (truncated.some((t) => t.candles.length < 50)) continue;

    const atrCandles = truncated.find((t) => t.timeframe === ATR_TIMEFRAME)?.candles ?? [];
    const map = levelMap.buildFrom(coin, truncated, atrCandles);
    if (map.zones.length === 0) continue;
    bars += 1;
    visit(map, i);
  }
  return bars;
}

// ── Q1: is the zone an artefact of grouping order? ──────────────────────

/**
 * The grouping walk from support-resistance.service.ts:363-418, with a
 * direction parameter added.
 *
 * It has to be duplicated: `findConfluenceZones` re-sorts its input, so it
 * cannot be asked to run backwards from outside. Every line else is a
 * transcription on purpose — `assertIdentical` checks 'up' against the real
 * service on every bar, so tidying anything here would invalidate the reversed
 * run it exists to justify.
 */
function group(marks: MarkedLevel[], currentPrice: number, dir: 'up' | 'down'): ConfluenceZone[] {
  if (marks.length === 0) return [];

  const sorted = [...marks].sort((a, b) =>
    dir === 'up' ? a.price - b.price : b.price - a.price,
  );
  const groups: MarkedLevel[][] = [];
  let current: MarkedLevel[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const avg = current.reduce((sum, m) => sum + m.price, 0) / current.length;
    const apart = Math.abs((sorted[i].price - avg) / avg) * 100;

    const prices = current.map((m) => m.price);
    const spanLow = Math.min(...prices, sorted[i].price);
    const spanHigh = Math.max(...prices, sorted[i].price);
    const span = ((spanHigh - spanLow) / ((spanHigh + spanLow) / 2)) * 100;

    if (apart <= THRESHOLD && span <= MAX_SPAN) current.push(sorted[i]);
    else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);

  return groups
    .map((g) => {
      const prices = g.map((m) => m.price);
      const low = Math.min(...prices);
      const high = Math.max(...prices);
      const center = prices.reduce((a, b) => a + b, 0) / prices.length;
      const sources = [...new Set(g.map((m) => m.source))];
      const tier = TIER_ORDER.find((tr) => g.some((m) => m.tier === tr)) as ZoneTier;
      const type = center < currentPrice ? ('support' as const) : ('resistance' as const);
      return {
        low,
        high,
        center,
        type,
        sources,
        spanPercent: center === 0 ? 0 : ((high - low) / center) * 100,
        distancePercent: ((center - currentPrice) / currentPrice) * 100,
        tier,
      };
    })
    .filter((z) => z.sources.length >= MIN_SOURCES)
    .sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent));
}

/** Run on every bar, not once: a guard that checks bar 0 and sets a flag proves bar 0. */
function assertIdentical(mine: ConfluenceZone[], theirs: ConfluenceZone[], where: string): void {
  const a = JSON.stringify(mine);
  const b = JSON.stringify(theirs);
  if (a !== b) {
    throw new Error(
      `group() has drifted from findConfluenceZones at ${where}; nothing reported.\n` +
        `  mine:   ${a.slice(0, 300)}\n  theirs: ${b.slice(0, 300)}`,
    );
  }
}

interface Drift { rMultiple: number; vanished: boolean }

/**
 * Matched to the NEAREST perturbed zone by centre — the most generous reading
 * available, so it cannot manufacture instability. >1R means nothing survived
 * within one risk unit: the zone stopped existing rather than moved.
 */
function drift(zone: ConfluenceZone, perturbed: ConfluenceZone[], riskPerUnit: number): Drift {
  if (perturbed.length === 0 || !(riskPerUnit > 0)) return { rMultiple: Infinity, vanished: true };
  const nearest = perturbed.reduce((best, z) =>
    Math.abs(z.center - zone.center) < Math.abs(best.center - zone.center) ? z : best,
  );
  const rMultiple = Math.abs(nearest.center - zone.center) / riskPerUnit;
  return { rMultiple, vanished: rMultiple > 1 };
}

interface Q1Row { rev: Drift[]; jit: Drift[]; zones: number; revZones: number; jitZones: number; bars: number }

async function q1(
  binance: BinanceService,
  levelMap: LevelMapService,
  sr: SupportResistanceService,
  planner: TradePlanService,
): Promise<void> {
  const rng = makeRng(SEED);
  console.log(
    `Q1 zone stability · coins=${COINS.join(',')} bars=${BARS} jitter=±${JITTER_PCT}% seed=${SEED}\n` +
      `threshold=${THRESHOLD}% max-span=${MAX_SPAN}% min-sources=${MIN_SOURCES}\n`,
  );

  const rows = new Map<string, Q1Row>();
  for (const coin of COINS) {
    const row: Q1Row = { rev: [], jit: [], zones: 0, revZones: 0, jitZones: 0, bars: 0 };
    row.bars = await eachMap(coin, binance, levelMap, (map, bar) => {
      assertIdentical(group(map.marks, map.spot, 'up'), map.zones, `${coin} bar ${bar}`);

      const reversed = group(map.marks, map.spot, 'down');
      const jittered = sr.findConfluenceZones(
        map.marks.map((m) => ({
          ...m,
          price: m.price * (1 + (rng() * 2 - 1) * (JITTER_PCT / 100)),
        })),
        map.spot,
      );

      row.zones += map.zones.length;
      row.revZones += reversed.length;
      row.jitZones += jittered.length;

      for (const zone of map.zones) {
        const plan = planner.buildPlan(
          zone,
          zone.type === 'support' ? 'long' : 'short',
          map.spot,
          map.atr,
          map.zones,
        );
        row.rev.push(drift(zone, reversed, plan.riskPerUnit));
        row.jit.push(drift(zone, jittered, plan.riskPerUnit));
      }
    });
    rows.set(coin, row);
    console.log(`${coin.padEnd(5)} ${row.bars} bars · ${row.zones} zones`);
  }

  const line = (name: string, d: Drift[], baseZones: number, permZones: number): void => {
    const finite = d.map((x) => x.rMultiple).filter(Number.isFinite).sort((a, b) => a - b);
    const moved = d.filter((x) => x.rMultiple > 0).length;
    const broken = d.filter((x) => x.vanished).length;
    console.log(
      `${name.padEnd(7)} ${String(baseZones).padEnd(7)} ${pct(moved, d.length).padEnd(10)} ` +
        `${f(quantile(finite, 0.5)).padEnd(11)} ${f(quantile(finite, 0.9)).padEnd(9)} ` +
        `${(pct(broken, d.length) + ` (${broken})`).padEnd(14)} ${baseZones} → ${permZones}`,
    );
  };

  const report = (label: string, pick: (r: Q1Row) => Drift[], count: (r: Q1Row) => number): void => {
    console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
    console.log('coin    zones   moved>0    median R    p90 R     >1R (broken)   zone count');
    const all: Drift[] = [];
    let base = 0;
    let perm = 0;
    for (const [coin, row] of rows) {
      all.push(...pick(row));
      base += row.zones;
      perm += count(row);
      line(coin, pick(row), row.zones, count(row));
    }
    if (rows.size > 1) line('ALL', all, base, perm);
  };

  report('REVERSE — same marks, walked top-down', (r) => r.rev, (r) => r.revZones);
  report(`JITTER — every mark moved ±${JITTER_PCT}%`, (r) => r.jit, (r) => r.jitZones);
  console.log('\nDrift is |Δ centre| over that trade\'s own entry-to-stop distance.');
}

// ── Q2: is the confluence real? ─────────────────────────────────────────

/**
 * A source string reduced to METHOD + CHART, which is what "independent
 * agreement" was supposed to mean (level-map.ts:153).
 *
 *   '12h support' / '12h resistance'   -> '12h swing'   both are 12h swing points
 *   '0.25 Fib (12h)' / '0.5 Fib (12h)' -> 'fib 12h'     both are one grid on one chart
 *
 * An unrecognised shape is returned unchanged rather than merged, so a future
 * source can only ever make this measurement look better, never worse.
 */
export function strictSource(source: string): string {
  const fib = source.match(/^[\d.]+ Fib \((.+)\)$/);
  if (fib) return `fib ${fib[1]}`;
  const swing = source.match(/^(.+) (?:support|resistance)$/);
  if (swing) return `${swing[1]} swing`;
  return source;
}

interface Q2Row {
  zones: number;
  strict: number[];      // strict source count per zone
  supRes: number;        // faked by support+resistance on one chart
  multiFib: number;      // faked by two fib ratios on one chart
  bars: number;
}

function classify(zone: ConfluenceZone): { strict: number; supRes: boolean; multiFib: boolean } {
  const strictSet = new Set(zone.sources.map(strictSource));
  const byStrict = new Map<string, number>();
  for (const s of zone.sources) {
    const k = strictSource(s);
    byStrict.set(k, (byStrict.get(k) ?? 0) + 1);
  }
  let supRes = false;
  let multiFib = false;
  for (const [k, n] of byStrict) {
    if (n < 2) continue;
    if (k.startsWith('fib ')) multiFib = true;
    else supRes = true;
  }
  return { strict: strictSet.size, supRes, multiFib };
}

async function q2(binance: BinanceService, levelMap: LevelMapService): Promise<void> {
  console.log(
    `Q2 confluence independence · coins=${COINS.join(',')} bars=${BARS}\n` +
      `strict rule: distinct METHOD (swing|fib) on distinct CHART, ${MIN_SOURCES}+ required\n`,
  );

  const rows = new Map<string, Q2Row>();
  for (const coin of COINS) {
    const row: Q2Row = { zones: 0, strict: [], supRes: 0, multiFib: 0, bars: 0 };
    row.bars = await eachMap(coin, binance, levelMap, (map) => {
      for (const zone of map.zones) {
        const c = classify(zone);
        row.zones += 1;
        row.strict.push(c.strict);
        if (c.supRes) row.supRes += 1;
        if (c.multiFib) row.multiFib += 1;
      }
    });
    rows.set(coin, row);
    console.log(`${coin.padEnd(5)} ${row.bars} bars · ${row.zones} zones`);
  }

  console.log('\n── zones that survive the stricter rule ──────────────────────');
  console.log('coin    zones   strict>=2   strict==1 (fake)   sup+res    2+ fib');
  const all: Q2Row = { zones: 0, strict: [], supRes: 0, multiFib: 0, bars: 0 };
  const line = (name: string, r: Q2Row): void => {
    const fake = r.strict.filter((n) => n < MIN_SOURCES).length;
    const real = r.zones - fake;
    console.log(
      `${name.padEnd(7)} ${String(r.zones).padEnd(7)} ` +
        `${(pct(real, r.zones) + ` (${real})`).padEnd(11)} ` +
        `${(pct(fake, r.zones) + ` (${fake})`).padEnd(18)} ` +
        `${pct(r.supRes, r.zones).padEnd(10)} ${pct(r.multiFib, r.zones)}`,
    );
  };
  for (const [coin, r] of rows) {
    all.zones += r.zones;
    all.strict.push(...r.strict);
    all.supRes += r.supRes;
    all.multiFib += r.multiFib;
    line(coin, r);
  }
  if (rows.size > 1) line('ALL', all);

  console.log('\n── how many independent methods a zone really has ────────────');
  const max = Math.max(...all.strict, 0);
  for (let n = 1; n <= max; n++) {
    const c = all.strict.filter((x) => x === n).length;
    console.log(`  ${n} source${n === 1 ? ' ' : 's'}  ${String(c).padStart(6)}  ${pct(c, all.zones)}`);
  }
  console.log(
    `\nLoose count is what the service enforces (${MIN_SOURCES}+ distinct strings).\n` +
      `"sup+res" and "2+ fib" are the two named mechanisms; a zone can show both.`,
  );
}

// ── self-check ──────────────────────────────────────────────────────────
function selfCheck(): void {
  const ok = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };
  const sr = new SupportResistanceService();
  const mark = (price: number, source: string, tier: ZoneTier = 'HTF'): MarkedLevel =>
    ({ price, type: 'support', source, tier });

  const marks = [
    mark(100.0, '12h support'), mark(100.3, '4h support'), mark(100.6, '1h support'),
    mark(103.0, '0.5 Fib (12h)'), mark(103.2, '12h resistance'), mark(110.0, '4h resistance'),
  ];
  assertIdentical(group(marks, 105, 'up'), sr.findConfluenceZones(marks, 105), 'self-check');

  // The guard must be able to fail, or it proves nothing.
  let fired = false;
  try {
    assertIdentical(group(marks, 105, 'up'), sr.findConfluenceZones(marks, 999), 'self-check');
  } catch { fired = true; }
  ok(fired, 'assertIdentical did not fire on genuinely different zones');

  // Order-dependence is the mechanism under test, so prove it still exists.
  // 100.0+100.4 pair walking up and 100.75 is then orphaned and filtered away;
  // walking down, 100.75+100.4 pair and 100.0 is the one discarded.
  const chain = [mark(100.0, 'a'), mark(100.4, 'b'), mark(100.75, 'c')];
  const up = group(chain, 105, 'up').map((z) => z.center);
  const down = group(chain, 105, 'down').map((z) => z.center);
  ok(up.length === 1 && Math.abs(up[0] - 100.2) < 1e-9, `up centre: ${up.join()}`);
  ok(down.length === 1 && Math.abs(down[0] - 100.575) < 1e-9, `down centre: ${down.join()}`);

  // Jitter must stay inside its bound or it manufactures the instability.
  const rng = makeRng(1);
  for (let i = 0; i < 5000; i++) {
    const moved = 100 * (1 + (rng() * 2 - 1) * (0.05 / 100));
    ok(Math.abs(moved - 100) <= 0.05 + 1e-12, `jitter escaped its bound: ${moved}`);
  }

  const zone: ConfluenceZone = {
    low: 100, high: 101, center: 100.5, type: 'support',
    sources: ['a', 'b'], spanPercent: 1, distancePercent: -4, tier: 'HTF',
  };
  ok(drift(zone, [], 2).vanished, 'empty perturbed set should be vanished');
  ok(drift(zone, [{ ...zone, center: 110 }], 2).vanished, '9.5 on a 2.0 risk unit is >1R');
  ok(Math.abs(drift(zone, [{ ...zone, center: 101 }], 2).rMultiple - 0.25) < 1e-12, 'R maths');

  ok(quantile([1, 2, 3], 0.5) === 2, 'median');
  ok(Number.isNaN(quantile([], 0.5)), 'empty quantile is NaN, not 0');

  // Q2: the two named fakes must collapse, genuine agreement must not.
  ok(strictSource('12h support') === '12h swing', 'swing support');
  ok(strictSource('12h resistance') === '12h swing', 'swing resistance');
  ok(strictSource('0.25 Fib (12h)') === 'fib 12h', 'fib ratio');
  ok(strictSource('1 Fib (12h)') === 'fib 12h', 'integer fib ratio');
  ok(strictSource('something new') === 'something new', 'unknown shape passes through');

  const z = (...sources: string[]): ConfluenceZone => ({ ...zone, sources });
  ok(classify(z('12h support', '12h resistance')).strict === 1, 'sup+res on one chart is one source');
  ok(classify(z('12h support', '12h resistance')).supRes, 'sup+res flagged');
  ok(classify(z('0.25 Fib (12h)', '0.5 Fib (12h)')).strict === 1, 'two fib ratios are one source');
  ok(classify(z('0.25 Fib (12h)', '0.5 Fib (12h)')).multiFib, '2+ fib flagged');
  ok(classify(z('12h support', '4h support')).strict === 2, 'two charts is genuine agreement');
  ok(!classify(z('12h support', '4h support')).supRes, 'two charts is not a fake');
  ok(classify(z('12h support', '0.5 Fib (12h)')).strict === 2, 'swing + fib is genuine');
  ok(classify(z('12h support', '12h resistance', '4h support')).strict === 2, 'mixed');

  console.log('self-check passed (bit-identity both ways, order-dependence, jitter, drift, quantile, strict sources)');
}

async function main(): Promise<void> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const levelMap = new LevelMapService(binance, new SupportResistanceService(), new IndicatorsService());
  if (args.includes('--q1')) {
    await q1(binance, levelMap, new SupportResistanceService(), new TradePlanService());
  } else if (args.includes('--q2')) {
    await q2(binance, levelMap);
  } else {
    console.log('pick a question: --q1 (stability) or --q2 (confluence independence), or --self-check');
  }
}

if (require.main === module && args.includes('--self-check')) {
  selfCheck();
} else if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
