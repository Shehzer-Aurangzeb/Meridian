import { Module } from '@nestjs/common';
import { BinanceService } from './market-data.service';
import { CacheTelemetryService } from './cache-telemetry.service';

@Module({
  providers: [BinanceService, CacheTelemetryService],
  exports: [BinanceService, CacheTelemetryService],
})
export class MarketDataModule {}
