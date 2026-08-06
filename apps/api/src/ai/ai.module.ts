import { Module } from '@nestjs/common';
import { ClaudeService } from './ai.service';
import { ClaudePromptService } from './ai-prompt.service';
import { AnalystNarrationService } from './analyst-narration.service';

@Module({
  providers: [ClaudeService, ClaudePromptService, AnalystNarrationService],
  exports: [ClaudeService, ClaudePromptService, AnalystNarrationService],
})
export class AiModule {}
