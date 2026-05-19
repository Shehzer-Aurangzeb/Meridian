import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BinanceService } from '../../market-data/market-data.service';
import { IndicatorsService } from '../../indicators/indicators.service';
import { SupportResistanceService } from '../services/support-resistance.service';
import { SupportResistanceResponseDto } from '../dto/support-resistance-response.dto';
import { Timeframe } from '../../common/constants/timeframes';
import { TimeInterval } from '../../common/types/candle.types';

const COIN_PATTERN = /^[A-Z0-9]{2,15}$/;
const ALLOWED_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];
const ANALYSIS_CANDLE_LIMIT = 250;

@ApiTags('levels')
@Controller('analysis/levels')
export class LevelsController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly supportResistanceService: SupportResistanceService,
  ) {}

  /**
   * Lightweight S/R list backed by stateless IndicatorsService.
   * Suitable for FE drawing tools that just need price levels.
   */
  @Get(':coin')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get key support/resistance levels for an asset' })
  @ApiParam({ name: 'coin', example: 'BTC' })
  @ApiQuery({
    name: 'timeframe',
    required: false,
    enum: ALLOWED_TIMEFRAMES,
    example: '1d',
  })
  @ApiResponse({ status: 200, description: 'Levels returned.' })
  @ApiResponse({ status: 400, description: 'Invalid coin or timeframe.' })
  @ApiResponse({ status: 404, description: 'No market data for symbol.' })
  async getSupportResistanceLevels(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ) {
    const { symbol, tf } = this.normalize(coin, timeframe);

    try {
      const candles = await this.binanceService.getCandles(
        `${symbol}USDT`,
        tf as TimeInterval,
        ANALYSIS_CANDLE_LIMIT,
      );
      if (candles.length === 0) {
        throw new HttpException(
          `No market data for ${symbol}`,
          HttpStatus.NOT_FOUND,
        );
      }

      const currentPrice = candles[candles.length - 1].close;
      const keyLevels = this.indicatorsService.identifyKeyLevels(
        candles,
        currentPrice,
      );
      const nearestSupport = this.indicatorsService.findNearestLevel(
        keyLevels,
        currentPrice,
        'support',
      );
      const nearestResistance = this.indicatorsService.findNearestLevel(
        keyLevels,
        currentPrice,
        'resistance',
      );

      return {
        success: true,
        data: {
          symbol,
          timeframe: tf,
          currentPrice,
          levels: keyLevels,
          nearestSupport,
          nearestResistance,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Failed to get S/R levels';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Full S/R analysis including Fibonacci and pivot levels.
   */
  @Get(':coin/full')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get full S/R analysis (Fib + pivots + zones)' })
  @ApiParam({ name: 'coin', example: 'BTC' })
  @ApiQuery({ name: 'timeframe', required: false, enum: ALLOWED_TIMEFRAMES })
  @ApiResponse({ status: 200, type: SupportResistanceResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid coin or timeframe.' })
  async getFullSupportResistanceAnalysis(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ): Promise<SupportResistanceResponseDto> {
    const { symbol, tf } = this.normalize(coin, timeframe);

    try {
      const currentPrice = await this.binanceService.getCurrentPrice(
        `${symbol}USDT`,
      );
      const analysis = await this.supportResistanceService.getFullAnalysis(
        symbol,
        currentPrice,
        tf,
      );
      return SupportResistanceResponseDto.success(analysis);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Failed to get S/R analysis';
      return SupportResistanceResponseDto.failure(message);
    }
  }

  /**
   * Nearest significant S/R level for quick UI hint.
   */
  @Get(':coin/nearest')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get nearest support/resistance level' })
  @ApiParam({ name: 'coin', example: 'BTC' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['support', 'resistance', 'any'],
  })
  @ApiQuery({ name: 'timeframe', required: false, enum: ALLOWED_TIMEFRAMES })
  @ApiResponse({ status: 200, description: 'Nearest level returned.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  async getNearestLevel(
    @Param('coin') coin: string,
    @Query('type') type: 'support' | 'resistance' | 'any' = 'any',
    @Query('timeframe') timeframe: string = '1d',
  ) {
    if (!['support', 'resistance', 'any'].includes(type)) {
      throw new HttpException(
        'Invalid type. Must be support | resistance | any.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { symbol, tf } = this.normalize(coin, timeframe);

    try {
      const candles = await this.binanceService.getCandles(
        `${symbol}USDT`,
        tf as TimeInterval,
        ANALYSIS_CANDLE_LIMIT,
      );
      if (candles.length === 0) {
        throw new HttpException(
          `No market data for ${symbol}`,
          HttpStatus.NOT_FOUND,
        );
      }
      const currentPrice = candles[candles.length - 1].close;
      const keyLevels = this.indicatorsService.identifyKeyLevels(
        candles,
        currentPrice,
      );
      const nearestLevel = this.indicatorsService.findNearestLevel(
        keyLevels,
        currentPrice,
        type,
      );

      return {
        success: true,
        data: {
          symbol,
          timeframe: tf,
          currentPrice,
          nearestLevel,
          distancePercent: nearestLevel?.distance ?? null,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Failed to find nearest level';
      return { success: false, error: message };
    }
  }

  private normalize(coin: string, timeframe: string) {
    const symbol = (coin ?? '').trim().toUpperCase();
    if (!COIN_PATTERN.test(symbol)) {
      throw new HttpException('Invalid coin symbol', HttpStatus.BAD_REQUEST);
    }
    const tf = ((timeframe ?? '1d').trim() as Timeframe) || '1d';
    if (!ALLOWED_TIMEFRAMES.includes(tf)) {
      throw new HttpException(
        `Invalid timeframe. Allowed: ${ALLOWED_TIMEFRAMES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return { symbol, tf };
  }
}
