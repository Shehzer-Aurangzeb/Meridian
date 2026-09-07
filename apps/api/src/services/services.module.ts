import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { AiModule } from '../ai/ai.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { ExpectedMoveModule } from '../expected-move/expected-move.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { FlowModule } from '../flow/flow.module';

/**
 * Convenience module re-exporting the feature modules.
 *
 * `SqueezeBreakoutModule` and `AnalysisCoordinatorModule` went with the trade
 * planner on 6 September 2026. `MapModule` is not re-exported here — it owns
 * the controllers and is imported directly by `AppModule`.
 */
@Module({
  imports: [
    MarketDataModule,
    IndicatorsModule,
    MarketRegimeModule,
    AiModule,
    AnalysisModule,
    ExpectedMoveModule,
    LiquidityModule,
    FlowModule,
  ],
  exports: [
    MarketDataModule,
    IndicatorsModule,
    MarketRegimeModule,
    AiModule,
    AnalysisModule,
    ExpectedMoveModule,
    LiquidityModule,
    FlowModule,
  ],
})
export class ServicesModule {}
