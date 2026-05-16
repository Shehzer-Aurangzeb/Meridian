import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { IndicatorsService } from './indicators.service';
import { ClaudeService } from './claude.service';
import { ClaudePromptService } from './claude-prompt.service';
import { PerformanceService } from './performance.service';
import { MultiTimeframeService } from './multi-timeframe.service';
import { ChecklistService } from './checklist.service';
import { SupportResistanceService } from './support-resistance.service';
import { PositionSizingService } from './position-sizing.service';
import { LeverageService } from './leverage.service';
import { CompleteAnalysisService } from './complete-analysis.service';

@Module({
  providers: [
    BinanceService,
    IndicatorsService,
    ClaudePromptService,
    ClaudeService,
    PerformanceService,
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
    PositionSizingService,
    LeverageService,
    CompleteAnalysisService,
  ],
  exports: [
    BinanceService,
    IndicatorsService,
    ClaudePromptService,
    ClaudeService,
    PerformanceService,
    MultiTimeframeService,
    ChecklistService,
    SupportResistanceService,
    PositionSizingService,
    LeverageService,
    CompleteAnalysisService,
  ],
})
export class ServicesModule {}
