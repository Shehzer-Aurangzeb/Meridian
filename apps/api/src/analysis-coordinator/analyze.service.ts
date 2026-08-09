import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { LevelMapService, LevelMap } from '../analysis/services/level-map.service';
import { TradePlanService, TradePlan } from '../analysis/services/trade-plan.service';
import {
  ANALYSIS_TIMEFRAME,
  Timeframe,
} from '../common/constants/timeframes';
import {
  ATR_TIMEFRAME,
  FIB_ANCHOR_TIMEFRAME,
  LEVEL_TIMEFRAMES,
} from '../analysis/services/level-map.service';
import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from './analysis-coordinator.service';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';

/**
 * One analysis, complete: everything the CLI prints, everything a saved row
 * holds, everything a chart needs to draw. One shape for all three, because
 * a saved analysis that cannot be reproduced locally is not a record.
 *
 * JSON-serialisable by construction — it goes straight into the
 * `CoordinatorRun.coordinatorPayload` Json column.
 */
export interface AnalysisRecord {
  symbol: string;
  /** Every timeframe is a declared decision; all four are surfaced. */
  timeframes: {
    levels: Timeframe[];
    fib: Timeframe;
    atr: Timeframe;
    regime: Timeframe;
  };
  regime: CoordinatorAnalysisResult['regimeResult'];
  route: CoordinatorAnalysisResult['strategyRoute'];
  checklist: CoordinatorAnalysisResult['checklistResult'];
  squeeze: CoordinatorAnalysisResult['squeezeSetup'];
  map: LevelMap;
  plans: TradePlan[];
  durationMs: number;
}

/**
 * AnalyzeService
 *
 * The whole analysis, assembled in one place.
 *
 * This composition used to live ONLY inside `test/manual/analyze.ts`, which
 * meant nothing in `src/` could produce a full analysis: not a route, not a
 * scheduled job, not a Lambda. The coordinator handles the regime leg and
 * `LevelMapService` the level leg, but nobody joined them.
 *
 * Lives in the coordinator module rather than the analysis module because it
 * needs both, and `AnalysisCoordinatorModule` already imports `AnalysisModule`
 * — the other direction would be a cycle.
 *
 * Note what this does NOT do: print, persist, or call Claude. Those are
 * caller policy. The CLI prints and writes JSONL (it must run without
 * Docker); the route persists to Postgres; `--ai` is a flag, not a pipeline
 * stage.
 */
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly marketRegimeService: MarketRegimeService,
    private readonly coordinatorService: AnalysisCoordinatorService,
    private readonly levelMapService: LevelMapService,
    private readonly tradePlanService: TradePlanService,
  ) {}

  async analyze(symbol: string): Promise<AnalysisRecord> {
    const startedAt = Date.now();
    const coin = symbol.toUpperCase();

    // ── Regime leg ──────────────────────────────────────────────────────
    // Its own 12h fetch at 250 candles: the bandwidth percentile needs a
    // 200-sample history and the level map only fetches 120. Sharing them
    // would silently degrade the percentile.
    const candles = await this.binanceService.getCandles(
      coin,
      ANALYSIS_TIMEFRAME,
      ANALYSIS_CANDLE_LIMIT,
    );
    const context = this.indicatorsService.buildContext(
      coin,
      ANALYSIS_TIMEFRAME,
      candles,
    );
    const regime = this.marketRegimeService.classifyFromContext(context);
    const routed = this.coordinatorService.routeFromRegime(
      context,
      ANALYSIS_TIMEFRAME,
      regime,
    );

    // ── Level leg ───────────────────────────────────────────────────────
    // Independent of the regime leg by design: nothing here reads the
    // regime, so a plan is never silently filtered by it. Whether it SHOULD
    // be is the one untested idea left (STATE_OF_PLAY.md §14h).
    const map = await this.levelMapService.build(coin);
    const plans = this.tradePlanService.buildPlans(map.zones, map.spot, map.atr);

    this.logger.debug(
      `${coin}: ${regime.regime} · ${map.zones.length} zone(s) · ${plans.length} plan(s)`,
    );

    return {
      symbol: coin,
      timeframes: {
        levels: LEVEL_TIMEFRAMES,
        fib: FIB_ANCHOR_TIMEFRAME,
        atr: ATR_TIMEFRAME,
        regime: ANALYSIS_TIMEFRAME,
      },
      regime,
      route: routed.strategyRoute,
      checklist: routed.checklistResult,
      squeeze: routed.squeezeSetup,
      map,
      plans,
      durationMs: Date.now() - startedAt,
    };
  }
}
