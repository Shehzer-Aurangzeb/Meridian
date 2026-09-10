import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { SimService } from './sim.service';
import { SimParseService } from './sim.parse';
import { SimController } from './sim.controller';

@Module({
  imports: [PrismaModule, MarketDataModule, IndicatorsModule, MarketRegimeModule],
  controllers: [SimController],
  providers: [SimService, SimParseService],
  exports: [SimService, SimParseService],
})
export class SimModule {}
