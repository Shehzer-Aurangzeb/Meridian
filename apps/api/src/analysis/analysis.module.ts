import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { PerformanceModule } from '../performance/performance.module';
import { AnalysisController } from './analysis.controller';
import { HistoryController } from './controllers/history.controller';
import { ValidationController } from './controllers/validation.controller';
import { ChecklistService } from './services/checklist.service';
import { SupportResistanceService } from './services/support-resistance.service';
import { LevelMapService } from './services/level-map.service';

@Module({
  imports: [MarketDataModule, IndicatorsModule, AiModule, PrismaModule, RiskManagementModule, PerformanceModule],
  controllers: [AnalysisController, HistoryController, ValidationController],
  providers: [
    ChecklistService,
    SupportResistanceService,
    LevelMapService,
  ],
  exports: [
    ChecklistService,
    SupportResistanceService,
    LevelMapService,
    RiskManagementModule,
    PerformanceModule,
  ],
})
export class AnalysisModule {}
