import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { MarketRegimeService } from './market-regime.service';

@Module({
  imports: [MarketDataModule, IndicatorsModule],
  providers: [MarketRegimeService],
  exports: [MarketRegimeService],
})
export class MarketRegimeModule {}
