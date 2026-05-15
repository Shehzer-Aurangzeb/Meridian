export interface AnalysisData {
  id: string;
  coin: string;
  action: 'LONG' | 'SHORT' | 'WAIT';
  entryPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  conditionsMet: string[];
  indicators: {
    rsi: number;
    bb: {
      upper: number;
      middle: number;
      lower: number;
    };
    atr: number;
    support: number | null;
    resistance: number | null;
  };
  currentPrice: number;
  timeframe: string;
  timestamp: Date;
}

export interface AnalysisResponse {
  success: boolean;
  data?: AnalysisData;
  error?: string;
}
