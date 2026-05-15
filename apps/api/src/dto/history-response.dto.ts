export interface HistoryAnalysis {
  id: string;
  coin: string;
  timeframe: string;
  suggestion: string;
  entryPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  rsiValue: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atrValue: number | null;
  priceAtAnalysis: number;
  createdAt: Date;
}

export interface HistoryData {
  analyses: HistoryAnalysis[];
  total: number;
  coin?: string;
}

export class HistoryResponseDto {
  success!: boolean;
  data?: HistoryData;
  error?: string;

  static success(data: HistoryData): HistoryResponseDto {
    const response = new HistoryResponseDto();
    response.success = true;
    response.data = data;
    return response;
  }

  static failure(error: string): HistoryResponseDto {
    const response = new HistoryResponseDto();
    response.success = false;
    response.error = error;
    return response;
  }
}
