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
  bollingerBands: BollingerBandsResult;
}

export interface MarketRegimeResult {
  symbol: string;
  timeframe: string;
  regime: MarketRegime;
  reason: string;
  metrics: MarketRegimeMetrics;
}
