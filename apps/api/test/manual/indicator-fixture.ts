/**
 * Indicator regression fixture.
 *
 *   npx ts-node test/manual/indicator-fixture.ts              # compare vs baseline
 *   npx ts-node test/manual/indicator-fixture.ts --write       # capture a new baseline
 *
 * ─── Why this exists ─────────────────────────────────────────────────────
 * Two separate incidents in this repo produced indicator values that were
 * structurally impossible and nobody noticed for months:
 *   - Bollinger band proximity computed to exactly 50.0% on every run,
 *     because the 20-period SMA was passed as "current price".
 *   - An RSI z-score computed against the PRICE series, giving values
 *     around -66 for BTC. A real z-score cannot be -66.
 *
 * So this fixture does two things on every run:
 *   1. INVARIANTS — assert values are inside their mathematically possible
 *      range. This is the check that would have caught both incidents.
 *   2. REGRESSION — compare full series against a committed baseline:
 *      length, first three, last three, and a checksum over every value.
 *
 * It runs against `IndicatorsService`, NOT the underlying library, because
 * our wiring is what has actually been wrong historically.
 *
 * Input is a committed 500-candle BTC/1h slice, so this is reproducible
 * forever with no network access.
 *
 * ─── Reading the comparison output ───────────────────────────────────────
 * `checksum` differing is not automatically a failure — float noise changes
 * it. Judge with `maxAbsDiff` / `maxRelDiff`. A LENGTH change is always
 * significant: `bandWidthSeries` is consumed whole by the regime
 * classifier's percentile, so its length is load-bearing (see INVARIANT
 * note in indicators.service.ts).
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

import { IndicatorsService } from '../../src/indicators/indicators.service';
import { Candle } from '../../src/common/types/candle.types';

const CANDLES = join(__dirname, '../fixtures/candles-btc-1h-500.json');
const BASELINE = join(__dirname, '../fixtures/indicator-baseline.json');
const WRITE = process.argv.includes('--write');

interface SeriesEntry {
  length: number;
  first3: number[];
  last3: number[];
  checksum: string;
}
type Scalars = Record<string, number | string>;
interface Baseline {
  library: string;
  candles: number;
  series: Record<string, SeriesEntry>;
  scalars: Scalars;
}

const P = 10; // decimals used for checksum + display
const round = (n: number) => Number(n.toFixed(P));

function digest(values: number[]): SeriesEntry {
  const h = createHash('sha256');
  for (const v of values) h.update(`${v.toFixed(P)};`);
  return {
    length: values.length,
    first3: values.slice(0, 3).map(round),
    last3: values.slice(-3).map(round),
    checksum: h.digest('hex').slice(0, 16),
  };
}

// ── invariants ──────────────────────────────────────────────────────────
// Each is a range a correct implementation cannot leave. These are the
// cheap checks that catch mis-wired inputs.
function assertInvariants(i: {
  rsiSeries: number[];
  bandWidthSeries: number[];
  bb: { upper: number; middle: number; lower: number };
  atr: number;
  adx: { adx: number; pdi: number; mdi: number; dx: number };
  qqe: { value: number };
  lastClose: number;
}) {
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) fails.push(msg);
  };

  ok(i.rsiSeries.every((v) => v >= 0 && v <= 100), 'RSI outside [0,100]');
  ok(i.rsiSeries.length > 0, 'RSI series empty');
  ok(i.qqe.value >= 0 && i.qqe.value <= 100, `QQE (smoothed RSI) outside [0,100]: ${i.qqe.value}`);

  ok(i.bb.lower < i.bb.middle && i.bb.middle < i.bb.upper, 'Bollinger bands not ordered lower<middle<upper');
  ok(i.bb.middle > 0, 'Bollinger middle not positive');
  // The 50%-forever bug: middle must NOT be the price we would compare against.
  ok(
    Math.abs(i.bb.middle - i.lastClose) > 1e-12,
    'Bollinger middle equals last close — the "50% every run" mis-wiring',
  );

  ok(i.bandWidthSeries.every((v) => v >= 0), 'negative bandwidth');
  ok(i.atr > 0, `ATR not positive: ${i.atr}`);
  ok(i.adx.adx >= 0 && i.adx.adx <= 100, `ADX outside [0,100]: ${i.adx.adx}`);
  ok(i.adx.pdi >= 0 && i.adx.mdi >= 0, 'negative DI');

  if (fails.length > 0) {
    throw new Error(`INVARIANT FAILURES:\n  - ${fails.join('\n  - ')}`);
  }
}

function compute(): Baseline {
  const raw = JSON.parse(readFileSync(CANDLES, 'utf8')) as Array<{
    time: string; open: number; high: number; low: number; close: number; volume: number;
  }>;
  const candles: Candle[] = raw.map((c) => ({ ...c, time: new Date(c.time) }));
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const svc = new IndicatorsService();
  const rsiSeries = svc.calculateRSISeries(closes);
  const bandWidthSeries = svc.calculateBandWidthSeries(closes);
  const bb = svc.calculateBollingerBands(closes);
  const atr = svc.calculateATR(highs, lows, closes);
  const adx = svc.calculateADX(highs, lows, closes);
  const qqe = svc.calculateQQE(closes);
  const lastClose = closes[closes.length - 1];

  assertInvariants({ rsiSeries, bandWidthSeries, bb, atr, adx, qqe, lastClose });

  return {
    library: WRITE ? (process.env.FIXTURE_LABEL ?? 'unlabelled') : 'current',
    candles: candles.length,
    series: {
      rsiSeries: digest(rsiSeries),
      bandWidthSeries: digest(bandWidthSeries),
    },
    scalars: {
      rsi: round(svc.calculateRSI(closes)),
      bbUpper: round(bb.upper),
      bbMiddle: round(bb.middle),
      bbLower: round(bb.lower),
      bandWidth: round(svc.calculateBandWidth(bb)),
      atr: round(atr),
      adx: round(adx.adx),
      pdi: round(adx.pdi),
      mdi: round(adx.mdi),
      dx: round(adx.dx),
      qqeValue: round(qqe.value),
      qqeColor: qqe.color,
      qqeTrend: qqe.trend,
      // The regime classifier's actual input. Recorded because a warm-up
      // change silently shifts it.
      bandWidthPercentile: round(
        svc.percentileRank(
          svc.calculateBandWidth(bb),
          bandWidthSeries.slice(0, -1),
        ),
      ),
    },
  };
}

function compare(now: Baseline, base: Baseline) {
  console.log(`\nbaseline: ${base.library} · now: ${now.library} · ${base.candles} candles`);

  let significant = 0;

  console.log('\n── series ' + '─'.repeat(52));
  for (const key of Object.keys(base.series)) {
    const b = base.series[key];
    const n = now.series[key];
    if (!n) {
      console.log(`  ${key}: MISSING in current run`);
      significant++;
      continue;
    }
    const lenDelta = n.length - b.length;
    const same = n.checksum === b.checksum;
    // Only comparable positions can be diffed; align from the END, since
    // trailing values are the ones the pipeline reads.
    const cmp = Math.min(b.last3.length, n.last3.length);
    let maxAbs = 0;
    let maxRel = 0;
    for (let i = 0; i < cmp; i++) {
      const d = Math.abs(n.last3[i] - b.last3[i]);
      maxAbs = Math.max(maxAbs, d);
      if (b.last3[i] !== 0) maxRel = Math.max(maxRel, d / Math.abs(b.last3[i]));
    }
    console.log(
      `  ${key}\n` +
        `    length   ${b.length} → ${n.length}` +
        `${lenDelta === 0 ? '  (unchanged)' : `  ⚠ DELTA ${lenDelta > 0 ? '+' : ''}${lenDelta}`}\n` +
        `    checksum ${same ? 'identical' : `${b.checksum} → ${n.checksum}`}\n` +
        `    last3    maxAbs ${maxAbs.toExponential(2)} · maxRel ${maxRel.toExponential(2)}`,
    );
    if (lenDelta !== 0) significant++;
    if (maxRel > 1e-9) significant++;
  }

  console.log('\n── scalars ' + '─'.repeat(51));
  const rows: Array<Record<string, string>> = [];
  for (const key of Object.keys(base.scalars)) {
    const b = base.scalars[key];
    const n = now.scalars[key];
    if (typeof b === 'string' || typeof n === 'string') {
      rows.push({ scalar: key, baseline: String(b), now: String(n), diff: b === n ? '—' : '⚠ CHANGED' });
      if (b !== n) significant++;
      continue;
    }
    const abs = Math.abs(n - b);
    const rel = b !== 0 ? abs / Math.abs(b) : abs;
    rows.push({
      scalar: key,
      baseline: b.toFixed(6),
      now: n.toFixed(6),
      diff: rel === 0 ? '—' : `rel ${rel.toExponential(2)}`,
    });
    if (rel > 1e-9) significant++;
  }
  console.table(rows);

  console.log(
    significant === 0
      ? '\n✅ PASS — no differences beyond float noise, no length changes.'
      : `\n❌ ${significant} significant difference(s). Float noise is rel <= 1e-9; ` +
          'anything larger, or any length change, needs a decision.',
  );
  return significant === 0;
}

const now = compute();

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(now, null, 2));
  console.log(`invariants passed · wrote baseline (${now.library}) → ${BASELINE}`);
} else if (!existsSync(BASELINE)) {
  console.log('invariants passed · no baseline yet — run with --write');
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  console.log('invariants passed');
  const pass = compare(now, base);
  if (!pass) process.exit(1);
}
