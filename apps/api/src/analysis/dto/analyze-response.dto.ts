import { ApiProperty } from '@nestjs/swagger';

export class BollingerBandsDto {
  @ApiProperty({ example: 71250.4 })
  upper!: number;

  @ApiProperty({ example: 70100.1 })
  middle!: number;

  @ApiProperty({ example: 68950.7 })
  lower!: number;
}

export class IndicatorsSnapshotDto {
  @ApiProperty({ example: 58.2, description: 'RSI(14) value at last close' })
  rsi!: number;

  @ApiProperty({ type: BollingerBandsDto })
  bb!: BollingerBandsDto;

  @ApiProperty({ example: 412.5, description: 'ATR(14)' })
  atr!: number;

  @ApiProperty({ nullable: true, example: 68500, type: Number })
  support!: number | null;

  @ApiProperty({ nullable: true, example: 72500, type: Number })
  resistance!: number | null;
}

export class AnalysisData {
  @ApiProperty({ example: 'clw2k...' })
  id!: string;

  @ApiProperty({ example: 'BTC' })
  coin!: string;

  @ApiProperty({
    example: 'LONG',
    enum: ['LONG', 'SHORT', 'WAIT'],
  })
  action!: string;

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

  @ApiProperty({ example: 5, description: 'Suggested leverage multiplier' })
  leverage!: number;

  @ApiProperty({
    example: 'Bullish momentum with rising RSI and price holding above support',
  })
  reasoning!: string;

  @ApiProperty({
    type: [String],
    example: ['RSI > 50', 'Price above 20MA', 'ATR expanding'],
  })
  conditionsMet!: string[];

  @ApiProperty({ type: IndicatorsSnapshotDto })
  indicators!: IndicatorsSnapshotDto;

  @ApiProperty({ example: 70050.12 })
  currentPrice!: number;

  @ApiProperty({ example: '4h' })
  timeframe!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  timestamp!: Date;
}

export class AnalyzeResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AnalysisData, required: false })
  data?: AnalysisData;

  @ApiProperty({ required: false, example: 'Failed to fetch market data' })
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
