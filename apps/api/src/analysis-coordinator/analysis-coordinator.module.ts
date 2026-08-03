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
import { AnalysisCoordinatorController } from './analysis-coordinator.controller';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { MultiTimeframeScannerService } from './multi-timeframe-scanner.service';

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
  controllers: [AnalysisCoordinatorController],
  providers: [
    AnalysisCoordinatorService,
    CoordinatorPersistenceService,
    MultiTimeframeScannerService,
  ],
  exports: [
    AnalysisCoordinatorService,
    CoordinatorPersistenceService,
    MultiTimeframeScannerService,
  ],
})
export class AnalysisCoordinatorModule {}
