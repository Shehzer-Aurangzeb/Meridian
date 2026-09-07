import { Module } from '@nestjs/common';
import { MapNarrationService } from './map-narration.service';
import { AnalystNarrationService } from './analyst-narration.service';

@Module({
  providers: [AnalystNarrationService, MapNarrationService],
  exports: [AnalystNarrationService, MapNarrationService],
})
export class AiModule {}
