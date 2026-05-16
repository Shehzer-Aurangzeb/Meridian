import { Injectable } from '@nestjs/common';
import {
  ChecklistCondition,
  EntryChecklistParams,
  EntryChecklistResult,
  RSI_ENTRY_THRESHOLDS,
  BB_THRESHOLDS,
  SR_THRESHOLDS,
} from '../types/checklist.types';

/**
 * ChecklistService implements Miraj's 5-Point Entry Checklist
 * Each condition scores 0 or 20 points, total 100 max
 * Minimum 60 points (3/5 conditions) required for trade signal
 */
@Injectable()
export class ChecklistService {
  /**
   * Evaluate all 5 checklist conditions
   */
  evaluateChecklist(params: EntryChecklistParams): EntryChecklistResult {
    const rsi = this.evaluateRSI(params.tradeType, params.rsi);
    const qqe = this.evaluateQQE(
      params.tradeType,
      params.qqeColor,
      params.previousQQEColor,
    );
    const bollingerBand = this.evaluateBollingerBand(
      params.tradeType,
      params.currentPrice,
      params.bollingerBands,
      params.bandWidth,
    );
    const marketStructure = this.evaluateMarketStructure(
      params.tradeType,
      params.marketStructure,
    );
    const supportResistance = this.evaluateSupportResistance(
      params.tradeType,
      params.currentPrice,
      params.nearestLevel,
    );

    const conditions = [rsi, qqe, bollingerBand, marketStructure, supportResistance];
    const totalScore = conditions.reduce((sum, c) => sum + c.score, 0);
    const conditionsMet = conditions.filter((c) => c.passed).length;

    return {
      rsi,
      qqe,
      bollingerBand,
      marketStructure,
      supportResistance,
      totalScore,
      conditionsMet,
      passed: totalScore >= 60,
      tradeType: params.tradeType,
      conditions,
    };
  }

  /**
   * 1. RSI Condition (20 points)
   * Long: RSI between 15-35 (best 15-20)
   * Short: RSI between 65-85 (best 80-95)
   */
  private evaluateRSI(tradeType: 'long' | 'short', rsi: number): ChecklistCondition {
    const thresholds = tradeType === 'long' 
      ? RSI_ENTRY_THRESHOLDS.LONG 
      : RSI_ENTRY_THRESHOLDS.SHORT;

    const inRange = rsi >= thresholds.MIN && rsi <= thresholds.MAX;
    const inExtremeRange =
      rsi >= thresholds.EXTREME_MIN && rsi <= thresholds.EXTREME_MAX;

    let reason: string;
    if (inExtremeRange) {
      reason = `RSI at ${rsi.toFixed(1)} is in extreme ${tradeType === 'long' ? 'oversold' : 'overbought'} zone (ideal entry)`;
    } else if (inRange) {
      reason = `RSI at ${rsi.toFixed(1)} is in ${tradeType === 'long' ? 'oversold' : 'overbought'} zone`;
    } else {
      const zone = tradeType === 'long' ? 'oversold (15-35)' : 'overbought (65-85)';
      reason = `RSI at ${rsi.toFixed(1)} is NOT in ${zone} zone`;
    }

    return {
      name: 'RSI Condition',
      passed: inRange,
      score: inRange ? 20 : 0,
      value: rsi,
      threshold: tradeType === 'long' ? '15-35 (best 15-20)' : '65-85 (best 80-95)',
      reason,
    };
  }

