import {
  MultiTimeframeAnalysisResult,
  TimeframeAnalysis,
  HTFBiasResult,
  LTFEntryResult,
  EntryChecklist,
} from '../interfaces/multi-timeframe.types';

export class MultiTimeframeResponseDto {
  success!: boolean;
  data!: MultiTimeframeAnalysisResult | null;
  error!: string | null;
  timestamp!: Date;

  static success(data: MultiTimeframeAnalysisResult): MultiTimeframeResponseDto {
    const dto = new MultiTimeframeResponseDto();
    dto.success = true;
    dto.data = data;
    dto.error = null;
    dto.timestamp = new Date();
    return dto;
  }

  static failure(error: string): MultiTimeframeResponseDto {
    const dto = new MultiTimeframeResponseDto();
    dto.success = false;
    dto.data = null;
    dto.error = error;
    dto.timestamp = new Date();
    return dto;
  }
}

/**
 * Simplified response for quick bias checks
 */
export interface QuickBiasResponse {
  symbol: string;
  htfBias: HTFBiasResult;
  shouldTrade: boolean;
  reasoning: string;
}

export class QuickBiasResponseDto {
  success!: boolean;
  data!: QuickBiasResponse | null;
  error!: string | null;

  static success(data: QuickBiasResponse): QuickBiasResponseDto {
    const dto = new QuickBiasResponseDto();
    dto.success = true;
    dto.data = data;
    dto.error = null;
    return dto;
  }

  static failure(error: string): QuickBiasResponseDto {
    const dto = new QuickBiasResponseDto();
    dto.success = false;
    dto.data = null;
    dto.error = error;
    return dto;
  }
}
