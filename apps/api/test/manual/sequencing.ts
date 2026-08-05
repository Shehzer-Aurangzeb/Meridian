/**
 * Sequencing test: is the checklist a SEQUENCE, not a simultaneous AND?
 *
 *   npx ts-node test/manual/sequencing.ts 1d --coins BTC,ETH,... --limit 1200
 *
 * ─── The hypothesis ──────────────────────────────────────────────────────
 * The five conditions can never co-occur: measured over 9,500 bars, 4-of-5
 * happened ZERO times. Three conditions describe a dip (oversold, at the
 * lower band, at support) and two require an established uptrend (QQE green,
 * structure HH/HL). A dip is not an uptrend, so the conjunction is empty.
 *
 * A discretionary trader does not check five boxes at one instant. Price
 * falls into a level, it looks stretched, momentum turns, THEN he buys. That
 * is a sequence. The playbook is a reconstruction from auto-translated
 * transcripts, so a sequence flattened into a checklist is a very plausible
 * artefact of how it was produced.
 *
 * ─── What this measures ──────────────────────────────────────────────────
 *   SETUP   = the dip state: oversold AND near the lower band
 *   TRIGGER = momentum turning: QQE flips to green having not been green
 *
 * Then:
 *   1. how often the SETUP state exists at all
 *   2. how long it takes for a TRIGGER to follow (a distribution, so no
 *      arbitrary wait window is fitted)
 *   3. AT THE TRIGGER BAR, how many dip conditions still hold — the decisive
 *      number. If they have already decayed by the time momentum turns, then
 *      no simultaneous rule can ever fire and sequencing is the only
 *      encoding that can work.
 *   4. what market structure says at the trigger, to test whether requiring
 *      HH/HL (rather than "reversing to bullish") still blocks everything
 *   5. resulting signal frequency, in trades per coin per year
 *
 * Long side only: the dip reading is the long case, and it is the one the
 * playbook's checklist describes. Shorts mirror it and are not tested here.
 *
 * Changes no thresholds. Reports only.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { ANALYSIS_CANDLE_LIMIT } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import {
  BB_THRESHOLDS,
  RSI_ENTRY_THRESHOLDS,
} from '../../src/analysis/interfaces/checklist.types';
import { TimeInterval } from '../../src/common/types/candle.types';

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const [, , tfArg, ...rest] = process.argv;
const timeframe = (tfArg ?? '1d') as TimeInterval;
const ci = rest.indexOf('--coins');
const COINS =
  ci >= 0 && rest[ci + 1] ? rest[ci + 1].split(',').map((c) => c.trim().toUpperCase()) : ['BTC'];
const li = rest.indexOf('--limit');
const LIMIT = li >= 0 && rest[li + 1] ? Number(rest[li + 1]) : 1200;

/** Longest a dip is allowed to wait for its trigger before we call it stale. */
const MAX_WAIT = 20;

interface BarState {
  oversold: boolean;
  atLowerBand: boolean;
  qqeGreen: boolean;
  qqeTurnedGreen: boolean;
  structure: string;
}

let bars = 0;
let setupBars = 0;
let simultaneous = 0; // dip AND turn on the SAME bar — the current encoding
let sequencedSignals = 0;
let expired = 0;
const waitBars: number[] = [];
// At the trigger bar: how much of the dip is still true?
let stillOversold = 0;
let stillAtLower = 0;
let stillBoth = 0;
const structureAtTrigger = new Map<string, number>();
let coinYears = 0;

function classify(ctx: {
  rsi: number;
  bollingerBands: { upper: number; lower: number };
  closes: readonly number[];
  qqe: { color: string; previousColor: string };
  highs: readonly number[];
  lows: readonly number[];
}): BarState {
  const price = ctx.closes[ctx.closes.length - 1];
  const range = ctx.bollingerBands.upper - ctx.bollingerBands.lower;
  const proximity = range > 0 ? ((price - ctx.bollingerBands.lower) / range) * 100 : 100;

  // Same structure rule the checklist uses: compare the last bar to a pivot
  // roughly 20 bars back.
  const n = ctx.closes.length;
  const mid = (ctx.bollingerBands.upper + ctx.bollingerBands.lower) / 2;
  const pivot = Math.max(0, n - 21);
  let structure = 'ranging';
  if (price > mid && ctx.highs[n - 1] > ctx.highs[pivot]) structure = 'HH/HL';
  else if (price < mid && ctx.lows[n - 1] < ctx.lows[pivot]) structure = 'LH/LL';

  return {
    oversold: ctx.rsi <= RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX,
    atLowerBand: proximity <= BB_THRESHOLDS.PROXIMITY_PERCENT,
    qqeGreen: ctx.qqe.color === 'green',
    qqeTurnedGreen: ctx.qqe.color === 'green' && ctx.qqe.previousColor !== 'green',
    structure,
  };
}

