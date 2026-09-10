import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { ExpectedMoveModule } from '../expected-move/expected-move.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { AiModule } from '../ai/ai.module';
import { MapService } from './map.service';
import { ConditionService } from './condition.service';
import { CalibrationReportService } from './calibration-report.service';
import { MapController, CalibrationController } from './map.controller';

@Module({
  imports: [
    PrismaModule,
    MarketDataModule,
    IndicatorsModule,
    MarketRegimeModule,
    AnalysisModule,
    ExpectedMoveModule,
    LiquidityModule,
    AiModule,
  ],
  controllers: [MapController, CalibrationController],
  providers: [MapService, ConditionService, CalibrationReportService],
  exports: [MapService, ConditionService, CalibrationReportService],
})
export class MapModule {}
