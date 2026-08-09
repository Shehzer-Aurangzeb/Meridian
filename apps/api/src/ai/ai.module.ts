import { Module } from '@nestjs/common';
import { AnalystNarrationService } from './analyst-narration.service';

@Module({
  providers: [AnalystNarrationService],
  exports: [AnalystNarrationService],
})
export class AiModule {}
