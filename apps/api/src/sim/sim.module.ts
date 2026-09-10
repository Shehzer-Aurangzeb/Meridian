import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SimService } from './sim.service';
import { SimParseService } from './sim.parse';
import { SimController } from './sim.controller';

@Module({
  imports: [PrismaModule, MarketDataModule],
  controllers: [SimController],
  providers: [SimService, SimParseService],
  exports: [SimService, SimParseService],
})
export class SimModule {}
