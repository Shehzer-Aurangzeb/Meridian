import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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

/**
 * @deprecated Controller not consumed by frontend. Risk calculations are embedded in portfolio-scan.
 * Retained for potential standalone risk calculator UI or API consumers.
 */
@ApiTags('risk-management')
@Controller('analysis')
export class RiskManagementController {
  constructor(
    private readonly positionSizingService: PositionSizingService,
    private readonly leverageService: LeverageService,
  ) {}

  /**
   * How large a position to take, from the account size and how much of it you
   * are willing to lose.
   *
   * TODO: unused by the website — position sizing happens inside the portfolio
   * scan instead. Remove if nothing starts calling it.
   */
  @Post('position-size')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Calculate position size. Risk sizing is embedded in portfolio-scan.',
  })
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
   * @deprecated Not consumed by frontend. R:R is calculated in AI analysis output.
   * Calculate Risk/Reward Ratios
   * Returns R:R for each take profit level
   * Overall uses weighted average: 20% TP1, 30% TP2, 50% TP3
   */
  @Post('risk-reward')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Calculate risk/reward ratios. R:R is embedded in AI analysis.',
  })
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
   * How to split an account across long, medium and short-term trades: 60% /
   * 20% / 20%, with more leverage allowed on the smaller, faster slices.
   *
   * TODO: unused by the website, and the split never changes. Remove or make
   * it configurable.
   */
  @Get('portfolio-allocation')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Get portfolio allocation. Static 60/20/20 rule.',
  })
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
   * @deprecated Not consumed by frontend. Leverage is embedded in AI recommendation.
   * Get Recommended Leverage for Timeframe
   * Returns min, max, and recommended leverage based on timeframe
   */
  @Get('leverage/:timeframe')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Get recommended leverage. Embedded in AI recommendation.',
  })
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
   * @deprecated Not consumed by frontend. Smart leverage is embedded in portfolio-scan.
   * Get Smart Leverage Recommendation
   * Considers timeframe, experience, confidence, volatility, and market conditions
   */
  @Post('leverage-recommendation')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Smart leverage recommendation. Embedded in portfolio-scan.',
  })
  async recommendLeverage(@Body() dto: RecommendLeverageDto) {
    try {
      const result = this.leverageService.recommendLeverage({
        timeframe: dto.timeframe,
        conditionsMet: dto.checklistScore ?? null,
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
   * @deprecated Not consumed by frontend. Constraints are internal to leverage service.
   * Get Leverage Constraints
   * Returns min/max leverage for experience level + timeframe
   */
  @Get('leverage-constraints')
  @SkipThrottle()
  @ApiOperation({
    deprecated: true,
    summary: '[DEPRECATED] Get leverage constraints. Internal to leverage service.',
  })
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
