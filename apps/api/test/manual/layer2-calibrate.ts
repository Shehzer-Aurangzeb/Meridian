/**
 * Layer 2 — fit the calibration tables and run their falsification bars.
 *
 *   pnpm --filter api layer2-calibrate
 *   pnpm --filter api layer2-calibrate -- --shuffle
 *
 * Three outputs, scored independently. A partial pass is a legitimate result:
 * if the cone calibrates and zone bounce does not, the cone ships and no zone
 * probability is ever published.
 *
 *   expected-move cone   coverage within 3 points of nominal at 50/80/90%
 *   zone bounce          ECE < 5 points AND Brier beats the base-rate baseline
 *   regime exit          ECE < 5 points
 *
 * ─── Why Brier is the condition that carries weight ──────────────────────
 * A model that only ever emits the base rate is PERFECTLY calibrated and
 * useless. ECE cannot tell that apart from a model that knows something. Only
 * the zone-bounce row demands both, because it is the only one making a
 * conditional claim — the cone is scored on coverage, and the regime table is
 * a base rate by construction.
 *
 * ─── Guards ──────────────────────────────────────────────────────────────
 * Tables are fitted on TRAIN rows only and scored on the last 182 days,
 * touched once. Intervals come from a 30-day block bootstrap, because these
 * observations overlap in time and effective n runs one to two orders below
 * raw n. `--shuffle` permutes the outcomes within each bucket key, which must
 * destroy any Brier advantage; a shuffled run that still beats the base rate
 * means the advantage was an artefact of the bucketing.
 *
 * Zones are rebuilt as they stood, via `LevelMapService.buildFrom` with
 * candles sliced by `completedAsOf` — the same guard the plan replay uses, so
 * no bar that had not closed at the decision time can reach the map.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { LevelMapService, LEVEL_TIMEFRAMES, ATR_TIMEFRAME } from '../../src/analysis/services/level-map.service';
import { CANDLE_LIMITS, Timeframe } from '../../src/common/constants/timeframes';
import { TimeInterval, Candle } from '../../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { isTouch, resolveTouch, emptyTally, bounceRate, ResolutionTally, RESOLUTION_WINDOW_BARS } from '../../src/calibration/resolution';
import { reliability, fitTable, lookup, coverage, CalibrationTable, MIN_SAMPLE_FOR_PROBABILITY } from '../../src/calibration/calibration';
import { classifyWithHysteresis, REGIME_HYSTERESIS, MarketRegimeLabel } from '../../src/market-regime/regime-hysteresis';
import { conesForHour, trailingBaseline, CoinFeatures } from '../../src/expected-move/expected-move.math';
import { FEATURE_ORDER, BASELINE_WINDOW_HOURS, HORIZONS, ExpectedMoveHorizon } from '../../src/expected-move/fitted';
import { load } from './phase-b';
import { blockBootstrapMean } from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const PANEL = str('panel', 'test/manual/results/panel.csv');
const OUT_DIR = str('out', 'test/manual/results');
const TABLE_OUT = str('tables', 'src/calibration/tables.json');
export const CACHE_DIR = str('cache', path.join(process.env.HOME ?? '', 'meridian-archive/calib-candles'));
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const HOLDOUT_DAYS = num('holdout-days', 182);
/** Decision cadence, in hours. Matches the production schedule. */
const CADENCE_HOURS = num('cadence', 8);
const SEED = num('seed', 12345);
const SHUFFLE = args.includes('--shuffle');

// Bars, declared before any result.
const BAR_COVERAGE_POINTS = num('bar-coverage', 3);
const BAR_ECE_POINTS = num('bar-ece', 5);

const pctl = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// ── candles, fetched once and cached ──────────────────────────────────────

