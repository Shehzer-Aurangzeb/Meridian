import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { IndicatorsService } from './indicators.service';
import { ClaudeService } from './claude.service';
import { PerformanceService } from './performance.service';

@Module({
  providers: [BinanceService, IndicatorsService, ClaudeService, PerformanceService],
  exports: [BinanceService, IndicatorsService, ClaudeService, PerformanceService],
})
export class ServicesModule {}
