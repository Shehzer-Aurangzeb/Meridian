import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { ClaudeService } from '../ai/ai.service';
import { ClaudePromptService } from '../ai/ai-prompt.service';
import { MultiTimeframeService } from './services/multi-timeframe.service';
import { SupportResistanceService } from './services/support-resistance.service';
import { CompleteAnalysisService } from './services/complete-analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyzeRequestDto } from './dto/analyze-request.dto';
import { AnalyzeResponseDto, AnalysisData } from './dto/analyze-response.dto';
import { MultiTimeframeAnalysisDto } from './dto/multi-timeframe-request.dto';
import {
  MultiTimeframeResponseDto,
  QuickBiasResponseDto,
} from './dto/multi-timeframe-response.dto';
import {
  CompleteAnalysisDto,
  QuickAnalysisDto,
} from './dto/complete-analysis.dto';
import { MarketData } from './interfaces/analysis.types';
import { TimeInterval } from '../common/types/candle.types';

@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly claudeService: ClaudeService,
    private readonly claudePromptService: ClaudePromptService,
    private readonly multiTimeframeService: MultiTimeframeService,
    private readonly supportResistanceService: SupportResistanceService,
    private readonly completeAnalysisService: CompleteAnalysisService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('analyze')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async analyze(@Body() dto: AnalyzeRequestDto): Promise<AnalyzeResponseDto> {
    const { coin, timeframe = '4h' } = dto;

    try {
      const candles = await this.binanceService.getCandles(
        coin,
        timeframe as TimeInterval,
        100,
      );
      const currentPrice = await this.binanceService.getCurrentPrice(coin);
      const indicators = this.indicatorsService.analyzeTimeframe(candles);

      const marketData: MarketData = {
        coin,
        timeframe,
        currentPrice,
        indicators,
        candles,
      };

      const analysis = await this.claudeService.analyzeMarket(marketData);

      const savedAnalysis = await this.prismaService.tradeAnalysis.create({
        data: {
          coin,
          timeframe,
          entryPrice: analysis.entryPrice,
          tp1: analysis.tp1,
          tp2: analysis.tp2,
          tp3: analysis.tp3,
          stopLoss: analysis.stopLoss,
          leverage: analysis.leverage,
          suggestion: analysis.action,
          reasoning: analysis.reasoning,
          rsiValue: indicators.rsi,
          bbUpper: indicators.bollingerBands.upper,
          bbMiddle: indicators.bollingerBands.middle,
          bbLower: indicators.bollingerBands.lower,
          atrValue: indicators.atr,
          priceAtAnalysis: currentPrice,
        },
      });

      const responseData: AnalysisData = {
        id: savedAnalysis.id,
        coin,
        action: analysis.action,
        entryPrice: analysis.entryPrice,
        tp1: analysis.tp1,
        tp2: analysis.tp2,
        tp3: analysis.tp3,
        stopLoss: analysis.stopLoss,
        leverage: analysis.leverage,
        reasoning: analysis.reasoning,
        conditionsMet: analysis.conditionsMet,
        indicators: {
          rsi: indicators.rsi,
          bb: {
            upper: indicators.bollingerBands.upper,
            middle: indicators.bollingerBands.middle,
            lower: indicators.bollingerBands.lower,
          },
          atr: indicators.atr,
          support: indicators.support,
          resistance: indicators.resistance,
        },
        currentPrice,
        timeframe,
        timestamp: savedAnalysis.createdAt,
      };

      return AnalyzeResponseDto.success(responseData);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`Analysis failed for ${coin}:`, error);
      return AnalyzeResponseDto.failure(message);
    }
  }

  @Post('multi-timeframe')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async analyzeMultiTimeframe(
    @Body() dto: MultiTimeframeAnalysisDto,
  ): Promise<MultiTimeframeResponseDto> {
    try {
      const { coin, tradeType = 'day', includeDetailedChecklist = true } = dto;

      const result = await this.multiTimeframeService.analyzeMultipleTimeframes({
        symbol: coin.toUpperCase(),
        tradeType,
        includeDetailedChecklist,
      });

      return MultiTimeframeResponseDto.success(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Multi-timeframe analysis failed';
      console.error(`Multi-timeframe analysis failed for ${dto.coin}:`, error);
      return MultiTimeframeResponseDto.failure(message);
    }
  }

  @Get('bias/:coin')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getQuickBias(
    @Param('coin') coin: string,
    @Query('tradeType') tradeType: 'swing' | 'day' | 'scalp' = 'day',
  ): Promise<QuickBiasResponseDto> {
    try {
      const symbol = coin.toUpperCase();

      const result = await this.multiTimeframeService.analyzeMultipleTimeframes({
        symbol,
        tradeType,
        includeDetailedChecklist: true,
      });

      const shouldTrade = result.fivePointChecklist
        ? result.fivePointChecklist.passed
        : result.entryChecklist.passed && result.ltfEntry.hasEntry;

      return QuickBiasResponseDto.success({
        symbol,
        htfBias: result.htfBias,
        shouldTrade,
        reasoning: result.tradeSuggestion.reasoning,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Quick bias check failed';
      return QuickBiasResponseDto.failure(message);
    }
  }

  @Post('ai-analyze')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async aiAnalyze(
    @Body() dto: MultiTimeframeAnalysisDto,
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    meta?: { promptLength: number; processingTime: number };
  }> {
    const startTime = Date.now();
    const { coin, tradeType = 'day' } = dto;

    try {
      const mtfResult = await this.multiTimeframeService.analyzeMultipleTimeframes({
        symbol: coin.toUpperCase(),
        tradeType,
        includeDetailedChecklist: true,
      });

      const srAnalysis = await this.supportResistanceService.getFullAnalysis(
        coin.toUpperCase(),
        mtfResult.currentPrice,
      );

      if (!mtfResult.fivePointChecklist) {
        throw new Error('5-point checklist not available');
      }

      const promptData = {
        coin: coin.toUpperCase(),
        currentPrice: mtfResult.currentPrice,
        multiTimeframeAnalysis: mtfResult,
        checklist: mtfResult.fivePointChecklist,
        srLevels: srAnalysis.levels,
      };

      const analysis = await this.claudeService.analyzeWithChecklist(promptData);

      return {
        success: true,
        data: {
          analysis,
          checklist: mtfResult.fivePointChecklist,
          htfBias: mtfResult.htfBias,
          ltfEntry: mtfResult.ltfEntry,
          currentPrice: mtfResult.currentPrice,
          keyLevels: {
            support: srAnalysis.levels
              .filter((l: { type: string }) => l.type === 'support')
              .slice(0, 3),
            resistance: srAnalysis.levels
              .filter((l: { type: string }) => l.type === 'resistance')
              .slice(0, 3),
          },
        },
        meta: {
          promptLength: this.claudePromptService.buildAnalysisPrompt(promptData).length,
          processingTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI analysis failed';
      console.error(`AI analysis failed for ${coin}:`, error);
      return {
        success: false,
        error: message,
        meta: { promptLength: 0, processingTime: Date.now() - startTime },
      };
    }
  }

  @Post('test-prompt')
  @SkipThrottle()
  async testPrompt(
    @Body() dto: MultiTimeframeAnalysisDto,
  ): Promise<{
    success: boolean;
    prompt?: string;
    promptLength?: number;
    checklistSummary?: any;
    error?: string;
  }> {
    const { coin, tradeType = 'day' } = dto;

    try {
      const mtfResult = await this.multiTimeframeService.analyzeMultipleTimeframes({
        symbol: coin.toUpperCase(),
        tradeType,
        includeDetailedChecklist: true,
      });

      const srAnalysis = await this.supportResistanceService.getFullAnalysis(
        coin.toUpperCase(),
        mtfResult.currentPrice,
      );

      if (!mtfResult.fivePointChecklist) {
        throw new Error('5-point checklist not available');
      }

      const promptData = {
        coin: coin.toUpperCase(),
        currentPrice: mtfResult.currentPrice,
        multiTimeframeAnalysis: mtfResult,
        checklist: mtfResult.fivePointChecklist,
        srLevels: srAnalysis.levels,
      };

      const prompt = this.claudePromptService.buildAnalysisPrompt(promptData);

      return {
        success: true,
        prompt,
        promptLength: prompt.length,
        checklistSummary: {
          totalScore: mtfResult.fivePointChecklist.totalScore,
          conditionsMet: mtfResult.fivePointChecklist.conditionsMet,
          passed: mtfResult.fivePointChecklist.passed,
          tradeType: mtfResult.fivePointChecklist.tradeType,
          conditions: mtfResult.fivePointChecklist.conditions.map((c) => ({
            name: c.name,
            passed: c.passed,
            score: c.score,
          })),
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Prompt generation failed';
      return { success: false, error: message };
    }
  }

  @Post('complete')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async analyzeComplete(@Body() dto: CompleteAnalysisDto) {
    try {
      const result = await this.completeAnalysisService.analyzeComplete({
        coin: dto.coin,
        tradeType: dto.tradeType,
        timeframe: dto.timeframe,
        accountBalance: dto.accountBalance,
        riskPercentage: dto.riskPercentage,
        experienceLevel: dto.experienceLevel,
        riskTolerance: dto.riskTolerance,
        includeRiskManagement: dto.includeRiskManagement,
        includeFibonacci: dto.includeFibonacci,
      });

      return { success: true, data: result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Complete analysis failed';
      console.error(`Complete analysis failed for ${dto.coin}:`, error);
      return { success: false, error: message };
    }
  }

  @Post('quick')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async analyzeQuick(@Body() dto: QuickAnalysisDto) {
    try {
      const result = await this.completeAnalysisService.analyzeComplete({
        coin: dto.coin,
        includeRiskManagement: false,
      });

      return { success: true, data: result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Quick analysis failed';
      console.error(`Quick analysis failed for ${dto.coin}:`, error);
      return { success: false, error: message };
    }
  }
}
