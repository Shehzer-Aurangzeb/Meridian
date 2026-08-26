import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { SqueezeBreakoutModule } from '../squeeze-breakout/squeeze-breakout.module';
import { AnalysisCoordinatorModule } from '../analysis-coordinator/analysis-coordinator.module';
import { AiModule } from '../ai/ai.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { FlowModule } from '../flow/flow.module';

/**
 * ServicesModule - Convenience module that re-exports all feature modules
 * Can be used to import all services at once
 */
@Module({
  imports: [
    MarketDataModule,
    IndicatorsModule,
    MarketRegimeModule,
    SqueezeBreakoutModule,
    AnalysisCoordinatorModule,
    AiModule,
    AnalysisModule,
    RiskManagementModule,
    FlowModule,
  ],
  exports: [
    MarketDataModule,
    IndicatorsModule,
    MarketRegimeModule,
    SqueezeBreakoutModule,
    AnalysisCoordinatorModule,
    AiModule,
    AnalysisModule,
    RiskManagementModule,
    FlowModule,
  ],
})
export class ServicesModule {}
