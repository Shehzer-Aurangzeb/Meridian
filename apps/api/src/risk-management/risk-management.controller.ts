import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PositionSizingService } from './services/position-sizing.service';
import { LeverageService } from './services/leverage.service';
import {
  CalculatePositionSizeDto,
  CalculateRiskRewardDto,
  PortfolioAllocationQueryDto,
} from './dto/position-sizing.dto';
import {
  RecommendLeverageDto,
  GetLeverageConstraintsDto,
} from './dto/leverage.dto';

@Controller('analysis')
export class RiskManagementController {
  constructor(
    private readonly positionSizingService: PositionSizingService,
    private readonly leverageService: LeverageService,
  ) {}

  /**
   * Calculate Position Size
   * Based on Miraj's risk management rules:
   * - Risk Amount = accountBalance × (riskPercentage / 100)
   * - Position Size = riskAmount / (stopLossPercentage / 100)
   * - Margin = positionSize / leverage
   */
  @Post('position-size')
  @SkipThrottle()
  async calculatePositionSize(@Body() dto: CalculatePositionSizeDto) {
    try {
      const result = this.positionSizingService.calculatePositionSize({
        accountBalance: dto.accountBalance,
        riskPercentage: dto.riskPercentage,
        entryPrice: dto.entryPrice,
        stopLoss: dto.stopLoss,
        leverage: dto.leverage,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Position size calculation failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Calculate Risk/Reward Ratios
   * Returns R:R for each take profit level
   * Overall uses weighted average: 20% TP1, 30% TP2, 50% TP3
   */
  @Post('risk-reward')
  @SkipThrottle()
  async calculateRiskReward(@Body() dto: CalculateRiskRewardDto) {
    try {
      const result = this.positionSizingService.calculateRiskReward(
        dto.entryPrice,
        dto.stopLoss,
        {
          tp1: dto.tp1,
          tp2: dto.tp2,
          tp3: dto.tp3,
        },
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Risk/reward calculation failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get Portfolio Allocation
   * Based on Miraj's 60/20/20 rule:
   * - 60% Long-term (1x leverage, HTF trades)
   * - 20% Mid-term (2-3x leverage, day trades)
   * - 20% Short-term (5-10x leverage, scalps)
   */
  @Get('portfolio-allocation')
  @SkipThrottle()
  async getPortfolioAllocation(@Query() query: PortfolioAllocationQueryDto) {
    try {
      const result = this.positionSizingService.calculatePortfolioAllocation(
        query.balance,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Portfolio allocation failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get Recommended Leverage for Timeframe
   * Returns min, max, and recommended leverage based on timeframe
   */
  @Get('leverage/:timeframe')
  @SkipThrottle()
  async getRecommendedLeverage(@Param('timeframe') timeframe: string) {
    try {
      const result = this.positionSizingService.getRecommendedLeverage(timeframe);

      return {
        success: true,
        data: {
          timeframe,
          ...result,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Leverage recommendation failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get Smart Leverage Recommendation
   * Considers timeframe, experience, confidence, volatility, and market conditions
   */
  @Post('leverage-recommendation')
  @SkipThrottle()
  async recommendLeverage(@Body() dto: RecommendLeverageDto) {
    try {
      const result = this.leverageService.recommendLeverage({
        timeframe: dto.timeframe,
        checklistScore: dto.checklistScore,
        atr: dto.atr,
        currentPrice: dto.currentPrice,
        stopLossPercentage: dto.stopLossPercentage,
        experienceLevel: dto.experienceLevel,
        tradeStyle: dto.tradeStyle,
        riskTolerance: dto.riskTolerance,
        marketCycle: dto.marketCycle,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Leverage recommendation failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get Leverage Constraints
   * Returns min/max leverage for experience level + timeframe
   */
  @Get('leverage-constraints')
  @SkipThrottle()
  async getLeverageConstraints(@Query() query: GetLeverageConstraintsDto) {
    try {
      const result = this.leverageService.getLeverageConstraints(
        query.experienceLevel,
        query.timeframe,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to get leverage constraints';
      return {
        success: false,
        error: message,
      };
    }
  }
}
