import { ApiProperty } from '@nestjs/swagger';

export class HistoryAnalysis {
  @ApiProperty({ example: 'clw2k...' })
  id!: string;

  @ApiProperty({ example: 'BTC' })
  coin!: string;

  @ApiProperty({ example: '4h' })
  timeframe!: string;

  @ApiProperty({ example: 'LONG', enum: ['LONG', 'SHORT', 'WAIT'] })
  suggestion!: string;

  @ApiProperty({ example: 70123.45 })
  entryPrice!: number;

  @ApiProperty({ example: 71500 })
  tp1!: number;

  @ApiProperty({ example: 72800 })
  tp2!: number;

  @ApiProperty({ example: 74000 })
  tp3!: number;

  @ApiProperty({ example: 68900 })
  stopLoss!: number;

  @ApiProperty({ example: 5 })
  leverage!: number;

  @ApiProperty({ example: 'Trend continuation setup with confluence.' })
  reasoning!: string;

  @ApiProperty({ nullable: true, type: Number, example: 58.2 })
  rsiValue!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  bbUpper!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  bbMiddle!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  bbLower!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  atrValue!: number | null;

  @ApiProperty({ example: 70050.12 })
  priceAtAnalysis!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class HistoryData {
  @ApiProperty({ type: [HistoryAnalysis] })
  analyses!: HistoryAnalysis[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ required: false, example: 'BTC' })
  coin?: string;
}

export class HistoryResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: HistoryData, required: false })
  data?: HistoryData;

  @ApiProperty({ required: false, example: 'No history found' })
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
