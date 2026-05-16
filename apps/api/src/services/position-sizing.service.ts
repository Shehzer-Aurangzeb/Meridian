import { Injectable, BadRequestException } from '@nestjs/common';
import {
  PositionSizingInput,
  PositionSizingResult,
  PortfolioAllocation,
  RiskRewardResult,
  PortfolioType,
} from '../types/position-sizing.types';

@Injectable()
export class PositionSizingService {
  /**
   * Calculate position size based on account balance and risk parameters
   * Following Miraj's 1-2% risk rule
   */
  calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
    const { accountBalance, riskPercentage, entryPrice, stopLoss, leverage } =
      input;

    // Validate inputs
    this.validateInputs(input);

    // Determine trade direction
    const direction: 'long' | 'short' = stopLoss < entryPrice ? 'long' : 'short';

    // 1. Calculate risk amount (1-2% of account)
    const riskAmount = accountBalance * (riskPercentage / 100);

    // 2. Calculate stop loss distance and percentage
    const stopLossDistance = Math.abs(entryPrice - stopLoss);
    const stopLossPercentage = (stopLossDistance / entryPrice) * 100;

    // 3. Calculate position size
    // Formula: Risk Amount / (Stop Loss Percentage / 100)
    // This ensures if stop is hit, loss equals riskAmount
    const positionSize = riskAmount / (stopLossPercentage / 100);

    // 4. Calculate margin required (actual capital used)
    const margin = positionSize / leverage;
    const marginPercentage = (margin / accountBalance) * 100;

    // 5. Calculate coin amount
    const coinAmount = positionSize / entryPrice;

