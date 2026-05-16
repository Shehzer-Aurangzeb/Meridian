import { Controller, Get, Param, Query } from '@nestjs/common';
import { BinanceService } from '../../market-data/market-data.service';
import { SupportResistanceService } from '../services/support-resistance.service';
import {
  SupportResistanceResponseDto,
  LevelsListResponseDto,
} from '../dto/support-resistance-response.dto';
import { Timeframe } from '../../common/constants/timeframes';

@Controller('analysis/levels')
export class LevelsController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly supportResistanceService: SupportResistanceService,
  ) {}

  /**
   * Get Support/Resistance Levels
   * Returns key support and resistance levels for a coin
   */
  @Get(':coin')
  async getSupportResistanceLevels(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ): Promise<LevelsListResponseDto> {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

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
  @Get(':coin/full')
  async getFullSupportResistanceAnalysis(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ): Promise<SupportResistanceResponseDto> {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

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
  @Get(':coin/nearest')
  async getNearestLevel(
    @Param('coin') coin: string,
    @Query('type') type: 'support' | 'resistance' | 'any' = 'any',
    @Query('timeframe') timeframe: string = '1d',
  ) {
    try {
      const symbol = coin.toUpperCase();
      const tf = (timeframe || '1d') as Timeframe;

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
}
