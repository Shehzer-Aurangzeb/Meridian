/**
 * Terminal analysis harness.
 *
 *   pnpm analyze BTC 1h
 *   pnpm analyze ETH 4h --ai      # also calls Claude (costs money)
 *
 * Runs the real coordinator pipeline in-process. No Nest bootstrap, no
 * Postgres, no HTTP server — `routeFromRegime` is pure and the only I/O is
 * the Binance fetch, so the whole thing is five constructors and a call.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { AnalysisCoordinatorService } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import { ClaudePromptService } from '../../src/ai/ai-prompt.service';
import { ClaudeService } from '../../src/ai/ai.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { TimeInterval } from '../../src/common/types/candle.types';
import { ANALYSIS_CANDLE_LIMIT } from '../../src/analysis-coordinator/analysis-coordinator.service';
import { logRun } from '../../src/common/run-log';
import { MarkedLevel } from '../../src/analysis/interfaces/support-resistance.types';
import { Timeframe } from '../../src/common/constants/timeframes';

// ponytail: BinanceService only calls get/set/del — a Map covers it.
// Swap for the real CacheModule if this ever needs TTL semantics.
const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const [, , coinArg, tfArg, ...flags] = process.argv;
const coin = (coinArg ?? 'BTC').toUpperCase();
const timeframe = (tfArg ?? '1h') as TimeInterval;
const withAI = flags.includes('--ai');

const pct = (n: number) => `${n.toFixed(2)}%`;

async function main() {
  const indicators = new IndicatorsService();
  const sr = new SupportResistanceService();
  const binance = new BinanceService(cache, new CacheTelemetryService());
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
  const candles = await binance.getCandles(coin, timeframe, ANALYSIS_CANDLE_LIMIT);
  const ctx = indicators.buildContext(coin, timeframe, candles);
  const regime = regimeSvc.classifyFromContext(ctx);
  const result = coordinator.routeFromRegime(ctx, timeframe, regime);

  const lastClose = ctx.closes[ctx.closes.length - 1];

  console.log(`\n${coin}/USDT · ${timeframe} · ${candles.length} candles`);
  console.log(`last close  $${lastClose.toLocaleString()}`);
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

  // ── Level engine ──────────────────────────────────────────────────────
  // ponytail: Fib is anchored to THIS timeframe. The playbook anchors it to
  // 12h (p51, "Weekly acceptable too"); multi-timeframe gathering is the
  // next phase, and the anchor is surfaced below so it is never implicit.
  const srLevels = sr.levelsFromCandles(
    [...ctx.candles],
    timeframe as Timeframe,
    lastClose,
  );
  const anchors = sr.fibAnchors([...ctx.candles]);
  const fib = anchors ? sr.fibLevels(anchors.low, anchors.high) : [];

  const marks: MarkedLevel[] = [
    ...srLevels.map((l) => ({
      price: l.price,
      type: l.type,
      source: `${timeframe} ${l.type} x${l.touchCount}`,
      touchCount: l.touchCount,
    })),
    ...fib.map((f) => ({
      price: f.price,
      type: f.type,
      source: `${f.ratio} Fib (${timeframe})`,
    })),
  ];
  const zones = sr.findConfluenceZones(marks, lastClose);

  if (anchors) {
    console.log(
      `fib anchor  ${timeframe} swing range ` +
        `$${anchors.low.toLocaleString()} – $${anchors.high.toLocaleString()}`,
    );
  }

  console.log(`\nlevels      ${srLevels.length} S/R + ${fib.length} Fib = ${marks.length} marks`);
  if (zones.length === 0) {
    console.log('confluence  none — no two independent marks agree within 0.5%');
  } else {
    console.log(`confluence  ${zones.length} zone(s)`);
    console.table(
      zones.slice(0, 5).map((z) => ({
        zone: `$${z.low.toFixed(2)} – $${z.high.toFixed(2)}`,
        type: z.type,
        away: `${z.distancePercent >= 0 ? '+' : ''}${z.distancePercent.toFixed(2)}%`,
        span: `${z.spanPercent.toFixed(2)}%`,
        sources: z.sources.join(' + '),
      })),
    );
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
    timeframe,
    lastClose,
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
    fibAnchor: anchors,
    zones: zones.map((z) => ({
      low: z.low, high: z.high, type: z.type,
      distancePercent: z.distancePercent, sources: z.sources,
    })),
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
  const claude = new ClaudeService(new ClaudePromptService());
  const ai = await claude.analyzeWithChecklist(result);
  logRun({ symbol: coin, timeframe, ai });
  console.log(JSON.stringify(ai, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
