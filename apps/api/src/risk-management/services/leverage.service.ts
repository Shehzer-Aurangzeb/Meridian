import { Injectable } from '@nestjs/common';
import {
  LeverageInput,
  LeverageRecommendation,
  ExperienceLevel,
  TradeStyle,
  LeverageConstraints,
} from '../interfaces/leverage.types';

@Injectable()
export class LeverageService {
  
  // Experience-based leverage caps (Miraj's guidelines)
  private readonly EXPERIENCE_CAPS: Record<ExperienceLevel, number> = {
    beginner: 3,
    intermediate: 5,
    advanced: 10,
    expert: 20,
  };
  
  // Timeframe-based base leverage (Miraj's guidelines)
  private readonly TIMEFRAME_BASE_LEVERAGE: Record<string, number> = {
    '1w': 2,
    '1d': 2,
    '12h': 3,
    '4h': 5,
    '1h': 7,
    '15m': 10,
    '5m': 12,
    '1m': 15,
  };
  
  /**
   * Main method: Calculate optimal leverage for a trade
   * Considers timeframe, experience, confidence, volatility, and market conditions
   */
  recommendLeverage(input: LeverageInput): LeverageRecommendation {
    // 1. Determine base leverage from timeframe
    let baseLeverage = this.getBaseLeverageFromTimeframe(input.timeframe);
    const originalBase = baseLeverage;
    
    // 2. Apply experience level cap
    const experienceCap = this.EXPERIENCE_CAPS[input.experienceLevel];
    baseLeverage = Math.min(baseLeverage, experienceCap);
    
    // 3. Adjust for checklist confidence
    baseLeverage = this.adjustForConfidence(baseLeverage, input.checklistScore);
    
    // 4. Adjust for volatility
    baseLeverage = this.adjustForVolatility(
      baseLeverage,
      input.atr,
      input.currentPrice,
    );
    
    // 5. Adjust for stop loss distance (ensure liquidation is beyond stop)
    baseLeverage = this.adjustForStopLoss(
      baseLeverage,
      input.stopLossPercentage,
    );
    
    // 6. Adjust for market conditions
    if (input.marketCycle) {
      baseLeverage = this.adjustForMarketCycle(baseLeverage, input.marketCycle);
    }
    
    // 7. Apply risk tolerance modifier
    const riskTolerance = input.riskTolerance || 'moderate';
    const recommended = this.applyRiskTolerance(baseLeverage, riskTolerance);
    
    // 8. Ensure minimum leverage of 1
    const finalRecommended = Math.max(1, Math.round(recommended));
    
    // 9. Calculate alternative options
    const conservative = Math.max(1, Math.floor(finalRecommended * 0.6));
    const aggressive = Math.min(experienceCap, Math.ceil(finalRecommended * 1.4));
    
    // 10. Determine trade style
    const tradeStyle = input.tradeStyle || this.inferTradeStyle(input.timeframe);
    
    // 11. Calculate risk metrics
    const liquidationPrice = this.calculateLiquidationPrice(
      input.currentPrice,
      finalRecommended,
      'long', // Default to long - in real usage, infer from context
    );
    
    const liquidationDistance = ((input.currentPrice - liquidationPrice) / input.currentPrice) * 100;
    
    // 12. Build reasoning
    const { reasoning, adjustments } = this.buildReasoning(
      input,
      originalBase,
      finalRecommended,
      experienceCap,
    );
    
    // 13. Generate warnings
    const warnings = this.generateWarnings(
      finalRecommended,
      input.stopLossPercentage,
      liquidationDistance,
      input.experienceLevel,
    );
    
    // 14. Determine risk level
    const riskLevel = this.determineRiskLevel(finalRecommended, tradeStyle);
    
    return {
      recommended: finalRecommended,
      conservative,
      moderate: finalRecommended,
      aggressive,
      reasoning,
      adjustments,
      liquidationPrice,
      liquidationDistance: `${liquidationDistance.toFixed(1)}% below entry`,
      maxDrawdown: `${(100 / finalRecommended).toFixed(1)}%`,
      warnings,
      tradeStyle,
      riskLevel,
    };
  }
  
