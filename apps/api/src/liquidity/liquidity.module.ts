import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LiquidityService } from './liquidity.service';

@Module({
  imports: [PrismaModule],
  providers: [LiquidityService],
  exports: [LiquidityService],
})
export class LiquidityModule {}
