import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { IndicatorsService } from './indicators.service';
import { ClaudeService } from './claude.service';

@Module({
  providers: [BinanceService, IndicatorsService, ClaudeService],
  exports: [BinanceService, IndicatorsService, ClaudeService],
})
export class ServicesModule {}