  /**
   * Get base leverage from timeframe.
   *
   * Throws on an unrecognised timeframe. This previously fell back to `|| 5`,
   * so an unknown timeframe silently received 5x leverage — a risk control
   * granting leverage on input it does not understand.
   *
   * A "conservative" fallback of 1x would be no better: it is still a
   * made-up number presented as an answer. If leverage cannot be determined
   * the system must refuse to produce a plan, because a plausible number is
   * exactly how this repo's earlier indicator bugs survived for months.
   */
  private getBaseLeverageFromTimeframe(timeframe: string): number {
    const base = this.TIMEFRAME_BASE_LEVERAGE[timeframe];
    if (base === undefined) {
      throw new Error(
        `Cannot determine leverage for unrecognised timeframe "${timeframe}". ` +
          `Known timeframes: ${Object.keys(this.TIMEFRAME_BASE_LEVERAGE).join(', ')}`,
      );
    }
    return base;
  }
  
  /**
   * Adjust leverage based on checklist confidence score
   * Low confidence (< 80) = reduce leverage
   */
  private adjustForConfidence(
    baseLeverage: number,
    checklistScore: number,
  ): number {
    if (checklistScore >= 80) {
      return baseLeverage; // Strong setup, no reduction
    } else if (checklistScore >= 60) {
      return baseLeverage * 0.8; // Reduce by 20%
    } else {
      return baseLeverage * 0.5; // Reduce by 50% for weak setup
    }
  }
  
  /**
   * Adjust leverage based on volatility (ATR)
   * High volatility = lower leverage (safer)
   */
  private adjustForVolatility(
    baseLeverage: number,
    atr: number,
    currentPrice: number,
  ): number {
    // Calculate ATR as percentage of price
    const atrPercentage = (atr / currentPrice) * 100;
    
    // Low volatility (< 2%): no adjustment
    if (atrPercentage < 2) {
      return baseLeverage;
    }
    
    // Medium volatility (2-4%): reduce by 20%
    if (atrPercentage < 4) {
      return baseLeverage * 0.8;
    }
    
    // High volatility (4-6%): reduce by 40%
    if (atrPercentage < 6) {
      return baseLeverage * 0.6;
    }
    
    // Extreme volatility (> 6%): reduce by 50%
    return baseLeverage * 0.5;
  }
  
  /**
   * Adjust leverage based on stop loss distance
   * Stop should be at most 50% of liquidation distance
   * This ensures liquidation is always beyond stop loss
   */
  private adjustForStopLoss(
    baseLeverage: number,
    stopLossPercentage: number,
  ): number {
    // Max safe leverage = 100 / (stopLoss% * 2)
    // This ensures liquidation is 2x further than stop loss
    const maxSafeLeverage = 100 / (stopLossPercentage * 2);
    
    return Math.min(baseLeverage, maxSafeLeverage);
  }
  
  /**
   * Adjust for market cycle
   * Bear market = more conservative
   */
  private adjustForMarketCycle(
    baseLeverage: number,
    cycle: 'bull' | 'bear' | 'ranging',
  ): number {
    if (cycle === 'bear') {
      return baseLeverage * 0.7; // Reduce by 30% in bear
    } else if (cycle === 'ranging') {
      return baseLeverage * 0.85; // Reduce by 15% in ranging
    }
    return baseLeverage; // No change in bull
  }
  
  /**
   * Apply risk tolerance modifier
   */
  private applyRiskTolerance(
    baseLeverage: number,
    tolerance: 'conservative' | 'moderate' | 'aggressive',
  ): number {
    if (tolerance === 'conservative') {
      return baseLeverage * 0.7;
    } else if (tolerance === 'aggressive') {
      return baseLeverage * 1.3;
    }
    return baseLeverage; // Moderate = no change
  }
  
  /**
   * Infer trade style from timeframe
   */
  private inferTradeStyle(timeframe: string): TradeStyle {
    if (timeframe === '1w' || timeframe === '1d') {
      return 'swing';
    } else if (timeframe === '12h' || timeframe === '4h' || timeframe === '1h') {
      return 'day';
    } else if (timeframe === '15m' || timeframe === '5m') {
      return 'scalp';
    } else {
      return 'ultra-scalp';
    }
  }
  
