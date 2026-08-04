import { BollingerBandsResult } from '../../indicators/interfaces/indicator.types';

/**
 * Market regime classification used as the strategy "Master Switch".
 *
 *  - COMPRESSION    : Volatility squeeze (Bollinger Band width compressed)
 *  - TRENDING       : Strong directional move (ADX > 25)
 *  - MEAN_REVERSION : Ranging / non-trending market
 */
export type MarketRegime = 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';

export interface MarketRegimeMetrics {
  adx: number;
  pdi: number;
  mdi: number;
  rsi: number;
  atr: number;
  bandWidth: number;
  bandWidthPercentile: number | null; // null if historical data not ready
  bandWidthThreshold: number; // 15th-percentile cutoff used (or 1.5 fallback)
  // The window the percentile and cutoff were measured over. Surfaced so a
  // COMPRESSION verdict always states what it was measured against — the
  // percentile used to depend on however many samples the fetch happened to
  // produce, which made the verdict move with the candle limit.
  bandWidthLookback: number; // declared lookback (samples requested)
  bandWidthSamples: number; // samples actually used
  bollingerBands: BollingerBandsResult;
}

export interface MarketRegimeResult {
  symbol: string;
  timeframe: string;
  regime: MarketRegime;
  reason: string;
  metrics: MarketRegimeMetrics;
}