    // 6. Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction,
    );
    const liquidationDistance = Math.abs(entryPrice - liquidationPrice);

    // 7. Validation and warnings
    const warnings: string[] = [];
    let isValid = true;

    // Check if margin exceeds available balance
    if (margin > accountBalance) {
      warnings.push(
        `Insufficient balance: need $${margin.toFixed(2)} but only have $${accountBalance.toFixed(2)}`,
      );
      isValid = false;
    }

    // Check if using too much capital (> 10% of account)
    if (marginPercentage > 10) {
      warnings.push(
        `High capital usage: ${marginPercentage.toFixed(1)}% of account used as margin`,
      );
    }

    // Check if stop loss is too tight (< 2%)
    if (stopLossPercentage < 2) {
      warnings.push(
        'Stop loss very tight (< 2%) - may get hit from normal volatility',
      );
    }

    // Check if stop loss is too wide (> 15%)
    if (stopLossPercentage > 15) {
      warnings.push(
        'Stop loss very wide (> 15%) - consider reducing leverage or tighter stop',
      );
    }

    // Check liquidation proximity - is liquidation closer than stop loss?
    if (direction === 'long' && liquidationPrice > stopLoss) {
      warnings.push(
        `DANGER: Liquidation ($${liquidationPrice.toFixed(2)}) is ABOVE stop loss ($${stopLoss.toFixed(2)})`,
      );
      isValid = false;
    }
    if (direction === 'short' && liquidationPrice < stopLoss) {
      warnings.push(
        `DANGER: Liquidation ($${liquidationPrice.toFixed(2)}) is BELOW stop loss ($${stopLoss.toFixed(2)})`,
      );
      isValid = false;
    }

    // Check buffer between stop loss and liquidation (should be > 5%)
    const liquidationBuffer =
      (Math.abs(liquidationPrice - stopLoss) / stopLoss) * 100;
    if (liquidationBuffer < 5 && isValid) {
      warnings.push(
        `Liquidation close to stop loss (${liquidationBuffer.toFixed(1)}% buffer) - reduce leverage`,
      );
    }

    // Leverage warnings
    if (leverage > 10) {
      warnings.push('High leverage (> 10x) - very risky, use smaller position');
    }

    return {
      riskAmount: this.round(riskAmount, 2),
      positionSize: this.round(positionSize, 2),
      coinAmount: this.round(coinAmount, 6),
      margin: this.round(margin, 2),
      marginPercentage: this.round(marginPercentage, 2),
      stopLossDistance: this.round(stopLossDistance, 2),
      stopLossPercentage: this.round(stopLossPercentage, 2),
      liquidationPrice: this.round(liquidationPrice, 2),
      liquidationDistance: this.round(liquidationDistance, 2),
      riskRewardRatio: 0, // Calculated separately with TP levels
      maxLoss: this.round(riskAmount, 2),
      direction,
      isValid,
      warnings,
    };
  }

  /**
   * Calculate liquidation price for leveraged position
   * Liquidation happens when loss equals margin (100% of margin lost)
   */
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: 'long' | 'short',
  ): number {
    // Liquidation percentage = 100 / leverage
    // For 10x leverage, liquidation at 10% move against position
    const liquidationPercentage = 100 / leverage;

    if (direction === 'long') {
      // Long liquidates when price drops by (100 / leverage)%
      return entryPrice * (1 - liquidationPercentage / 100);
    } else {
      // Short liquidates when price rises by (100 / leverage)%
      return entryPrice * (1 + liquidationPercentage / 100);
    }
  }

  /**
   * Calculate risk/reward ratio based on take profit levels
   * Uses Miraj's allocation: 20% at TP1, 30% at TP2, 50% at TP3
   */
  calculateRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfits: { tp1: number; tp2: number; tp3: number },
  ): RiskRewardResult {
    const risk = Math.abs(entryPrice - stopLoss);

    if (risk === 0) {
      throw new BadRequestException('Entry and stop loss cannot be the same');
    }

    const tp1Reward = Math.abs(takeProfits.tp1 - entryPrice);
    const tp2Reward = Math.abs(takeProfits.tp2 - entryPrice);
    const tp3Reward = Math.abs(takeProfits.tp3 - entryPrice);

    // Weighted average R:R based on Miraj's allocation (20%, 30%, 50%)
    const averageReward =
      tp1Reward * 0.2 + tp2Reward * 0.3 + tp3Reward * 0.5;

    return {
      overall: this.round(averageReward / risk, 2),
      tp1: this.round(tp1Reward / risk, 2),
      tp2: this.round(tp2Reward / risk, 2),
      tp3: this.round(tp3Reward / risk, 2),
    };
  }

  /**
   * Calculate portfolio allocation based on Miraj's 60/20/20 rule
   */
  calculatePortfolioAllocation(totalBalance: number): PortfolioAllocation {
    if (totalBalance <= 0) {
      throw new BadRequestException('Total balance must be positive');
    }

    return {
      totalBalance,
      longTerm: {
        allocation: this.round(totalBalance * 0.6, 2),
        leverage: 1,
        purpose: 'Hold months-years (spot)',
      },
      midTerm: {
        allocation: this.round(totalBalance * 0.2, 2),
        leverage: 2,
        purpose: 'Swing trades (days-weeks)',
      },
      shortTerm: {
        allocation: this.round(totalBalance * 0.2, 2),
        leverage: 5,
        purpose: 'Day trades (hours-days)',
      },
    };
  }

  /**
   * Suggest appropriate sub-portfolio for a trade based on timeframe and leverage
   */
  suggestPortfolioType(timeframe: string, leverage: number): PortfolioType {
    // Long-term: Daily/Weekly timeframes, 1x leverage
    if (
      timeframe === '1d' ||
      timeframe === '1w' ||
      timeframe === '1M' ||
      leverage === 1
    ) {
      return 'longTerm';
    }

    // Mid-term: 12h/4h timeframes, 2-3x leverage
    if (
      timeframe === '12h' ||
      timeframe === '4h' ||
      (leverage >= 2 && leverage <= 3)
    ) {
      return 'midTerm';
    }

    // Short-term: 1h/15m timeframes, 5-10x+ leverage
    return 'shortTerm';
  }

  /**
   * Get recommended leverage based on timeframe
   */
  getRecommendedLeverage(timeframe: string): {
    min: number;
    max: number;
    recommended: number;
  } {
    switch (timeframe) {
      case '1d':
      case '1w':
      case '1M':
        return { min: 1, max: 2, recommended: 1 };
      case '12h':
        return { min: 2, max: 3, recommended: 2 };
      case '4h':
        return { min: 2, max: 5, recommended: 3 };
      case '1h':
        return { min: 3, max: 7, recommended: 5 };
      case '15m':
        return { min: 5, max: 10, recommended: 7 };
      case '5m':
      case '1m':
        return { min: 5, max: 15, recommended: 10 };
      default:
        return { min: 1, max: 5, recommended: 3 };
    }
  }

  /**
   * Validate position sizing inputs
   */
  private validateInputs(input: PositionSizingInput): void {
    if (input.accountBalance <= 0) {
      throw new BadRequestException('Account balance must be positive');
    }

    if (input.riskPercentage < 0.5 || input.riskPercentage > 5) {
      throw new BadRequestException(
        'Risk percentage must be between 0.5% and 5%',
      );
    }

    if (input.entryPrice <= 0) {
      throw new BadRequestException('Entry price must be positive');
    }

    if (input.stopLoss <= 0) {
      throw new BadRequestException('Stop loss must be positive');
    }

    if (input.entryPrice === input.stopLoss) {
      throw new BadRequestException('Entry price and stop loss cannot be equal');
    }

    if (input.leverage < 1 || input.leverage > 20) {
      throw new BadRequestException('Leverage must be between 1x and 20x');
    }
  }

  /**
   * Round number to specified decimal places
   */
  private round(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}
