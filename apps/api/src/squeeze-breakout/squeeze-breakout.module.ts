import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { SqueezeBreakoutService } from './squeeze-breakout.service';

@Module({
  imports: [MarketDataModule],
  providers: [SqueezeBreakoutService],
  exports: [SqueezeBreakoutService],
})
export class SqueezeBreakoutModule {}
