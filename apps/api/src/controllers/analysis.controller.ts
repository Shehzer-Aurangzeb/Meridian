import { Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { BinanceService } from '../services/binance.service';
import { IndicatorsService } from '../services/indicators.service';
import { ClaudeService } from '../services/claude.service';
import { PerformanceService, AnalysisWithPerformance } from '../services/performance.service';
import { MultiTimeframeService } from '../services/multi-timeframe.service';
import { SupportResistanceService } from '../services/support-resistance.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyzeRequestDto } from '../dto/analyze-request.dto';
import { AnalyzeResponseDto, AnalysisData } from '../dto/analyze-response.dto';
import { HistoryQueryDto } from '../dto/history-query.dto';
import { HistoryResponseDto } from '../dto/history-response.dto';
import { PerformanceResponseDto, PerformanceAnalysis } from '../dto/performance-response.dto';
import { MultiTimeframeAnalysisDto } from '../dto/multi-timeframe-request.dto';
import {
  MultiTimeframeResponseDto,
  QuickBiasResponseDto,
} from '../dto/multi-timeframe-response.dto';
import {
  SupportResistanceResponseDto,
  LevelsListResponseDto,
} from '../dto/support-resistance-response.dto';
import { MarketData } from '../types/analysis.types';
import { TimeInterval } from '../types/candle.types';
import { Timeframe, TIMEFRAMES } from '../constants/timeframes';
import { Prisma } from '@prisma/client';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly claudeService: ClaudeService,
    private readonly performanceService: PerformanceService,
    private readonly multiTimeframeService: MultiTimeframeService,
    private readonly supportResistanceService: SupportResistanceService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('analyze')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute (uses Claude)
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

  @Get('history')
  async getHistory(@Query() query: HistoryQueryDto): Promise<HistoryResponseDto> {
    try {
      const { limit = 50, startDate, endDate } = query;

      const where: Prisma.TradeAnalysisWhereInput = {};

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const [analyses, total] = await Promise.all([
        this.prismaService.tradeAnalysis.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prismaService.tradeAnalysis.count({ where }),
      ]);

      return HistoryResponseDto.success({
        analyses,
        total,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch history';
      return HistoryResponseDto.failure(message);
    }
  }

  @Get('history/:coin')
  async getHistoryByCoin(
    @Param('coin') coin: string,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryResponseDto> {
    try {
      const { limit = 50, startDate, endDate } = query;
      const normalizedCoin = coin.toUpperCase();

      const where: Prisma.TradeAnalysisWhereInput = {
        coin: normalizedCoin,
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const [analyses, total] = await Promise.all([
        this.prismaService.tradeAnalysis.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prismaService.tradeAnalysis.count({ where }),
      ]);

      return HistoryResponseDto.success({
        analyses,
        total,
        coin: normalizedCoin,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch history';
      return HistoryResponseDto.failure(message);
    }
  }

  @Get('performance')
  async getPerformance(
    @Query() query: HistoryQueryDto,
  ): Promise<PerformanceResponseDto> {
    try {
      const { limit = 100, startDate, endDate } = query;

      const where: Prisma.TradeAnalysisWhereInput = {};

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const analyses = await this.prismaService.tradeAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const analysesWithPerformance =
        await this.performanceService.calculatePerformance(analyses);
      const stats = this.performanceService.calculateWinRate(analysesWithPerformance);

      const recentAnalyses: PerformanceAnalysis[] = analysesWithPerformance.map(
        (a: AnalysisWithPerformance) => ({
          id: a.id,
          coin: a.coin,
          suggestion: a.suggestion,
          entryPrice: a.entryPrice,
          stopLoss: a.stopLoss,
          priceAtAnalysis: a.priceAtAnalysis,
          currentPrice: a.currentPrice,
          status: a.status,
          priceChange: a.priceChange,
          priceChangePercent: a.priceChangePercent,
          createdAt: a.createdAt,
        }),
      );

      return PerformanceResponseDto.success({
        ...stats,
        recentAnalyses,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to calculate performance';
      return PerformanceResponseDto.failure(message);
    }
  }

  @Get('performance/:coin')
  async getPerformanceByCoin(
    @Param('coin') coin: string,
    @Query() query: HistoryQueryDto,
  ): Promise<PerformanceResponseDto> {
    try {
      const { limit = 100, startDate, endDate } = query;
      const normalizedCoin = coin.toUpperCase();

      const where: Prisma.TradeAnalysisWhereInput = {
        coin: normalizedCoin,
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      const analyses = await this.prismaService.tradeAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const analysesWithPerformance =
        await this.performanceService.calculatePerformance(analyses);
      const stats = this.performanceService.calculateWinRate(analysesWithPerformance);

      const recentAnalyses: PerformanceAnalysis[] = analysesWithPerformance.map(
        (a: AnalysisWithPerformance) => ({
          id: a.id,
          coin: a.coin,
          suggestion: a.suggestion,
          entryPrice: a.entryPrice,
          stopLoss: a.stopLoss,
          priceAtAnalysis: a.priceAtAnalysis,
          currentPrice: a.currentPrice,
          status: a.status,
          priceChange: a.priceChange,
          priceChangePercent: a.priceChangePercent,
          createdAt: a.createdAt,
        }),
      );

      return PerformanceResponseDto.success({
        ...stats,
        coin: normalizedCoin,
        recentAnalyses,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to calculate performance';
      return PerformanceResponseDto.failure(message);
    }
  }

  /**
   * Multi-Timeframe Analysis Endpoint
   * Analyzes multiple timeframes to determine HTF bias and LTF entry
   * Based on Miraj's trading strategy with 5-point checklist
   */
  @Post('multi-timeframe')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute
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

  /**
   * Quick HTF Bias Check
   * Returns just the higher timeframe bias for a quick overview
   */
  @Get('bias/:coin')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
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

      // Use 5-point checklist for shouldTrade decision if available
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

  /**
   * Get Support/Resistance Levels
   * Returns key support and resistance levels for a coin
   */
  @Get('levels/:coin')
  async getSupportResistanceLevels(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ): Promise<LevelsListResponseDto> {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

      // Get current price
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      // Get S/R analysis
      const analysis = await this.supportResistanceService.getFullAnalysis(
        symbol,
        currentPrice,
        tf,
      );

      return LevelsListResponseDto.success({
        symbol,
        timeframe: tf,
        currentPrice,
        levels: analysis.levels,
        nearestSupport: analysis.nearestSupport,
        nearestResistance: analysis.nearestResistance,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to get S/R levels';
      return LevelsListResponseDto.failure(message);
    }
  }

  /**
   * Get Full Support/Resistance Analysis
   * Includes Fibonacci levels and detailed analysis
   */
  @Get('levels/:coin/full')
  async getFullSupportResistanceAnalysis(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ): Promise<SupportResistanceResponseDto> {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

      // Get current price
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      // Get full S/R analysis
      const analysis = await this.supportResistanceService.getFullAnalysis(
        symbol,
        currentPrice,
        tf,
      );

      return SupportResistanceResponseDto.success(analysis);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to get S/R analysis';
      return SupportResistanceResponseDto.failure(message);
    }
  }

  /**
   * Get Nearest Support/Resistance Level
   * Quick check for the nearest significant level
   */
  @Get('levels/:coin/nearest')
  async getNearestLevel(
    @Param('coin') coin: string,
    @Query('type') type: 'support' | 'resistance' | 'any' = 'any',
    @Query('timeframe') timeframe: string = '1d',
  ) {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

      // Get current price
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      let level = null;
      if (type === 'support') {
        level = await this.supportResistanceService.findNearestSupport(
          symbol,
          currentPrice,
          tf,
        );
      } else if (type === 'resistance') {
        level = await this.supportResistanceService.findNearestResistance(
          symbol,
          currentPrice,
          tf,
        );
      } else {
        level = await this.supportResistanceService.findNearestLevel(
          symbol,
          currentPrice,
          tf,
        );
      }

      return {
        success: true,
        data: {
          symbol,
          currentPrice,
          nearestLevel: level,
          distancePercent: level?.distancePercent ?? null,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to find nearest level';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Validate Indicators Against TradingView
   * Returns calculated indicator values for manual comparison
   */
  @Get('validate/:coin')
  async validateIndicators(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ) {
    try {
      const symbol = `${coin.toUpperCase()}USDT`;
      const tf = (timeframe || '1d') as TimeInterval;

      // Fetch recent 100 candles
      const candles = await this.binanceService.getCandles(symbol, tf, 100);

      // Extract price arrays
      const closePrices = candles.map((c) => c.close);
      const highPrices = candles.map((c) => c.high);
      const lowPrices = candles.map((c) => c.low);

      // Calculate all indicators
      const rsi = this.indicatorsService.calculateRSI(closePrices, 14);
      const bb = this.indicatorsService.calculateBollingerBands(closePrices, 20, 2);
      const atr = this.indicatorsService.calculateATR(highPrices, lowPrices, closePrices, 14);
      const qqe = this.indicatorsService.calculateQQE(closePrices, 14);
      const bandWidth = this.indicatorsService.calculateBandWidth(bb);

      // Calculate manual SMA for verification
      const last20Closes = closePrices.slice(-20);
      const manualSMA = last20Closes.reduce((a, b) => a + b, 0) / 20;

      // Get last candle info
      const lastCandle = candles[candles.length - 1];
      const currentPrice = lastCandle.close;

      return {
        success: true,
        data: {
          symbol,
          timeframe: tf,
          candleCount: candles.length,
          lastCandle: {
            time: lastCandle.time,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
            volume: lastCandle.volume,
          },
          indicators: {
            rsi: {
              value: Number(rsi.toFixed(2)),
              period: 14,
              description: 'RSI(14) - Compare with TradingView RSI indicator',
            },
            bollingerBands: {
              upper: Number(bb.upper.toFixed(2)),
              middle: Number(bb.middle.toFixed(2)),
              lower: Number(bb.lower.toFixed(2)),
              period: 20,
              stdDev: 2,
              description: 'BB(20,2) - Compare with TradingView Bollinger Bands',
            },
            atr: {
              value: Number(atr.toFixed(2)),
              period: 14,
              description: 'ATR(14) - Compare with TradingView ATR indicator',
            },
            qqe: {
              color: qqe.color,
              value: Number(qqe.value.toFixed(2)),
              trend: qqe.trend,
              previousColor: qqe.previousColor,
              description: 'QQE Mod - Custom indicator based on smoothed RSI',
            },
            bandWidth: {
              value: Number(bandWidth.toFixed(2)),
              description: 'Bollinger Band Width as percentage',
            },
          },
          verification: {
            manualSMA20: Number(manualSMA.toFixed(2)),
            bbMiddleMatchesSMA: Math.abs(bb.middle - manualSMA) < 0.01,
            currentPrice: Number(currentPrice.toFixed(2)),
          },
          instructions: [
            '1. Open TradingView and load ' + symbol + ' chart',
            '2. Set timeframe to ' + tf,
            '3. Add RSI(14) indicator and compare with rsi.value above',
            '4. Add Bollinger Bands(20,2) and compare with bollingerBands values',
            '5. Add ATR(14) and compare with atr.value above',
            '6. Document any differences in INDICATOR_VALIDATION.md',
          ],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Indicator validation failed';
      return {
        success: false,
        error: message,
      };
    }
  }
}
