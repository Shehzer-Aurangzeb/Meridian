import { Module } from '@nestjs/common';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { SqueezeBreakoutModule } from '../squeeze-breakout/squeeze-breakout.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { AnalysisCoordinatorService } from './analysis-coordinator.service';
import { AnalysesController } from './analyses.controller';
import { AnalyzeService } from './analyze.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { OutcomeScorerService } from './outcome-scorer.service';

@Module({
  imports: [
    MarketRegimeModule,
    SqueezeBreakoutModule,
    AnalysisModule,
    MarketDataModule,
    IndicatorsModule,
    AiModule,
    PrismaModule,
    RiskManagementModule,
  ],
  controllers: [AnalysesController],
  providers: [
    AnalysisCoordinatorService,
    AnalyzeService,
    CoordinatorPersistenceService,
    OutcomeScorerService,
  ],
  exports: [
    AnalysisCoordinatorService,
    AnalyzeService,
    CoordinatorPersistenceService,
    OutcomeScorerService,
  ],
})
export class AnalysisCoordinatorModule {}