export async function candlesFor(
  binance: BinanceService,
  coin: string,
  tf: Timeframe,
  bars: number,
): Promise<Candle[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${coin}-${tf}.json`);
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<[number, number, number, number, number, number]>;
    return raw.map(([t, o, h, l, c, v]) => ({
      time: new Date(t), open: o, high: h, low: l, close: c, volume: v,
    }));
  }
  const got = await binance.getCandlesPaged(coin, tf as TimeInterval, bars);
  fs.writeFileSync(
    file,
    JSON.stringify(got.map((c) => [c.time.getTime(), c.open, c.high, c.low, c.close, c.volume])),
  );
  return got;
}

// ── the three replays ─────────────────────────────────────────────────────

interface ZoneObservation {
  time: number;
  key: string;
  outcome: 0 | 1;
}

/** Confluence count bucketed, because 7 sources and 8 are not different facts. */
const sourceBucket = (n: number): string => (n <= 1 ? '1' : n === 2 ? '2' : '3+');

async function replayZones(
  binance: BinanceService,
  indicators: IndicatorsService,
  levelMap: LevelMapService,
  coin: string,
  regimeAt: (ms: number) => MarketRegimeLabel | null,
): Promise<{ observations: ZoneObservation[]; tally: ResolutionTally }> {
  const series = new Map<Timeframe, Candle[]>();
  for (const tf of LEVEL_TIMEFRAMES) {
    const span = Math.ceil((32_000 * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[tf]);
    series.set(tf, await candlesFor(binance, coin, tf, CANDLE_LIMITS[tf] + span + 10));
  }
  const h1 = series.get('1h') ?? [];
  const observations: ZoneObservation[] = [];
  const tally = emptyTally();
  if (h1.length === 0) return { observations, tally };

  const step = CADENCE_HOURS;
  // Leave room for the touch window plus its resolution window at the right edge.
  const lastUsable = h1.length - (CADENCE_HOURS + RESOLUTION_WINDOW_BARS + 1);

  for (let i = 300; i < lastUsable; i += step) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h']; // the bar's CLOSE

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

    const regime = regimeAt(asOf);
    // Watch the next CADENCE_HOURS of 1h bars for the FIRST touch of each zone.
    // First touch only: the same zone touched three times in a window is one
    // fact about that zone, not three, and counting each would triple-weight
    // whatever the market was doing that afternoon.
    for (const zone of map.zones) {
      for (let j = i + 1; j <= i + CADENCE_HOURS && j < h1.length; j += 1) {
        if (!isTouch(h1[j], zone, map.atr)) continue;
        const outcome = resolveTouch(zone, map.atr, h1.slice(j + 1, j + 1 + RESOLUTION_WINDOW_BARS));
        tally[outcome] += 1;
        if (outcome === 'bounce' || outcome === 'break') {
          observations.push({
            time: h1[j].time.getTime(),
            key: `${zone.type}|src${sourceBucket(zone.sources.length)}|${regime ?? 'UNKNOWN'}`,
            outcome: outcome === 'bounce' ? 1 : 0,
          });
        }
        break;
      }
    }
  }
  return { observations, tally };
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  // 40,000 level-map builds each log three lines at DEBUG. The result is the
  // point of this run, not the tracing.
  Logger.overrideLogger(['error', 'warn']);
  // A plain map, as test/manual/analyze.ts uses: this replays history from a
  // disk cache and never needs TTL semantics.
  const store = new Map<string, unknown>();
  const cache = {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
    del: (k: string) => Promise.resolve(store.delete(k)),
  } as unknown as Cache;
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();
  const sr = new SupportResistanceService();
  const levelMap = new LevelMapService(binance, sr, indicators);

  const panel = load(PANEL);
  const nC = panel.coins.length;
  const nT = panel.times.length;
  const holdoutLo = nT - HOLDOUT_DAYS * 24;
  const holdoutFromMs = panel.times[holdoutLo];

  console.log(`\nLAYER 2 — CALIBRATION${SHUFFLE ? '  [SHUFFLED CONTROL]' : ''}`);
  console.log(`panel      ${PANEL}  ${nT.toLocaleString()} hours x ${nC} coins`);
  console.log(`holdout    last ${HOLDOUT_DAYS} days from ${new Date(holdoutFromMs).toISOString().slice(0, 10)}, touched once`);
  console.log(`\n── bars, declared before any result ──`);
  console.log(`cone         coverage within ${BAR_COVERAGE_POINTS} points of nominal at 50/80/90%`);
  console.log(`zone bounce  ECE < ${BAR_ECE_POINTS} points AND Brier beats the base-rate baseline`);
  console.log(`regime exit  ECE < ${BAR_ECE_POINTS} points`);
  console.log(`min sample   ${MIN_SAMPLE_FOR_PROBABILITY} per bucket, else the table says null\n`);

  const tables: Record<string, CalibrationTable> = {};

  // ══ 1. the expected-move cone ═══════════════════════════════════════════
  console.log('── cone coverage ──');
  const close = panel.data.get('close')!;
  const cols = FEATURE_ORDER.map((f) => panel.data.get(f)!);
  const closes: number[][] = [];
  for (let ci = 0; ci < nC; ci += 1) {
    const s = new Array<number>(nT);
    for (let ti = 0; ti < nT; ti += 1) s[ti] = close[ti * nC + ci];
    closes.push(s);
  }

  let conePass = true;
  const coneLines = ['horizon,band,nominal,coverage,n'];
  for (const horizon of HORIZONS as readonly ExpectedMoveHorizon[]) {
    const p50: Array<{ bound: number; actual: number }> = [];
    const p80: Array<{ bound: number; actual: number }> = [];
    const p90: Array<{ bound: number; actual: number }> = [];

    for (let ti = holdoutLo; ti + horizon < nT; ti += 1) {
      const rows: CoinFeatures[] = [];
      const actual: number[] = [];
      for (let ci = 0; ci < nC; ci += 1) {
        const a = closes[ci][ti];
        const b = closes[ci][ti + horizon];
        if (!(a > 0) || !(b > 0)) continue;
        const baseline = trailingBaseline(closes[ci].slice(0, ti + 1), horizon, BASELINE_WINDOW_HOURS);
        if (baseline === null) continue;
        rows.push({ symbol: panel.coins[ci], features: cols.map((c) => c[ti * nC + ci]), baseline });
        actual.push(Math.abs(Math.log(b / a)));
      }
      if (rows.length < 2) continue;
      const cones = conesForHour(rows, horizon);
      rows.forEach((r, i) => {
        const c = cones.get(r.symbol)!;
        p50.push({ bound: c.p50, actual: actual[i] });
        p80.push({ bound: c.p80, actual: actual[i] });
        p90.push({ bound: c.p90, actual: actual[i] });
      });
    }

    for (const [nominal, pairs] of [[0.5, p50], [0.8, p80], [0.9, p90]] as const) {
      const got = coverage(pairs);
      const points = Math.abs(got - nominal) * 100;
      const ok = points <= BAR_COVERAGE_POINTS;
      conePass = conePass && ok;
      console.log(
        `  ${String(horizon).padStart(2)}h  p${(nominal * 100).toFixed(0)}  ` +
          `nominal ${(nominal * 100).toFixed(0)}%  actual ${(got * 100).toFixed(1)}%  ` +
          `off by ${points.toFixed(1)} pts  n=${pairs.length.toLocaleString()}  ${ok ? 'PASS' : 'FAIL'}`,
      );
      coneLines.push([horizon, `p${nominal * 100}`, nominal, got, pairs.length].join(','));
    }
  }
  console.log(`  cone: ${conePass ? 'PASS' : 'FAIL'}`);

  // ══ 2. regime exit ══════════════════════════════════════════════════════
  console.log('\n── regime exit within 24h ──');
  const bw = panel.data.get('bandWidth')!;
  const adx = panel.data.get('adx')!;
  const regimeSeries: Array<Array<MarketRegimeLabel | null>> = [];
  const ageSeries: number[][] = [];

  for (let ci = 0; ci < nC; ci += 1) {
    const hist: number[] = [];
    const labels: Array<MarketRegimeLabel | null> = new Array(nT).fill(null);
    const ages = new Array<number>(nT).fill(0);
    let prev: MarketRegimeLabel | null = null;
    for (let ti = 0; ti < nT; ti += 1) {
      const v = bw[ti * nC + ci];
      const a = adx[ti * nC + ci];
      if (hist.length >= REGIME_HYSTERESIS.bandWidthLookback && Number.isFinite(v) && Number.isFinite(a)) {
        const d = classifyWithHysteresis(v, a, hist.slice(-REGIME_HYSTERESIS.bandWidthLookback), prev);
        labels[ti] = d.regime;
        ages[ti] = prev === d.regime ? ages[ti - 1] + 1 : 1;
        prev = d.regime;
      }
      if (Number.isFinite(v)) hist.push(v);
    }
    regimeSeries.push(labels);
    ageSeries.push(ages);
  }

  const ageBand = (h: number): string =>
    h < 6 ? '0-6h' : h < 12 ? '6-12h' : h < 24 ? '12-24h' : h < 48 ? '24-48h' : '48h+';

  const regimeTrain: Array<{ key: string; outcome: 0 | 1 }> = [];
  const regimeHold: Array<{ key: string; outcome: 0 | 1; time: number }> = [];
  for (let ci = 0; ci < nC; ci += 1) {
    for (let ti = 0; ti + 24 < nT; ti += 1) {
      const label = regimeSeries[ci][ti];
      if (label === null || regimeSeries[ci][ti + 24] === null) continue;
      const key = `${label}|${ageBand(ageSeries[ci][ti])}`;
      const outcome: 0 | 1 = regimeSeries[ci][ti + 24] !== label ? 1 : 0;
      if (ti < holdoutLo) regimeTrain.push({ key, outcome });
      else regimeHold.push({ key, outcome, time: panel.times[ti] });
    }
  }

  const regimeTable = fitTable('regime-exit-24h', regimeTrain, 0);
  tables['regime-exit-24h'] = regimeTable;

  const regimePairs = regimeHold.map((o) => ({
    predicted: lookup(regimeTable, o.key).probability,
    outcome: o.outcome,
  }));
  const regimeRel = reliability(regimePairs);
  const regimeOk = regimeRel.ece * 100 < BAR_ECE_POINTS;
  console.log(`  train ${regimeTrain.length.toLocaleString()} rows, holdout ${regimeHold.length.toLocaleString()}`);
  console.log(`  buckets ${regimeTable.rows.length}, of which quotable ${regimeTable.rows.filter((r) => r.probability !== null).length}`);
  console.log(
    `  ECE ${(regimeRel.ece * 100).toFixed(2)} pts (bar < ${BAR_ECE_POINTS})  ` +
      `Brier ${regimeRel.brier.toFixed(4)} vs base ${regimeRel.brierBaseRate.toFixed(4)}` +
      `${regimeRel.brier < regimeRel.brierBaseRate ? ' (beats base)' : ' (WORSE than base)'}  ` +
      `base rate ${(regimeRel.baseRate * 100).toFixed(1)}%  ${regimeOk ? 'PASS' : 'FAIL'}`,
  );
  console.log('  reliability:');
  for (const b of regimeRel.buckets) {
    console.log(
      `    ${(b.lo * 100).toFixed(0).padStart(3)}-${(b.hi * 100).toFixed(0).padStart(3)}%  ` +
        `predicted ${(b.predictedMean * 100).toFixed(1)}%  realised ${(b.realisedRate * 100).toFixed(1)}%  ` +
        `gap ${((b.realisedRate - b.predictedMean) * 100).toFixed(1)} pts  n=${b.n.toLocaleString()}`,
    );
  }
  console.log('  per bucket, train vs holdout:');
  for (const row of regimeTable.rows) {
    const hold = regimeHold.filter((o) => o.key === row.key);
    if (hold.length === 0) continue;
    const realised = hold.reduce((s, o) => s + o.outcome, 0) / hold.length;
    console.log(
      `    ${row.key.padEnd(24)} train ${((row.probability ?? regimeTable.baseRate) * 100).toFixed(1)}%` +
        ` (n=${row.n.toLocaleString()})  holdout ${(realised * 100).toFixed(1)}% (n=${hold.length.toLocaleString()})` +
        `  drift ${((realised - (row.probability ?? regimeTable.baseRate)) * 100).toFixed(1)} pts`,
    );
  }

  // ══ 3. zone bounce ══════════════════════════════════════════════════════
  console.log('\n── zone bounce within 4h ──');
  const coinIndex = new Map(panel.coins.map((c, i) => [c, i]));
  const regimeAtFor = (coin: string) => (ms: number): MarketRegimeLabel | null => {
    const ci = coinIndex.get(coin);
    if (ci === undefined) return null;
    // Nearest panel hour at or before `ms`.
    const ti = Math.floor((ms - panel.times[0]) / 3_600_000);
    if (ti < 0 || ti >= nT) return null;
    return regimeSeries[ci][ti];
  };

  const zoneTrain: Array<{ key: string; outcome: 0 | 1 }> = [];
  const zoneHold: Array<{ key: string; outcome: 0 | 1; time: number }> = [];
  const tally = emptyTally();

  for (const coin of COINS) {
    const got = await replayZones(binance, indicators, levelMap, coin, regimeAtFor(coin));
    for (const k of ['bounce', 'break', 'neither', 'ambiguous'] as const) tally[k] += got.tally[k];
    for (const o of got.observations) {
      if (o.time < holdoutFromMs) zoneTrain.push({ key: o.key, outcome: o.outcome });
      else zoneHold.push(o);
    }
    process.stdout.write(`  ${coin} `);
  }
  console.log('');

  const rates = bounceRate(tally);
  console.log(
    `  touches ${rates.total.toLocaleString()}: bounce ${tally.bounce.toLocaleString()}, ` +
      `break ${tally.break.toLocaleString()}, neither ${tally.neither.toLocaleString()}, ` +
      `ambiguous ${tally.ambiguous.toLocaleString()}`,
  );
  console.log(`  UNRESOLVED SHARE ${(rates.unresolvedShare * 100).toFixed(1)}% — published, never hidden`);

  let zoneOk = false;
  if (zoneHold.length === 0 || zoneTrain.length === 0) {
    console.log('  not enough resolved touches to calibrate');
  } else {
    let trainForFit = zoneTrain;
    if (SHUFFLE) {
      // Permute outcomes across the training set, destroying any link between
      // bucket key and result. A table fitted on this must not beat the base rate.
      const rng = makeRng(SEED);
      const outcomes = trainForFit.map((o) => o.outcome);
      for (let i = outcomes.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
      }
      trainForFit = trainForFit.map((o, i) => ({ key: o.key, outcome: outcomes[i] }));
    }

    const zoneTable = fitTable('zone-bounce-4h', trainForFit, rates.unresolvedShare);
    tables['zone-bounce-4h'] = zoneTable;

    const pairs = zoneHold.map((o) => ({
      predicted: lookup(zoneTable, o.key).probability,
      outcome: o.outcome,
    }));
    const rel = reliability(pairs);
    const beatsBase = rel.brier < rel.brierBaseRate;
    const eceOk = rel.ece * 100 < BAR_ECE_POINTS;
    zoneOk = eceOk && beatsBase;

    // Block bootstrap on the Brier ADVANTAGE, because the touches overlap in
    // time and a naive comparison of two means would overstate the evidence.
    const advantage = zoneHold.map((o, i) => ({
      time: o.time,
      value: (rel.baseRate - o.outcome) ** 2 - (pairs[i].predicted - o.outcome) ** 2,
    }));
    const boot = blockBootstrapMean(advantage, 30, 2000, SEED);

    console.log(`  train ${zoneTrain.length.toLocaleString()} resolved, holdout ${zoneHold.length.toLocaleString()}`);
    console.log(`  buckets ${zoneTable.rows.length}, quotable ${zoneTable.rows.filter((r) => r.probability !== null).length}`);
    console.log(`  base rate ${(rel.baseRate * 100).toFixed(1)}%`);
    console.log(
      `  ECE ${(rel.ece * 100).toFixed(2)} pts (bar < ${BAR_ECE_POINTS}) ${eceOk ? 'ok' : 'FAIL'}  ` +
        `Brier ${rel.brier.toFixed(5)} vs base ${rel.brierBaseRate.toFixed(5)} ${beatsBase ? 'ok' : 'FAIL'}`,
    );
    console.log(
      `  Brier advantage ${(rel.brierBaseRate - rel.brier).toExponential(3)}, ` +
        `95% block-bootstrap [${boot.lo.toExponential(3)}, ${boot.hi.toExponential(3)}] over ${boot.blocks} blocks`,
    );
    console.log('  predicted probability by bucket key — is there ANY spread?');
    const quotable = zoneTable.rows.filter((r) => r.probability !== null);
    const spread = quotable.length === 0 ? 0 :
      Math.max(...quotable.map((r) => r.probability!)) - Math.min(...quotable.map((r) => r.probability!));
    for (const row of quotable) {
      console.log(`    ${row.key.padEnd(34)} ${((row.probability ?? 0) * 100).toFixed(1)}%  n=${row.n.toLocaleString()}`);
    }
    console.log(`    spread across keys: ${(spread * 100).toFixed(1)} points`);
    console.log(`  reliability:`);
    for (const b of rel.buckets) {
      console.log(
        `    ${(b.lo * 100).toFixed(0).padStart(3)}-${(b.hi * 100).toFixed(0).padStart(3)}%  ` +
          `predicted ${(b.predictedMean * 100).toFixed(1)}%  realised ${(b.realisedRate * 100).toFixed(1)}%  n=${b.n.toLocaleString()}`,
      );
    }
    console.log(`  zone bounce: ${zoneOk ? 'PASS' : 'FAIL'}`);
  }

  // ── write what was fitted ──
  fs.writeFileSync(path.join(OUT_DIR, 'layer2-cone-coverage.csv'), coneLines.join('\n') + '\n');
  if (!SHUFFLE) fs.writeFileSync(TABLE_OUT, JSON.stringify(tables, null, 2) + '\n');

  console.log('\n── verdict ──');
  console.log(`cone ${conePass ? 'PASS' : 'FAIL'}   zone bounce ${zoneOk ? 'PASS' : 'FAIL'}   regime exit ${regimeOk ? 'PASS' : 'FAIL'}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
