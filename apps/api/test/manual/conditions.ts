/**
 * Condition calibration diagnostic.
 *
 *   npx ts-node test/manual/conditions.ts 1d --coins BTC,ETH,SOL
 *
 * ─── The question ────────────────────────────────────────────────────────
 * Applying the playbook's own 3-of-5 minimum makes the checklist almost
 * silent: on BTC 1d, 0.4% of checklist-routed bars reach 3-of-5 while 42.5%
 * sit at exactly 2-of-5. Either the playbook is genuinely that strict, or one
 * or two conditions are effectively unreachable and are doing all the
 * blocking.
 *
 * Those two possibilities call for completely different responses, so this
 * measures which it is. No thresholds are changed here — this reports only.
 *
 * Reports:
 *   1. distribution of conditionsMet (0..5)
 *   2. per-condition pass rate over all checklist-routed bars
 *   3. for the 2-of-5 bucket specifically, WHICH conditions failed
 *   4. the same under the opposite direction, and best-of-both
 *
 * (4) exists because direction is derived from trend when the caller
 * supplies none, and a wrong-side direction makes some conditions
 * unreachable by construction — that is what produced 0/839 RSI and
 * Bollinger passes in the zone test. If best-of-both is much higher than
 * the derived direction alone, direction derivation is suppressing setups
 * rather than the conditions being strict.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { TimeInterval } from '../../src/common/types/candle.types';

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const [, , tfArg, ...rest] = process.argv;
const timeframe = (tfArg ?? '1d') as TimeInterval;
const idx = rest.indexOf('--coins');
const COINS =
  idx >= 0 && rest[idx + 1]
    ? rest[idx + 1].split(',').map((c) => c.trim().toUpperCase())
    : ['BTC'];
const limitIdx = rest.indexOf('--limit');
const LIMIT = limitIdx >= 0 && rest[limitIdx + 1] ? Number(rest[limitIdx + 1]) : 1200;

interface Tally {
  bars: number;
  metCounts: number[]; // index = conditionsMet
  passByName: Map<string, number>;
  seenByName: Map<string, number>;
  // Failures among bars sitting at exactly 2-of-5.
  failInTwoBucket: Map<string, number>;
  twoBucketBars: number;
  // Same bar under the opposite direction, and best of the two.
  metCountsOpposite: number[];
  metCountsBest: number[];
  derivedLong: number;
  derivedShort: number;
}

const blank = (): Tally => ({
  bars: 0,
  metCounts: Array(6).fill(0),
  passByName: new Map(),
  seenByName: new Map(),
  failInTwoBucket: new Map(),
  twoBucketBars: 0,
  metCountsOpposite: Array(6).fill(0),
  metCountsBest: Array(6).fill(0),
  derivedLong: 0,
  derivedShort: 0,
});

async function run(coin: string, t: Tally) {
  const indicators = new IndicatorsService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const regimeSvc = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    regimeSvc,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
    new SupportResistanceService(binance),
  );

  const candles = await binance.getCandlesPaged(coin, timeframe, LIMIT);
  if (candles.length <= ANALYSIS_CANDLE_LIMIT) return;

  for (let i = ANALYSIS_CANDLE_LIMIT - 1; i < candles.length - 1; i++) {
    const window = candles.slice(i - ANALYSIS_CANDLE_LIMIT + 1, i + 1);
    const ctx = indicators.buildContext(coin, timeframe, window);
    const regime = regimeSvc.classifyFromContext(ctx);

    // Derived direction (no direction supplied) — the production default.
    const derived = coordinator.routeFromRegime(ctx, timeframe, regime);
    if (!derived.checklistResult) continue; // squeeze route, no conditions

    t.bars++;
    const dir = derived.checklistResult.tradeType;
    if (dir === 'long') t.derivedLong++;
    else t.derivedShort++;

    const met = derived.checklistResult.conditionsMet;
    t.metCounts[met]++;

    for (const c of derived.checklistResult.conditions) {
      t.seenByName.set(c.name, (t.seenByName.get(c.name) ?? 0) + 1);
      if (c.passed) t.passByName.set(c.name, (t.passByName.get(c.name) ?? 0) + 1);
    }

    if (met === 2) {
      t.twoBucketBars++;
      for (const c of derived.checklistResult.conditions) {
        if (!c.passed) {
          t.failInTwoBucket.set(c.name, (t.failInTwoBucket.get(c.name) ?? 0) + 1);
        }
      }
    }

    // Opposite direction on the identical bar.
    const opposite = coordinator.routeFromRegime(
      ctx,
      timeframe,
      regime,
      dir === 'long' ? 'short' : 'long',
    );
    const metOpp = opposite.checklistResult?.conditionsMet ?? 0;
    t.metCountsOpposite[metOpp]++;
    t.metCountsBest[Math.max(met, metOpp)]++;
  }
}

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const t = blank();
  for (const c of COINS) await run(c, t);

  console.log(
    `\n${COINS.length === 1 ? COINS[0] : `${COINS.length} coins`} · ${timeframe} · ` +
      `${t.bars} checklist-routed bars · direction derived from trend ` +
      `(${pct(t.derivedLong, t.bars)} long)`,
  );

  console.log('\n── conditions met (derived direction) ' + '─'.repeat(24));
  console.table(
    t.metCounts.map((n, i) => ({
      conditionsMet: `${i}/5`,
      bars: n,
      pct: pct(n, t.bars),
      gate: i >= 3 ? 'PASSES 3-of-5' : '',
    })),
  );

  console.log('── per-condition pass rate (all bars) ' + '─'.repeat(24));
  console.table(
    [...t.seenByName.keys()].map((name) => ({
      condition: name,
      passed: t.passByName.get(name) ?? 0,
      seen: t.seenByName.get(name) ?? 0,
      rate: pct(t.passByName.get(name) ?? 0, t.seenByName.get(name) ?? 0),
    })),
  );

  console.log(
    `── which conditions block the 2-of-5 bucket (${t.twoBucketBars} bars) ` + '─'.repeat(8),
  );
  console.table(
    [...t.seenByName.keys()]
      .map((name) => ({
        condition: name,
        failed: t.failInTwoBucket.get(name) ?? 0,
        'of 2-of-5 bars': pct(t.failInTwoBucket.get(name) ?? 0, t.twoBucketBars),
      }))
      .sort((a, b) => b.failed - a.failed),
  );

  console.log('── would the opposite direction help? ' + '─'.repeat(24));
  const ge3 = (arr: number[]) => arr[3] + arr[4] + arr[5];
  console.table([
    { basis: 'derived direction', 'bars >= 3of5': ge3(t.metCounts), pct: pct(ge3(t.metCounts), t.bars) },
    { basis: 'opposite direction', 'bars >= 3of5': ge3(t.metCountsOpposite), pct: pct(ge3(t.metCountsOpposite), t.bars) },
    { basis: 'best of both', 'bars >= 3of5': ge3(t.metCountsBest), pct: pct(ge3(t.metCountsBest), t.bars) },
  ]);
  console.log(
    '  If "best of both" is far above "derived", direction derivation is\n' +
      '  suppressing setups. If both are near zero, the conditions are the wall.',
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
