import { Module } from '@nestjs/common';
import { MapNarrationService } from './map-narration.service';

@Module({
  providers: [MapNarrationService],
  exports: [MapNarrationService],
})
export class AiModule {}
