/**
 * Terminal analyst.
 *
 *   pnpm analyze BTC
 *   pnpm analyze ETH --balance 10000
 *   pnpm analyze SOL --ai              # adds the Claude leg (costs money)
 *
 * SYMBOL IS THE ONLY ARGUMENT. Every timeframe is a declared decision, not a
 * caller's guess — measured reason: passing an arbitrary ATR timeframe moved
 * blended R by 10x (0.09R on 1d vs 3.61R on 1h for identical zones), so a
 * timeframe nobody chose deliberately is a correctness problem rather than a
 * convenience. All four are printed below:
 *
 *   levels    12h / 4h / 1h     LEVEL_TIMEFRAMES
 *   fib       12h               FIB_ANCHOR_TIMEFRAME
 *   atr       4h                ATR_TIMEFRAME
 *   regime    12h               ANALYSIS_TIMEFRAME
 *
 * Runs in-process: no Nest bootstrap, no Postgres, no HTTP server.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { AnalysisCoordinatorService } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import {
  AnalystNarrationService,
  PriceProvenanceError,
} from '../../src/ai/analyst-narration.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { ANALYSIS_TIMEFRAME } from '../../src/common/constants/timeframes';
import { ANALYSIS_CANDLE_LIMIT } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { logRun } from '../../src/common/run-log';
import {
  ATR_TIMEFRAME,
  FIB_ANCHOR_TIMEFRAME,
  LevelMapService,
  LEVEL_TIMEFRAMES,
} from '../../src/analysis/services/level-map.service';
import {
  TradePlanService,
  ZONE_BANDS,
} from '../../src/analysis/services/trade-plan.service';

// ponytail: BinanceService only calls get/set/del — a Map covers it.
// Swap for the real CacheModule if this ever needs TTL semantics.
const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const [, , coinArg, ...flags] = process.argv;
const coin = (coinArg ?? 'BTC').toUpperCase();
const withAI = flags.includes('--ai');

// Reject a leftover timeframe argument loudly. Silently ignoring it would let
// `analyze BTC 1h` look like it honoured the 1h while actually reporting 12h.
const stray = flags.find((f) => !f.startsWith('--') && !/^\d+(\.\d+)?$/.test(f));
if (stray) {
  console.error(
    `Unexpected argument '${stray}'. analyze takes a symbol only — the ` +
      `playbook decides the timeframes. See the header for which.`,
  );
  process.exit(1);
}
// Sizing needs an account size, and inventing a default would put a made-up
// number in the output. Omitted unless supplied.
const balance = (() => {
  const i = flags.indexOf('--balance');
  return i >= 0 && flags[i + 1] ? Number(flags[i + 1]) : 0;
})();

const pct = (n: number) => `${n.toFixed(2)}%`;

async function main() {
  const indicators = new IndicatorsService();
  const sr = new SupportResistanceService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const levelMap = new LevelMapService(binance, sr, indicators);
  const planner = new TradePlanService();
  const regimeSvc = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    regimeSvc,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
    new SupportResistanceService(),
  );

  const startedAt = Date.now();
  const candles = await binance.getCandles(coin, ANALYSIS_TIMEFRAME, ANALYSIS_CANDLE_LIMIT);
  const ctx = indicators.buildContext(coin, ANALYSIS_TIMEFRAME, candles);
  const regime = regimeSvc.classifyFromContext(ctx);
  const result = coordinator.routeFromRegime(ctx, ANALYSIS_TIMEFRAME, regime);

  const lastClose = ctx.closes[ctx.closes.length - 1];

  console.log(`\n${coin}/USDT`);
  console.log(
    `timeframes  levels ${LEVEL_TIMEFRAMES.join('/')} · fib ${FIB_ANCHOR_TIMEFRAME} · ` +
      `atr ${ATR_TIMEFRAME} · regime ${ANALYSIS_TIMEFRAME}`,
  );
  console.log(
    `regime      ${regime.regime}  (ADX ${regime.metrics.adx.toFixed(1)}, ` +
      `BB width ${pct(regime.metrics.bandWidth)}` +
      `${
        regime.metrics.bandWidthPercentile !== null
          ? ` @ ${regime.metrics.bandWidthPercentile.toFixed(0)}th pct`
          : ' — no percentile history'
      })`,
  );
  console.log(`route       ${result.strategyRoute}`);

  // ── Level map: multi-timeframe, playbook order ────────────────────────
  const map = await levelMap.build(coin);

  console.log(
    `spot        $${map.spot.toLocaleString()}  (${LEVEL_TIMEFRAMES[LEVEL_TIMEFRAMES.length - 1]} close)`,
  );
  if (map.anchor) {
    console.log(
      `fib anchor  ${map.anchor.timeframe} swing range ` +
        `$${map.anchor.low.toLocaleString()} – $${map.anchor.high.toLocaleString()}`,
    );
  }
  console.log(
    `marks       ${map.marks.length} from ` +
      map.perTimeframe.map((t) => `${t.timeframe}:${t.levels}`).join(' ') +
      ` + ${map.fib.length} Fib`,
  );

  if (map.zones.length === 0) {
    console.log('confluence  none — no two independent sources agree within 0.5%');
  } else {
    console.log(`confluence  ${map.zones.length} zone(s)`);
  }

  // ── Plans: both directions, always ────────────────────────────────────
  const plans = planner.buildPlans(map.zones, map.spot, map.atr);

  if (plans.length === 0) {
    console.log('\nno zone on either side of spot — nothing to plan against');
  }

  for (const plan of plans) {
    const away = `${plan.distanceToZonePercent >= 0 ? '+' : ''}${plan.distanceToZonePercent.toFixed(2)}%`;
    console.log(
      `\n── ${plan.direction.toUpperCase()}  ${plan.state}  (${away} to zone)  ` +
        `${plan.zone.sources.length} sources  ${plan.blendedR.toFixed(2)}R blended ` +
        '─'.repeat(8),
    );
    console.log(
      `zone      $${plan.zone.low.toFixed(2)} – $${plan.zone.high.toFixed(2)}` +
        `   ${plan.zone.sources.join(' + ')}`,
    );
    console.log(
      `entries   ` +
        plan.entries
          .map((e) => `${e.weightPercent}% @ ${e.price.toFixed(2)}`)
          .join('  ·  '),
    );
    console.log(
      `stop      $${plan.stop.toFixed(2)}   ` +
        `(zone ${plan.direction === 'long' ? 'low' : 'high'} ${plan.direction === 'long' ? '-' : '+'} 1xATR(${map.atrTimeframe}) ${map.atr.toFixed(2)})   ` +
        `risk ${plan.riskPercent.toFixed(2)}% of entry`,
    );
    if (plan.targets.length === 0) {
      console.log('targets   none — no further zone in that direction');
    } else {
      console.table(
        plan.targets.map((t, i) => ({
          tp: `TP${i + 1}`,
          price: t.price.toFixed(2),
          take: `${t.weightPercent}%`,
          R: t.rMultiple.toFixed(2),
          at: t.source,
        })),
      );
    }
    console.log(`come back  ${plan.comeBackWhen}`);
    if (balance > 0) {
      console.log(
        `sizing     at 1% of $${balance.toLocaleString()} = ` +
          `${((balance * 0.01) / plan.riskPerUnit).toFixed(4)} units ` +
          `(1R = $${plan.riskPerUnit.toFixed(2)} of price)`,
      );
    }
  }

  if (result.checklistResult) {
    const c = result.checklistResult;
    console.log(
      `\nchecklist   ${c.conditionsMet}/5 conditions met (needs 3) · ${c.tradeType}`,
    );
    console.table(
      c.conditions.map((cond) => ({
        condition: cond.name,
        met: cond.passed ? '✓' : '✗',
        value: String(cond.value ?? ''),
      })),
    );
  }

  if (result.squeezeSetup) {
    const s = result.squeezeSetup;
    console.log('\nsqueeze setup');
    console.table({
      upperTrigger: s.upperTriggerPrice,
      lowerTrigger: s.lowerTriggerPrice,
      volumeBaseline: s.volumeBaseline,
    });
  }

  console.log(`\nshouldInvokeAI ${result.shouldInvokeAI}`);
  console.log(`elapsed        ${Date.now() - startedAt}ms`);

  logRun({
    symbol: coin,
    timeframes: {
      levels: LEVEL_TIMEFRAMES,
      fib: FIB_ANCHOR_TIMEFRAME,
      atr: ATR_TIMEFRAME,
      regime: ANALYSIS_TIMEFRAME,
    },
    regime: regime.regime,
    adx: regime.metrics.adx,
    bandWidth: regime.metrics.bandWidth,
    bandWidthPercentile: regime.metrics.bandWidthPercentile,
    route: result.strategyRoute,
    direction: result.checklistResult?.tradeType ?? null,
    conditionsMet: result.checklistResult?.conditionsMet ?? null,
    conditions:
      result.checklistResult?.conditions.map((c) => ({
        name: c.name,
        passed: c.passed,
        value: c.value ?? null,
      })) ?? null,
    squeezeSetup: result.squeezeSetup
      ? {
          upper: result.squeezeSetup.upperTriggerPrice,
          lower: result.squeezeSetup.lowerTriggerPrice,
        }
      : null,
    spot: map.spot,
    fibAnchor: map.anchor,
    markCount: map.marks.length,
    perTimeframe: map.perTimeframe,
    zones: map.zones.map((z) => ({
      low: z.low, high: z.high, type: z.type,
      distancePercent: z.distancePercent, sources: z.sources,
    })),
    plans: plans.map((p) => ({
      direction: p.direction,
      state: p.state,
      distanceToZonePercent: p.distanceToZonePercent,
      zone: { low: p.zone.low, high: p.zone.high, sources: p.zone.sources },
      entries: p.entries,
      averageEntry: p.averageEntry,
      stop: p.stop,
      riskPercent: p.riskPercent,
      targets: p.targets,
      blendedR: p.blendedR,
      comeBackWhen: p.comeBackWhen,
    })),
    atr: map.atr,
    atrTimeframe: map.atrTimeframe,
    zoneBands: ZONE_BANDS,
    shouldInvokeAI: result.shouldInvokeAI,
    durationMs: Date.now() - startedAt,
  });

  if (!withAI) {
    console.log(
      result.shouldInvokeAI
        ? '\n(pass --ai to run the Claude leg)'
        : '\n(AI skipped: pipeline says this is not a setup)',
    );
    return;
  }

  console.log('\ncalling Claude…');
  const narrator = new AnalystNarrationService();
  const narrationInput = {
    map,
    plans,
    regime,
    checklist: result.checklistResult,
    regimeTimeframe: ANALYSIS_TIMEFRAME,
  };

  try {
    const narration = await narrator.narrate(narrationInput);
    console.log(`\n${'═'.repeat(60)}\n`);
    console.log(narration.text);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(
      `${narration.inputTokens} in / ${narration.outputTokens} out · ` +
        `${narration.citedPrices.length} prices cited, all traced`,
    );
    logRun({ symbol: coin, narration: narration.text, citedPrices: narration.citedPrices });
  } catch (err) {
    if (err instanceof PriceProvenanceError) {
      // Discarded on purpose. A narration that invents a level is worse than
      // no narration — the numbers above are still correct and complete.
      console.error(`\nNARRATION REJECTED: ${err.message}`);
      logRun({ symbol: coin, narrationRejected: err.invented });
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
