import { Module } from '@nestjs/common';
import { BinanceService } from './market-data.service';

@Module({
  providers: [BinanceService],
  exports: [BinanceService],
})
export class MarketDataModule {}
