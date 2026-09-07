import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportResistanceService } from './services/support-resistance.service';
import { LevelMapService } from './services/level-map.service';

/**
 * Price geometry. Swing detection, clustering, and the confluence zones built
 * from them.
 *
 * `TradePlanService` and `ChecklistService` were removed on 6 September 2026
 * with the rest of the directional programme. What remains is measurement:
 * where the levels are, not what to do about them.
 */
@Module({
  imports: [MarketDataModule, IndicatorsModule, PrismaModule],
  providers: [SupportResistanceService, LevelMapService],
  exports: [SupportResistanceService, LevelMapService],
})
export class AnalysisModule {}
