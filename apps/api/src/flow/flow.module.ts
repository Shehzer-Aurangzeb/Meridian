import { Module } from '@nestjs/common';
import { FlowCollectorService } from './flow-collector.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FlowCollectorService],
  exports: [FlowCollectorService],
})
export class FlowModule {}
