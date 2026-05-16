import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { PerformanceModule } from '../performance/performance.module';
import { AnalysisController } from './analysis.controller';
import { HistoryController } from './controllers/history.controller';
import { LevelsController } from './controllers/levels.controller';
import { ValidationController } from './controllers/validation.controller';
import { MultiTimeframeService } from './services/multi-timeframe.service';
import { ChecklistService } from './services/checklist.service';
import { SupportResistanceService } from './services/support-resistance.service';
import { CompleteAnalysisService } from './services/complete-analysis.service';

@Module({
  imports: [MarketDataModule, IndicatorsModule, AiModule, PrismaModule, RiskManagementModule, PerformanceModule],
  controllers: [AnalysisController, HistoryController, LevelsController, ValidationController],
  providers: [
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
    CompleteAnalysisService,
  ],
  exports: [
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
    CompleteAnalysisService,
    RiskManagementModule,
    PerformanceModule,
  ],
})
export class AnalysisModule {}