async function run(coin: string) {
  const indicators = new IndicatorsService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) return;

  const states: BarState[] = [];
  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    states.push(classify(indicators.buildContext(coin, timeframe, window)));
  }
  bars += states.length;
  coinYears += states.length / 365;

  // ── state machine: IDLE -> ARMED (dip present) -> TRIGGERED | EXPIRED ──
  let armedAt = -1;
  for (let k = 0; k < states.length; k++) {
    const s = states[k];
    const isDip = s.oversold && s.atLowerBand;

    if (isDip) {
      setupBars++;
      if (s.qqeTurnedGreen) simultaneous++;
      // (Re)arm on any dip bar — the dip is ongoing, the clock restarts.
      armedAt = k;
      continue;
    }

    if (armedAt < 0) continue;

    if (k - armedAt > MAX_WAIT) {
      expired++;
      armedAt = -1;
      continue;
    }

    if (s.qqeTurnedGreen) {
      sequencedSignals++;
      waitBars.push(k - armedAt);
      if (s.oversold) stillOversold++;
      if (s.atLowerBand) stillAtLower++;
      if (s.oversold && s.atLowerBand) stillBoth++;
      structureAtTrigger.set(s.structure, (structureAtTrigger.get(s.structure) ?? 0) + 1);
      armedAt = -1;
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

async function main() {
  for (const c of COINS) await run(c);

  console.log(`\n${COINS.length} coin(s) · ${timeframe} · ${bars} bars · ~${coinYears.toFixed(1)} coin-years\n`);

  console.log('── simultaneous vs sequenced ' + '─'.repeat(33));
  console.table([
    {
      encoding: 'dip AND turn on the SAME bar',
      signals: simultaneous,
      'per coin-year': (simultaneous / coinYears).toFixed(2),
      note: 'what the checklist currently requires',
    },
    {
      encoding: `dip THEN turn within ${MAX_WAIT} bars`,
      signals: sequencedSignals,
      'per coin-year': (sequencedSignals / coinYears).toFixed(2),
      note: 'the sequencing reading',
    },
  ]);
  console.log(
    `  dip state present on ${setupBars} bars (${pct(setupBars, bars)}) · ` +
      `${expired} dips went stale with no turn`,
  );

  if (waitBars.length > 0) {
    const s = [...waitBars].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    console.log('\n── how long the turn takes to arrive ' + '─'.repeat(25));
    console.table([
      { metric: 'bars from dip to turn', min: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: q(0.999) },
    ]);
    for (const w of [1, 2, 3, 5, 10, 20]) {
      const n = waitBars.filter((b) => b <= w).length;
      console.log(`  within ${String(w).padStart(2)} bars: ${n} (${pct(n, waitBars.length)} of triggers)`);
    }
  }

  console.log('\n── THE DECISIVE ONE: at the trigger bar, is the dip still true? ' + '─'.repeat(0));
  console.table([
    { 'still true at trigger': 'RSI still oversold', bars: stillOversold, pct: pct(stillOversold, sequencedSignals) },
    { 'still true at trigger': 'still near lower band', bars: stillAtLower, pct: pct(stillAtLower, sequencedSignals) },
    { 'still true at trigger': 'BOTH still true', bars: stillBoth, pct: pct(stillBoth, sequencedSignals) },
  ]);
  console.log(
    '  If "BOTH still true" is low, the dip has already decayed by the time\n' +
      '  momentum turns — so no simultaneous rule can fire, and sequencing is\n' +
      '  the only encoding that can work.',
  );

  console.log('\n── market structure AT the trigger ' + '─'.repeat(27));
  console.table(
    [...structureAtTrigger.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ structure: k, bars: v, pct: pct(v, sequencedSignals) })),
  );
  console.log(
    '  The checklist demands HH/HL. The playbook says "bullish OR REVERSING\n' +
      '  to bullish". Whatever share is not HH/HL is what that dropped\n' +
      '  qualifier costs.',
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
