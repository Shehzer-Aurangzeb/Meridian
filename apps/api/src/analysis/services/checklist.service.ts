import { Injectable } from '@nestjs/common';
import {
  ChecklistCondition,
  EntryChecklistParams,
  EntryChecklistResult,
  RSI_ENTRY_THRESHOLDS,
  RSI_ZSCORE_CONFIG,
  BB_THRESHOLDS,
  SR_THRESHOLDS,
  PLAYBOOK_MIN_CONDITIONS_MET,
} from '../interfaces/checklist.types';

/**
 * ChecklistService implements Miraj's 5-Point Entry Checklist
 * Dynamic relative thresholds with tiered scoring output
 * Conditions are reported individually as met/unmet. No aggregate score, no tiers.
 */
@Injectable()
export class ChecklistService {
  /**
   * Evaluate all 5 checklist conditions
   */
  evaluateChecklist(params: EntryChecklistParams): EntryChecklistResult {
    const rsi = this.evaluateRSI(params.tradeType, params.rsi, params.rsiHistory);
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
      params.volumeAtNearestLevel,
    );

    const conditions = [rsi, qqe, bollingerBand, marketStructure, supportResistance];
    const conditionsMet = conditions.filter((c) => c.passed).length;

    return {
      rsi,
      qqe,
      bollingerBand,
      marketStructure,
      supportResistance,
      conditionsMet,
      // Playbook 3-of-5, not the tier gate. `WATCHING` ended at 39, so the
      // tier gate passed 2-of-5 setups the playbook does not consider setups.
      passed: conditionsMet >= PLAYBOOK_MIN_CONDITIONS_MET,
      tradeType: params.tradeType,
      conditions,
    };
  }

  /**
   * Calculate mean of an array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate Z-score (how many standard deviations away from the mean).
   *
   * Single helper computes mean + variance in two linear passes instead
   * of recomputing the mean inside a separate `calculateStdDev` call.
   */
  protected calculateZScore(value: number, values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    const mean = sum / n;

    let varianceSum = 0;
    for (let i = 0; i < n; i++) {
      const d = values[i] - mean;
      varianceSum += d * d;
    }
    const stdDev = Math.sqrt(varianceSum / n);

    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }

  /**
   * 1. Momentum. A buy wants price beaten down, a sell wants it stretched.
   * Passes on a fixed level, or on being unusually extreme for this coin's
   * own recent range.
   */
  private evaluateRSI(
    tradeType: 'long' | 'short',
    rsi: number,
    rsiHistory?: number[],
  ): ChecklistCondition {
    const thresholds = tradeType === 'long' 
      ? RSI_ENTRY_THRESHOLDS.LONG 
      : RSI_ENTRY_THRESHOLDS.SHORT;

    let meetsRelativeCriterion = false;
    let zScore: number | null = null;

    // Try to calculate Z-score if history available
    if (rsiHistory && rsiHistory.length >= RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD) {
      const recentHistory = rsiHistory.slice(-RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD);
      zScore = this.calculateZScore(rsi, recentHistory);

      if (tradeType === 'long') {
        meetsRelativeCriterion = zScore <= RSI_ENTRY_THRESHOLDS.LONG.ZSCORE_THRESHOLD;
      } else {
        meetsRelativeCriterion = zScore >= RSI_ENTRY_THRESHOLDS.SHORT.ZSCORE_THRESHOLD;
      }
    }

    // Check strict threshold
    const meetsStrictCriterion = tradeType === 'long'
      ? rsi <= RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX
      : rsi >= RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN;

    const passed = meetsStrictCriterion || meetsRelativeCriterion;

    let reason: string;
    if (passed && meetsRelativeCriterion && zScore !== null) {
      reason = `RSI ${rsi.toFixed(1)} meets Z-score criterion (${zScore.toFixed(2)} std dev ${tradeType === 'long' ? 'below' : 'above'} 100-MA, threshold ${thresholds.ZSCORE_THRESHOLD})`;
    } else if (passed && meetsStrictCriterion) {
      reason = `RSI ${rsi.toFixed(1)} is ${tradeType === 'long' ? `<= ${RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX} (oversold)` : `>= ${RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN} (overbought)`}`;
    } else {
      reason = `RSI ${rsi.toFixed(1)} does not meet relative thresholds for ${tradeType} entry`;
    }

    return {
      name: 'RSI Condition',
      passed,
      value: zScore !== null ? `${rsi.toFixed(1)} (Z: ${zScore.toFixed(2)})` : rsi,
      threshold: tradeType === 'long' 
        ? `<= ${RSI_ENTRY_THRESHOLDS.LONG.STRICT_MAX} OR Z-Score <= ${RSI_ENTRY_THRESHOLDS.LONG.ZSCORE_THRESHOLD}`
        : `>= ${RSI_ENTRY_THRESHOLDS.SHORT.STRICT_MIN} OR Z-Score >= ${RSI_ENTRY_THRESHOLDS.SHORT.ZSCORE_THRESHOLD}`,
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
      value: structure,
      threshold: requiredStructure,
      reason,
    };
  }

  /**
   * 5. Is price at a level that has mattered before? Full pass within 2% of a
   * level touched 3+ times; a partial pass closer in on a level touched twice,
   * if the second touch came with heavy trading.
   */
  private evaluateSupportResistance(
    tradeType: 'long' | 'short',
    currentPrice: number,
    nearestLevel: {
      price: number;
      type: 'support' | 'resistance';
      strength: number;
      volumeAtTouch?: number[];
    } | null,
    volumeAtNearestLevel?: number,
  ): ChecklistCondition {
    if (!nearestLevel) {
      return {
        name: 'Support/Resistance Confluence',
        passed: false,
        value: 'No level found',
        threshold: `${tradeType === 'long' ? 'support' : 'resistance'} within 2% (full) or 1.5% (partial), 3+ tests (full) or 2 tests with vol (partial)`,
        reason: 'No significant support/resistance level identified nearby',
      };
    }

    const requiredType = tradeType === 'long' ? 'support' : 'resistance';
    const distancePercent =
      (Math.abs(currentPrice - nearestLevel.price) / currentPrice) * 100;

    const isCorrectType = nearestLevel.type === requiredType;

    // Check for full credit (20 points)
    const fullCreditProximity = distancePercent <= SR_THRESHOLDS.STRONG_PROXIMITY_PERCENT;
    const fullCreditStrength = nearestLevel.strength >= SR_THRESHOLDS.STRONG_MIN_TESTS;
    const meetsFullCredit = isCorrectType && fullCreditProximity && fullCreditStrength;

    // Check for partial credit (15 points)
    let meetsPartialCredit = false;
    let volumeConfirmed = false;

    if (!meetsFullCredit && isCorrectType) {
      const partialProximity = distancePercent <= SR_THRESHOLDS.PARTIAL_PROXIMITY_PERCENT;
      const exactlyTwoTests = nearestLevel.strength === SR_THRESHOLDS.PARTIAL_MIN_TESTS;

      if (partialProximity && exactlyTwoTests && nearestLevel.volumeAtTouch && volumeAtNearestLevel) {
        const avgVolume = this.calculateMean(nearestLevel.volumeAtTouch);
        volumeConfirmed = volumeAtNearestLevel > avgVolume * SR_THRESHOLDS.PARTIAL_VOLUME_MULTIPLIER;
        meetsPartialCredit = volumeConfirmed;
      }
    }

    // Full and partial credit collapse to met/unmet: the partial tier existed
    // only to feed the removed 0-100 score.
    const passed = meetsFullCredit || meetsPartialCredit;

    let reason: string;
    if (meetsFullCredit) {
      reason = `Price is ${distancePercent.toFixed(2)}% from strong ${requiredType} (${nearestLevel.strength} tests, full credit)`;
    } else if (meetsPartialCredit) {
      reason = `Price is ${distancePercent.toFixed(2)}% from ${requiredType} with volume confirmation (2 tests on elevated volume, partial credit 15 pts)`;
    } else {
      const issues: string[] = [];
      if (!isCorrectType) {
        issues.push(`level is ${nearestLevel.type} (need ${requiredType})`);
      }
      if (!fullCreditProximity && !meetsPartialCredit) {
        issues.push(`${distancePercent.toFixed(2)}% away`);
      }
      if (!fullCreditStrength && nearestLevel.strength !== SR_THRESHOLDS.PARTIAL_MIN_TESTS) {
        issues.push(`${nearestLevel.strength} tests`);
      }
      reason = `Level not ideal: ${issues.join(', ')}`;
    }

    return {
      name: 'Support/Resistance Confluence',
      passed,
      value: nearestLevel
        ? `${nearestLevel.type} at ${nearestLevel.price.toFixed(2)} (${nearestLevel.strength} tests)`
        : 'None',
      threshold: `${requiredType} within 2% (3+ tests) or 1.5% (2 tests + volume)`,
      reason,
    };
  }

  /**
   * The checklist in words. States which conditions are met and the value that
   * decided each. No overall score — see the note in checklist.types.ts.
   */
  getSummary(result: EntryChecklistResult): string {
    const conditionLines = result.conditions
      .map((c) => `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.reason}`)
      .join('\n');

    return `
Entry Checklist — ${result.conditionsMet}/5 conditions met (needs ${PLAYBOOK_MIN_CONDITIONS_MET})
Direction: ${result.tradeType.toUpperCase()}

Conditions:
${conditionLines}
    `.trim();
  }
}
