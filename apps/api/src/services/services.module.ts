import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { IndicatorsService } from './indicators.service';
import { ClaudeService } from './claude.service';
import { PerformanceService } from './performance.service';
import { MultiTimeframeService } from './multi-timeframe.service';
import { ChecklistService } from './checklist.service';
import { SupportResistanceService } from './support-resistance.service';

@Module({
  providers: [
    BinanceService,
    IndicatorsService,
    ClaudeService,
    PerformanceService,
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
  ],
  exports: [
    BinanceService,
    IndicatorsService,
    ClaudeService,
    PerformanceService,
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
  ],
})
export class ServicesModule {}
