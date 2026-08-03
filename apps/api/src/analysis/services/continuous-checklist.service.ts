import { Injectable } from '@nestjs/common';
import {
  BB_THRESHOLDS,
  ChecklistCondition,
  EntryChecklistParams,
  EntryChecklistResult,
  RSI_ZSCORE_CONFIG,
} from '../interfaces/checklist.types';
import { ChecklistService } from './checklist.service';

/**
 * ContinuousChecklistService
 *
 * Drop-in replacement for `ChecklistService` that scores each of the same
 * five conditions on a sliding 0–20 scale instead of all-or-nothing 20.
 *
 * ─── Why ─────────────────────────────────────────────────────────────────
 * The binary checklist has almost no resolution: measured over 750 bars,
 * 89.6% of readings were exactly 20 or exactly 40, APEX_SETUP never fired
 * once in 3,000 candles, and expectancy across 482 trades was −0.090R.
 * A 0–100 confidence rating that only takes six values cannot rank setups.
 *
 * ─── What changed, and what deliberately did NOT ─────────────────────────
 * Same five conditions, same inputs, same output type. ONLY the scoring
 * function differs — so an A/B against `ChecklistService` isolates
 * "does resolution help?" without confounding it with new indicators.
 * Adding OBV/EMA/volume dimensions is a separate experiment, run later.
 *
 * Two hard cliffs are deliberately softened, because both were measured
 * as load-bearing (see STATE_OF_PLAY findings D and E):
 *   - Bollinger width: the flat 2% "expanded" gate becomes a linear ramp,
 *     so 1.9% width scores 95% of credit rather than zero.
 *   - S/R strength: touch count ramps 0→1 across 4 touches instead of
 *     stepping at exactly 2 and 3.
 */
@Injectable()
export class ContinuousChecklistService extends ChecklistService {
  /** Each condition contributes up to this many points. */
  private static readonly MAX_PER_CONDITION = 20;

  /** A condition counts toward `conditionsMet` at half credit or better. */
  private static readonly MET_THRESHOLD = 0.5;

