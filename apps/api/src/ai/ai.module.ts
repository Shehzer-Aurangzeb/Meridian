import { Module } from '@nestjs/common';
import { ClaudeService } from './ai.service';
import { ClaudePromptService } from './ai-prompt.service';

@Module({
  providers: [ClaudeService, ClaudePromptService],
  exports: [ClaudeService, ClaudePromptService],
})
export class AiModule {}
