import { Module } from '@nestjs/common';
import { PositionSizingService } from './services/position-sizing.service';
import { LeverageService } from './services/leverage.service';
import { RiskManagementController } from './risk-management.controller';

@Module({
  controllers: [RiskManagementController],
  providers: [PositionSizingService, LeverageService],
  exports: [PositionSizingService, LeverageService],
})
export class RiskManagementModule {}
