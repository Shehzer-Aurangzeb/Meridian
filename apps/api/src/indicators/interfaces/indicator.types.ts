export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
}

export interface SupportResistanceResult {
  support: number | null;
  resistance: number | null;
}

/**
 * QQE (Quantitative Qualitative Estimation) Result
 * Green = bullish momentum (buying pressure)
 * Red = bearish momentum (selling pressure)
 * Neutral = no clear direction
 */
export interface QQEResult {
  color: 'green' | 'red' | 'neutral';
  value: number; // Smoothed RSI value
  previousColor: 'green' | 'red' | 'neutral';
  trend: 'rising' | 'falling' | 'flat';
}

export interface IndicatorResults {
  rsi: number;
  bollingerBands: BollingerBandsResult;
  atr: number;
  support: number | null;
  resistance: number | null;
}

/**
 * ADX (Average Directional Index) result
 * adx  - Trend strength (0-100). >25 indicates a trending market.
 * pdi  - Positive Directional Indicator (+DI)
 * mdi  - Negative Directional Indicator (-DI)
 * dx   - Directional Index (latest, pre-smoothed)
 */
export interface ADXResult {
  adx: number;
  pdi: number;
  mdi: number;
  dx: number;
}