  /**
   * Calculate liquidation price
   * Liquidation distance = entry price / leverage
   */
  private calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: 'long' | 'short',
  ): number {
    const liquidationPercentage = 100 / leverage;
    
    if (direction === 'long') {
      return entryPrice * (1 - liquidationPercentage / 100);
    } else {
      return entryPrice * (1 + liquidationPercentage / 100);
    }
  }
  
  /**
   * Build reasoning explanation
   */
  private buildReasoning(
    input: LeverageInput,
    originalBase: number,
    finalLeverage: number,
    experienceCap: number,
  ): { reasoning: string; adjustments: string[] } {
    const adjustments: string[] = [];
    
    // Base leverage
    const tradeStyle = this.inferTradeStyle(input.timeframe);
    let reasoning = `Base ${originalBase}x for ${input.timeframe} ${tradeStyle} trades`;
    
    // Experience cap
    if (originalBase > experienceCap) {
      adjustments.push(`Capped at ${experienceCap}x for ${input.experienceLevel} level`);
    }
    
    // Confidence adjustment
    if (input.checklistScore < 80) {
      const reduction = input.checklistScore >= 60 ? '20%' : '50%';
      adjustments.push(`Reduced ${reduction} due to checklist score ${input.checklistScore}/100`);
    }
    
    // Volatility adjustment
    const atrPercentage = (input.atr / input.currentPrice) * 100;
    if (atrPercentage >= 2) {
      adjustments.push(`Adjusted for ${atrPercentage.toFixed(1)}% volatility (ATR)`);
    }
    
    // Stop loss adjustment
    const maxSafeLeverage = 100 / (input.stopLossPercentage * 2);
    if (maxSafeLeverage < originalBase) {
      adjustments.push(`Limited by ${input.stopLossPercentage}% stop loss distance`);
    }
    
    // Market cycle
    if (input.marketCycle === 'bear') {
      adjustments.push('Reduced 30% for bear market conditions');
    } else if (input.marketCycle === 'ranging') {
      adjustments.push('Reduced 15% for ranging market conditions');
    }
    
    // Risk tolerance
    if (input.riskTolerance === 'conservative') {
      adjustments.push('Reduced 30% for conservative risk tolerance');
    } else if (input.riskTolerance === 'aggressive') {
      adjustments.push('Increased 30% for aggressive risk tolerance');
    }
    
    if (adjustments.length > 0) {
      reasoning += `. ${adjustments.join('. ')}.`;
    }
    
    return { reasoning, adjustments };
  }
  
  /**
   * Generate warnings based on leverage level
   */
  private generateWarnings(
    leverage: number,
    stopLossPercentage: number,
    liquidationDistance: number,
    experienceLevel: ExperienceLevel,
  ): string[] {
    const warnings: string[] = [];
    
    // High leverage warnings
    if (leverage >= 10) {
      warnings.push('High leverage (10x+): Small moves can cause significant losses');
    }
    
    if (leverage >= 15) {
      warnings.push('Very high leverage (15x+): Recommended only for experienced scalpers');
    }
    
    // Liquidation proximity
    const buffer = liquidationDistance - stopLossPercentage;
    if (buffer < 5) {
      warnings.push(`Liquidation only ${buffer.toFixed(1)}% beyond stop loss - very tight risk`);
    }
    
    // Experience mismatch
    if (experienceLevel === 'beginner' && leverage > 3) {
      warnings.push('This leverage may be high for beginner level - consider reducing');
    }
    
    if (experienceLevel === 'intermediate' && leverage > 5) {
      warnings.push('This leverage is at the upper end for intermediate level');
    }
    
    return warnings;
  }
  
  /**
   * Determine risk level based on leverage and trade style
   */
  private determineRiskLevel(
    leverage: number,
    _tradeStyle: TradeStyle,
  ): 'low' | 'medium' | 'high' | 'very-high' {
    if (leverage <= 3) return 'low';
    if (leverage <= 5) return 'medium';
    if (leverage <= 10) return 'high';
    return 'very-high';
  }
  
  /**
   * Get leverage constraints based on experience and timeframe
   */
  getLeverageConstraints(
    experienceLevel: ExperienceLevel,
    timeframe: string,
  ): LeverageConstraints {
    const cap = this.EXPERIENCE_CAPS[experienceLevel];
    const base = this.getBaseLeverageFromTimeframe(timeframe);
    
    return {
      min: 1,
      max: Math.min(cap, base * 2),
      reason: `${experienceLevel} traders on ${timeframe} timeframe`,
    };
  }
}
