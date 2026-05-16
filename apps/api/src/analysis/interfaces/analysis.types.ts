import { Candle } from '../../common/types/candle.types';
import { IndicatorResults } from '../../indicators/interfaces/indicator.types';

export interface MarketData {
  coin: string;
  timeframe: string;
  currentPrice: number;
  indicators: IndicatorResults;
  candles: Candle[];
}

export type TradeAction = 'LONG' | 'SHORT' | 'WAIT';

export interface TradeAnalysisResult {
  action: TradeAction;
  entryPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  conditionsMet: string[];
}
