import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { ClaudeService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyzeRequestDto } from './dto/analyze-request.dto';
import { AnalyzeResponseDto, AnalysisData } from './dto/analyze-response.dto';
import { MarketData } from './interfaces/analysis.types';
import { TimeInterval } from '../common/types/candle.types';

@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly claudeService: ClaudeService,
    private readonly prismaService: PrismaService,
  ) {}

  /** @deprecated Use POST /analysis-coordinator/coordinate or GET /analysis-coordinator/stream instead. */
  @Post('analyze')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Legacy single-pass analysis. Use /analysis-coordinator/coordinate.',
  })
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
}