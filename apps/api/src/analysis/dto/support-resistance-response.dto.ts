import {
  SupportResistanceLevel,
  FibonacciLevels,
  SupportResistanceAnalysis,
} from '../interfaces/support-resistance.types';

export class SupportResistanceResponseDto {
  success!: boolean;
  data!: SupportResistanceAnalysis | null;
  error!: string | null;
  timestamp!: Date;

  static success(data: SupportResistanceAnalysis): SupportResistanceResponseDto {
    const dto = new SupportResistanceResponseDto();
    dto.success = true;
    dto.data = data;
    dto.error = null;
    dto.timestamp = new Date();
    return dto;
  }

  static failure(error: string): SupportResistanceResponseDto {
    const dto = new SupportResistanceResponseDto();
    dto.success = false;
    dto.data = null;
    dto.error = error;
    dto.timestamp = new Date();
    return dto;
  }
}

/**
 * Simple levels list response
 */
export interface LevelsListResponse {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  levels: SupportResistanceLevel[];
  nearestSupport: SupportResistanceLevel | null;
  nearestResistance: SupportResistanceLevel | null;
}

export class LevelsListResponseDto {
  success!: boolean;
  data!: LevelsListResponse | null;
  error!: string | null;

  static success(data: LevelsListResponse): LevelsListResponseDto {
    const dto = new LevelsListResponseDto();
    dto.success = true;
    dto.data = data;
    dto.error = null;
    return dto;
  }

  static failure(error: string): LevelsListResponseDto {
    const dto = new LevelsListResponseDto();
    dto.success = false;
    dto.data = null;
    dto.error = error;
    return dto;
  }
}
