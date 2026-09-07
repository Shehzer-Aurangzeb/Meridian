import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService, RegimeState } from '../market-regime/market-regime.service';
import { ExpectedMoveService, ExpectedMove } from '../expected-move/expected-move.service';
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

/** One complete analysis. Same shape for the CLI, the database and the chart. */
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
  /** One per direction. A shared one put the wrong side's score on half the plans. */
  checklists: Partial<
    Record<'long' | 'short', NonNullable<CoordinatorAnalysisResult['checklistResult']>>
  > | null;
  squeeze: CoordinatorAnalysisResult['squeezeSetup'];
  map: LevelMap;
  plans: TradePlan[];
  /**
   * Layer 1 of End State A: what the market IS, with no claim about where it
   * goes. See docs/PRODUCT_LAYERS.md.
   *
   * Optional because it needs the ten-coin universe to form its cross-sectional
   * tilt, and a single ad-hoc analysis may not have it. Absent is a fact worth
   * carrying; a silently weaker number is not.
   */
  state?: MarketState;
  durationMs: number;
}

/** The Layer 1 outputs, together. Sizes and states — never a direction. */
export interface MarketState {
  /**
   * How big the next move is likely to be, at 4h/12h/24h, as p50/p80/p90 of
   * |move|. NOT calibrated — Layer 2 measures whether the 80% band contains the
   * outcome 80% of the time. Nothing may present these as probabilities yet.
   */
  expectedMove: ExpectedMove | null;
  /**
   * Regime and how long it has held, measured on 1h bars with hysteresis.
   *
   * This is NOT the `regime` field above, and the difference is deliberate:
   * that one is classified on 12h candles and still routes the legacy strategy
   * selection, which the deferred purge removes. This one is the Layer 1
   * output, on the timeframe its hysteresis was validated on (Bar 1c).
   */
  regime: RegimeState | null;
}

/**
 * Puts the analysis together: market type, levels, plans. Does not print,
 * save, or call the AI — that is the caller's job.
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
    private readonly expectedMoveService: ExpectedMoveService,
  ) {}

  /**
   * Price the whole universe's expected move once.
   *
   * The scheduled run analyses ten coins in sequence, and the cross-sectional
   * tilt needs all ten in the same hour. Calling this once and handing the
   * result to each `analyze` is the difference between ten candle fetches and
   * a hundred — and, more importantly, it is what makes every coin in a run
   * standardised against the same cross-section rather than against whatever
   * the universe looked like a few seconds earlier.
   */
  async priceUniverse(symbols: string[]): Promise<Map<string, ExpectedMove>> {
    return this.expectedMoveService.forUniverse(symbols);
  }

  async analyze(
    symbol: string,
    universe?: Map<string, ExpectedMove>,
  ): Promise<AnalysisRecord> {
    const startedAt = Date.now();
    const coin = symbol.toUpperCase();

    // Fetches its own longer history — one measure needs 200 past readings.
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

    // Independent of market type, so a plan is never quietly hidden.
    // TODO: whether plans SHOULD be filtered by market type is untested.
    const map = await this.levelMapService.build(coin);
    const plans = this.tradePlanService.buildPlans(map.zones, map.spot, map.atr);

    // Must be told which side it confirms, so once per direction.
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

    // ── Layer 1: what the market IS ──────────────────────────────────────
    // Never fails the analysis. A missing cone is a gap in the state report;
    // the levels, the regime and the map are all still worth saving without it.
    let state: MarketState | undefined;
    try {
      const expectedMove = universe?.get(coin) ?? (await this.priceUniverse([coin])).get(coin) ?? null;

      // The regime here is measured on 1h bars, which is the timeframe its
      // hysteresis was validated on (Bar 1c). `regime` above stays on 12h and
      // still routes the legacy strategy selection.
      const hourly = await this.binanceService.getCandles(coin, '1h', 600);
      const hourlyContext = this.indicatorsService.buildContext(coin, '1h', hourly);
      state = {
        expectedMove,
        regime: this.marketRegimeService.classifySeries(hourlyContext),
      };
    } catch (err) {
      this.logger.warn(`${coin}: market state unavailable — ${(err as Error).message}`);
    }

    const cone = state?.expectedMove?.cones[4];
    this.logger.debug(
      `${coin}: ${regime.regime} · ${map.zones.length} zone(s) · ${plans.length} plan(s)` +
        (state?.regime ? ` · state ${state.regime.regime} ${state.regime.ageHours}h` : '') +
        (cone ? ` · 4h p50 ${(cone.p50 * 1e4).toFixed(0)}bp p90 ${(cone.p90 * 1e4).toFixed(0)}bp` : ''),
    );

    return {
      state,
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
