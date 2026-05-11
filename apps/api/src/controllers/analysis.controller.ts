import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { BinanceService } from '../services/binance.service';
import { IndicatorsService } from '../services/indicators.service';
import { ClaudeService } from '../services/claude.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyzeRequestDto } from '../dto/analyze-request.dto';
import { AnalyzeResponseDto, AnalysisData } from '../dto/analyze-response.dto';
import { MarketData } from '../types/analysis.types';
import { TimeInterval } from '../types/candle.types';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly claudeService: ClaudeService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('analyze')
  async analyze(@Body() dto: AnalyzeRequestDto): Promise<AnalyzeResponseDto> {
    const { coin, timeframe = '4h' } = dto;

    try {
      // 1. Fetch candles from Binance
      const candles = await this.binanceService.getCandles(
        coin,
        timeframe as TimeInterval,
        100,
      );

      // 2. Get current price
      const currentPrice = await this.binanceService.getCurrentPrice(coin);

      // 3. Calculate indicators
      const indicators = this.indicatorsService.analyzeTimeframe(candles);

      // 4. Build market data for Claude
      const marketData: MarketData = {
        coin,
        timeframe,
        currentPrice,
        indicators,
        candles,
      };

      // 5. Get trade analysis from Claude
      const analysis = await this.claudeService.analyzeMarket(marketData);

      // 6. Save to database
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

      // 7. Build response
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

      // Log error for debugging
      console.error(`Analysis failed for ${coin}:`, error);

      // Return error response
      return AnalyzeResponseDto.failure(message);
    }
  }
}
