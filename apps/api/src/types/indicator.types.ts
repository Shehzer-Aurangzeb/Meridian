export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
}

export interface SupportResistanceResult {
  support: number | null;
  resistance: number | null;
}

export interface IndicatorResults {
  rsi: number;
  bollingerBands: BollingerBandsResult;
  atr: number;
  support: number | null;
  resistance: number | null;
}
