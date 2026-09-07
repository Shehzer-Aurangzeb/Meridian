import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { ExpectedMoveService } from './expected-move.service';

@Module({
  imports: [MarketDataModule, IndicatorsModule],
  providers: [ExpectedMoveService],
  exports: [ExpectedMoveService],
})
export class ExpectedMoveModule {}
