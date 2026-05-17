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

/**
 * Key price level with strength metric
 */
export interface KeyLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // Number of tests/touches
  distance: number; // Distance from current price as percentage
}

export interface IndicatorResults {
  rsi: number;
  bollingerBands: BollingerBandsResult;
  atr: number;
  support: number | null;
  resistance: number | null;
}

/**
 * Extended indicator results including QQE and band width
 */
export interface ExtendedIndicatorResults extends IndicatorResults {
  qqe: QQEResult;
  bandWidth: number; // Bollinger band width as percentage
  keyLevels: KeyLevel[];
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