  /**
   * 2. QQE Volume Bars (20 points)
   * Long: Green bars (buying pressure)
   * Short: Red bars (selling pressure)
   * Bonus: transition from opposite color
   */
  private evaluateQQE(
    tradeType: 'long' | 'short',
    qqeColor: 'green' | 'red' | 'neutral',
    previousQQEColor?: 'green' | 'red' | 'neutral',
  ): ChecklistCondition {
    const requiredColor = tradeType === 'long' ? 'green' : 'red';
    const oppositeColor = tradeType === 'long' ? 'red' : 'green';

    const passed = qqeColor === requiredColor;
    const hasTransition = previousQQEColor === oppositeColor && qqeColor === requiredColor;

    let reason: string;
    if (passed && hasTransition) {
      reason = `QQE bars transitioned from ${oppositeColor} to ${requiredColor} (strong signal)`;
    } else if (passed) {
      reason = `QQE bars are ${requiredColor} (${tradeType === 'long' ? 'buying' : 'selling'} pressure)`;
    } else {
      reason = `QQE bars are ${qqeColor}, need ${requiredColor} for ${tradeType}`;
    }

    return {
      name: 'QQE Volume Bars',
      passed,
      score: passed ? 20 : 0,
      value: qqeColor,
      threshold: tradeType === 'long' ? 'green (buying pressure)' : 'red (selling pressure)',
      reason,
    };
  }

  /**
   * 3. Bollinger Band Extreme (20 points)
   * Long: Price within 10% of lower band
   * Short: Price within 10% of upper band
   * Bands must be EXPANDED (width > 2%)
   */
  private evaluateBollingerBand(
    tradeType: 'long' | 'short',
    currentPrice: number,
    bands: { upper: number; middle: number; lower: number },
    bandWidth: number,
  ): ChecklistCondition {
    const totalRange = bands.upper - bands.lower;

    // Check if bands are squeezed (avoid trading)
    const isSqueezed = bandWidth < BB_THRESHOLDS.MIN_BAND_WIDTH;

    if (isSqueezed) {
      return {
        name: 'Bollinger Band Extreme',
        passed: false,
        score: 0,
        value: `${bandWidth.toFixed(2)}% width`,
        threshold: `> ${BB_THRESHOLDS.MIN_BAND_WIDTH}% band width (expanded)`,
        reason: `Bollinger Bands are SQUEEZED (${bandWidth.toFixed(2)}% width). Avoid trading - big move coming but direction unclear`,
      };
    }

    // Calculate proximity to bands
    let proximityPercent: number;
    let nearTarget: boolean;
    let targetBand: string;

    if (tradeType === 'long') {
      // Distance from lower band as % of total range
      const distanceFromLower = currentPrice - bands.lower;
      proximityPercent = (distanceFromLower / totalRange) * 100;
      nearTarget = proximityPercent <= BB_THRESHOLDS.PROXIMITY_PERCENT;
      targetBand = 'lower';
    } else {
      // Distance from upper band as % of total range
      const distanceFromUpper = bands.upper - currentPrice;
      proximityPercent = (distanceFromUpper / totalRange) * 100;
      nearTarget = proximityPercent <= BB_THRESHOLDS.PROXIMITY_PERCENT;
      targetBand = 'upper';
    }

    let reason: string;
    if (nearTarget) {
      reason = `Price is ${proximityPercent.toFixed(1)}% from ${targetBand} band (within ${BB_THRESHOLDS.PROXIMITY_PERCENT}% threshold)`;
    } else {
      reason = `Price is ${proximityPercent.toFixed(1)}% from ${targetBand} band (need < ${BB_THRESHOLDS.PROXIMITY_PERCENT}%)`;
    }

    return {
      name: 'Bollinger Band Extreme',
      passed: nearTarget,
      score: nearTarget ? 20 : 0,
      value: `${proximityPercent.toFixed(1)}% from ${targetBand}`,
      threshold: `< ${BB_THRESHOLDS.PROXIMITY_PERCENT}% from ${targetBand} band, bands expanded`,
      reason,
    };
  }