  override evaluateChecklist(params: EntryChecklistParams): EntryChecklistResult {
    const long = params.tradeType === 'long';

    const rsi = this.scoreRSI(long, params.rsi, params.rsiHistory);
    const qqe = this.scoreQQE(long, params.qqeColor);
    const bollingerBand = this.scoreBollinger(
      long,
      params.currentPrice,
      params.bollingerBands,
      params.bandWidth,
    );
    const marketStructure = this.scoreStructure(long, params.marketStructure);
    const supportResistance = this.scoreSupportResistance(
      long,
      params.currentPrice,
      params.nearestLevel,
    );

    const conditions = [rsi, qqe, bollingerBand, marketStructure, supportResistance];
    const totalScore = conditions.reduce((sum, c) => sum + c.score, 0);

    return {
      rsi,
      qqe,
      bollingerBand,
      marketStructure,
      supportResistance,
      totalScore,
      conditionsMet: conditions.filter((c) => c.passed).length,
      status: this.determineStatus(totalScore),
      passed: this.determineStatus(totalScore) !== 'WATCHING',
      tradeType: params.tradeType,
      conditions,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
  }

  /** Turn a 0–1 strength into a scored condition. */
  private condition(
    name: string,
    strength: number,
    value: string,
    threshold: string,
    reason: string,
  ): ChecklistCondition {
    const s = this.clamp01(strength);
    return {
      name,
      passed: s >= ContinuousChecklistService.MET_THRESHOLD,
      score: Number((s * ContinuousChecklistService.MAX_PER_CONDITION).toFixed(2)),
      value,
      threshold,
      reason,
    };
  }

  /**
   * 1. RSI — ramps instead of a 40/60 cliff.
   *
   * LONG:  full credit at RSI ≤ 20, zero at ≥ 60.
   * Z-score path: full credit at z ≤ −2.5, zero at z ≥ 0.
   * The two paths are OR'd (max), matching the binary version's semantics.
   */
  private scoreRSI(
    long: boolean,
    rsi: number,
    rsiHistory?: number[],
  ): ChecklistCondition {
    const strict = long
      ? this.clamp01((60 - rsi) / 40)
      : this.clamp01((rsi - 40) / 40);

    let zScore: number | null = null;
    let relative = 0;

    if (rsiHistory && rsiHistory.length >= RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD) {
      zScore = this.calculateZScore(
        rsi,
        rsiHistory.slice(-RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD),
      );
      relative = long
        ? this.clamp01(-zScore / 2.5)
        : this.clamp01(zScore / 2.5);
    }

    const strength = Math.max(strict, relative);
    const zText = zScore !== null ? ` (Z: ${zScore.toFixed(2)})` : '';

    return this.condition(
      'RSI Condition',
      strength,
      `${rsi.toFixed(1)}${zText}`,
      long ? 'ramp: RSI 60→20' : 'ramp: RSI 40→80',
      `RSI ${rsi.toFixed(1)}${zText} → ${(strength * 100).toFixed(0)}% of credit`,
    );
  }

  /**
   * 2. QQE — three levels rather than two. Colour is inherently categorical,
   * so this is the one condition that stays coarse.
   */
  private scoreQQE(
    long: boolean,
    color: 'green' | 'red' | 'neutral',
  ): ChecklistCondition {
    const wanted = long ? 'green' : 'red';
    const strength = color === wanted ? 1 : color === 'neutral' ? 0.35 : 0;

    return this.condition(
      'QQE Volume Bars',
      strength,
      color,
      `${wanted} preferred, neutral partial`,
      `QQE is ${color} → ${(strength * 100).toFixed(0)}% of credit`,
    );
  }

  /**
   * 3. Bollinger — position within the band times a width ramp.
   *
   * Position: full credit at/beyond the target band, zero at the midline.
   * Width: linear ramp to the 2% floor instead of a hard gate, so a 1.9%
   * bandwidth no longer scores zero (finding E).
   */
  private scoreBollinger(
    long: boolean,
    price: number,
    bands: { upper: number; middle: number; lower: number },
    bandWidth: number,
  ): ChecklistCondition {
    const range = bands.upper - bands.lower;
    if (range <= 0) {
      return this.condition('Bollinger Band Extreme', 0, 'degenerate bands', '—', 'Band range is zero');
    }

    const position = (price - bands.lower) / range; // 0 = lower, 1 = upper
    const proximity = long
      ? this.clamp01((0.5 - position) / 0.5)
      : this.clamp01((position - 0.5) / 0.5);

    const widthFactor = this.clamp01(bandWidth / BB_THRESHOLDS.MIN_BAND_WIDTH);
    const strength = proximity * widthFactor;

    return this.condition(
      'Bollinger Band Extreme',
      strength,
      `${(position * 100).toFixed(1)}% of band, ${bandWidth.toFixed(2)}% wide`,
      `near ${long ? 'lower' : 'upper'} band, width ramps to ${BB_THRESHOLDS.MIN_BAND_WIDTH}%`,
      `position ${(proximity * 100).toFixed(0)}% × width ${(widthFactor * 100).toFixed(0)}% ` +
        `→ ${(strength * 100).toFixed(0)}% of credit`,
    );
  }

  /** 4. Market structure — four levels; still categorical input. */
  private scoreStructure(
    long: boolean,
    structure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown',
  ): ChecklistCondition {
    const aligned = long ? 'HH/HL' : 'LH/LL';
    const opposed = long ? 'LH/LL' : 'HH/HL';

    const strength =
      structure === aligned
        ? 1
        : structure === 'ranging'
          ? 0.3
          : structure === opposed
            ? 0
            : 0.2; // unknown

    return this.condition(
      'Market Structure (HTF)',
      strength,
      structure,
      `${aligned} preferred`,
      `Structure ${structure} → ${(strength * 100).toFixed(0)}% of credit`,
    );
  }

  /**
   * 5. Support/Resistance — distance decay × touch-count ramp × side.
   *
   * Replaces the 20/15/0 tiering. A level on the wrong side of the trade
   * still scores a little, since "price is at a level" carries information
   * either way, but it is heavily discounted.
   */
  private scoreSupportResistance(
    long: boolean,
    price: number,
    level: EntryChecklistParams['nearestLevel'],
  ): ChecklistCondition {
    if (!level || price <= 0) {
      return this.condition(
        'Support/Resistance Confluence',
        0,
        'none nearby',
        'within ~3% of a tested level',
        'No level within range',
      );
    }

    const distancePct = (Math.abs(price - level.price) / price) * 100;
    const distance = this.clamp01(1 - distancePct / 3);
    const touches = this.clamp01(level.strength / 4);
    const wantedType = long ? 'support' : 'resistance';
    const side = level.type === wantedType ? 1 : 0.25;

    const strength = distance * touches * side;

    return this.condition(
      'Support/Resistance Confluence',
      strength,
      `${level.type} @ ${level.price.toFixed(2)} (${level.strength} tests, ${distancePct.toFixed(2)}% away)`,
      `${wantedType} within ~3%, 4+ tests`,
      `distance ${(distance * 100).toFixed(0)}% × tests ${(touches * 100).toFixed(0)}% × side ${side} ` +
        `→ ${(strength * 100).toFixed(0)}% of credit`,
    );
  }
}
