export interface AnalysisData {
  id: string;
  coin: string;
  action: string;
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

export class AnalyzeResponseDto {
  success!: boolean;
  data?: AnalysisData;
  error?: string;

  static success(data: AnalysisData): AnalyzeResponseDto {
    const response = new AnalyzeResponseDto();
    response.success = true;
    response.data = data;
    return response;
  }

  static failure(error: string): AnalyzeResponseDto {
    const response = new AnalyzeResponseDto();
    response.success = false;
    response.error = error;
    return response;
  }
}