  /**
   * 4. Market Structure - HTF (20 points)
   * Long: HH/HL pattern on daily/12h
   * Short: LH/LL pattern on daily/12h
   */
  private evaluateMarketStructure(
    tradeType: 'long' | 'short',
    structure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown',
  ): ChecklistCondition {
    const requiredStructure = tradeType === 'long' ? 'HH/HL' : 'LH/LL';
    const passed = structure === requiredStructure;

    let reason: string;
    if (passed) {
      reason = `Market structure is ${structure} (aligned with ${tradeType} bias)`;
    } else if (structure === 'ranging' || structure === 'unknown') {
      reason = `Market structure is ${structure} (no clear trend for ${tradeType})`;
    } else {
      reason = `Market structure is ${structure} (conflicting with ${tradeType} - need ${requiredStructure})`;
    }

    return {
      name: 'Market Structure (HTF)',
      passed,
      score: passed ? 20 : 0,
      value: structure,
      threshold: requiredStructure,
      reason,
    };
  }

  /**
   * 5. Support/Resistance Confluence (20 points)
   * Long: Price at major support (within 2%)
   * Short: Price at major resistance (within 2%)
   * Level must have 3+ tests (strong level)
   */
  private evaluateSupportResistance(
    tradeType: 'long' | 'short',
    currentPrice: number,
    nearestLevel: {
      price: number;
      type: 'support' | 'resistance';
      strength: number;
    } | null,
  ): ChecklistCondition {
    if (!nearestLevel) {
      return {
        name: 'Support/Resistance Confluence',
        passed: false,
        score: 0,
        value: 'No level found',
        threshold: `${tradeType === 'long' ? 'support' : 'resistance'} within ${SR_THRESHOLDS.PROXIMITY_PERCENT}%, ${SR_THRESHOLDS.MIN_TESTS}+ tests`,
        reason: 'No significant support/resistance level identified nearby',
      };
    }

    const requiredType = tradeType === 'long' ? 'support' : 'resistance';
    const distancePercent =
      (Math.abs(currentPrice - nearestLevel.price) / currentPrice) * 100;

    const isCorrectType = nearestLevel.type === requiredType;
    const isNearby = distancePercent <= SR_THRESHOLDS.PROXIMITY_PERCENT;
    const isStrong = nearestLevel.strength >= SR_THRESHOLDS.MIN_TESTS;

    const passed = isCorrectType && isNearby && isStrong;

    let reason: string;
    if (passed) {
      reason = `Price is ${distancePercent.toFixed(2)}% from strong ${nearestLevel.type} (${nearestLevel.strength} tests)`;
    } else {
      const issues: string[] = [];
      if (!isCorrectType) {
        issues.push(`level is ${nearestLevel.type} (need ${requiredType})`);
      }
      if (!isNearby) {
        issues.push(`${distancePercent.toFixed(2)}% away (need < ${SR_THRESHOLDS.PROXIMITY_PERCENT}%)`);
      }
      if (!isStrong) {
        issues.push(`only ${nearestLevel.strength} tests (need ${SR_THRESHOLDS.MIN_TESTS}+)`);
      }
      reason = `Level not ideal: ${issues.join(', ')}`;
    }

    return {
      name: 'Support/Resistance Confluence',
      passed,
      score: passed ? 20 : 0,
      value: nearestLevel
        ? `${nearestLevel.type} at ${nearestLevel.price.toFixed(2)} (${nearestLevel.strength} tests)`
        : 'None',
      threshold: `${requiredType} within ${SR_THRESHOLDS.PROXIMITY_PERCENT}%, ${SR_THRESHOLDS.MIN_TESTS}+ tests`,
      reason,
    };
  }

  /**
   * Get a human-readable summary of the checklist
   */
  getSummary(result: EntryChecklistResult): string {
    const status = result.passed ? '✅ PASSED' : '❌ NOT PASSED';
    const action = result.passed ? result.tradeType.toUpperCase() : 'WAIT';

    const conditionLines = result.conditions
      .map((c) => `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.reason}`)
      .join('\n');

    return `
5-Point Entry Checklist: ${status}
Trade Type: ${result.tradeType.toUpperCase()}
Score: ${result.totalScore}/100 (${result.conditionsMet}/5 conditions met)
Recommended Action: ${action}

Conditions:
${conditionLines}
    `.trim();
  }
}
