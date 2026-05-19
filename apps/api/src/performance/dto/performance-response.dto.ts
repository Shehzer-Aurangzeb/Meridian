import { ApiProperty } from '@nestjs/swagger';
import { AnalysisStatus, WinRateStats } from '../performance.service';

export class PerformanceAnalysis {
  @ApiProperty({ example: 'clw2k...' })
  id!: string;

  @ApiProperty({ example: 'BTC' })
  coin!: string;

  @ApiProperty({ example: 'LONG', enum: ['LONG', 'SHORT', 'WAIT'] })
  suggestion!: string;

  @ApiProperty({ example: 70123.45 })
  entryPrice!: number;

  @ApiProperty({ example: 68900 })
  stopLoss!: number;

  @ApiProperty({ example: 70050.12 })
  priceAtAnalysis!: number;

  @ApiProperty({ nullable: true, type: Number, example: 71250.4 })
  currentPrice!: number | null;

  @ApiProperty({
    enum: ['correct', 'failed', 'pending', 'neutral'],
    example: 'pending',
  })
  status!: AnalysisStatus;

  @ApiProperty({ nullable: true, type: Number, example: 1200.5 })
  priceChange!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 1.72 })
  priceChangePercent!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class PerformanceData implements WinRateStats {
  @ApiProperty({ example: 0.62, description: 'Fraction of correct calls' })
  winRate!: number;

  @ApiProperty({ example: 50 })
  totalAnalyzed!: number;

  @ApiProperty({ example: 31 })
  correct!: number;

  @ApiProperty({ example: 12 })
  failed!: number;

  @ApiProperty({ example: 5 })
  pending!: number;

  @ApiProperty({ example: 2 })
  neutral!: number;

  @ApiProperty({ required: false, example: 'BTC' })
  coin?: string;

  @ApiProperty({ type: [PerformanceAnalysis] })
  recentAnalyses!: PerformanceAnalysis[];
}

export class PerformanceResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: PerformanceData, required: false })
  data?: PerformanceData;

  @ApiProperty({ required: false, example: 'No performance data' })
  error?: string;

  static success(data: PerformanceData): PerformanceResponseDto {
    const response = new PerformanceResponseDto();
    response.success = true;
    response.data = data;
    return response;
  }

  static failure(error: string): PerformanceResponseDto {
    const response = new PerformanceResponseDto();
    response.success = false;
    response.error = error;
    return response;
  }
}
