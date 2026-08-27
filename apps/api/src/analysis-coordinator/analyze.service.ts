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
 * One complete analysis: what the command line prints, what gets saved, and
 * what the chart draws. One shape for all three, so a saved analysis can
 * always be reproduced.
 */
export interface AnalysisRecord {
  symbol: string;
  /** Which chart each part was measured on. Always stated, never assumed. */
  timeframes: {
    levels: Timeframe[];
    fib: Timeframe;
    atr: Timeframe;
    regime: Timeframe;
  };
  regime: CoordinatorAnalysisResult['regimeResult'];
  route: CoordinatorAnalysisResult['strategyRoute'];
  /**
   * One checklist per direction. A buy plan and a sell plan come out of the
   * same map, and a checklist only makes sense for one side at a time — a
   * single shared one put the wrong side's score next to half the plans.
   */
  checklists: Partial<
    Record<'long' | 'short', NonNullable<CoordinatorAnalysisResult['checklistResult']>>
  > | null;
  squeeze: CoordinatorAnalysisResult['squeezeSetup'];
  map: LevelMap;
  plans: TradePlan[];
  durationMs: number;
}

/**
 * Puts the whole analysis together: what kind of market this is, and where
 * the levels and plans are.
 *
 * It does not print, save, or call the AI — those are the caller's job.
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

    // What kind of market this is. Fetches its own, longer history: one of
    // its measures compares today against the last 200 readings.
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

    // Both of these depend only on the market type, so one call settles them.
    const routed = this.coordinatorService.routeFromRegime(
      context,
      ANALYSIS_TIMEFRAME,
      regime,
    );

    // The levels and plans. Deliberately independent of the market type, so
    // a plan is never quietly hidden because of it.
    //
    // TODO: whether plans SHOULD be filtered by market type is untested.
    const map = await this.levelMapService.build(coin);
    const plans = this.tradePlanService.buildPlans(map.zones, map.spot, map.atrByTier);

    // The checklist confirms a trade, so it has to be told which side it is
    // confirming. Run once for each direction a plan was built for.
    const checklists =
      routed.strategyRoute === 'CONFLUENCE_CHECKLIST'
        ? (Object.fromEntries(
            [...new Set(plans.map((p) => p.direction))].map((direction) => [
              direction,
              this.coordinatorService.routeFromRegime(
                context,
                ANALYSIS_TIMEFRAME,
                regime,
                direction,
              ).checklistResult,
            ]),
          ) as AnalysisRecord['checklists'])
        : null;

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
      checklists,
      squeeze: routed.squeezeSetup,
      map,
      plans,
      durationMs: Date.now() - startedAt,
    };
  }
}
