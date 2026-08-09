import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { ChecklistService } from './services/checklist.service';
import { SupportResistanceService } from './services/support-resistance.service';
import { LevelMapService } from './services/level-map.service';
import { TradePlanService } from './services/trade-plan.service';

@Module({
  imports: [MarketDataModule, IndicatorsModule, AiModule, PrismaModule, RiskManagementModule],
  providers: [
    ChecklistService,
    SupportResistanceService,
    LevelMapService,
    TradePlanService,
  ],
  exports: [
    ChecklistService,
    SupportResistanceService,
    LevelMapService,
    TradePlanService,
    RiskManagementModule,
  ],
})
export class AnalysisModule {}
