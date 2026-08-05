import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============ Health Response ============
export class HealthResponseDto {
  @ApiProperty({ enum: ['healthy', 'degraded', 'unhealthy'], example: 'healthy' })
  status!: 'healthy' | 'degraded' | 'unhealthy';

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  cache!: 'ok' | 'error';

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  binance!: 'ok' | 'error';

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  database!: 'ok' | 'error';

  @ApiProperty({ example: '2026-05-16T19:30:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 3600000 })
  uptime!: number;

  @ApiProperty()
  responseTime!: {
    cache: number | null;
    binance: number | null;
    database: number | null;
  };
}

// ============ Position Sizing Response ============
export class PositionSizeResponseDto {
  @ApiProperty({ description: 'Dollar amount at risk', example: 100 })
  riskAmount!: number;

  @ApiProperty({ description: 'Total position size in USD', example: 3333.33 })
  positionSize!: number;

  @ApiProperty({ description: 'Margin required for position', example: 666.67 })
  margin!: number;

  @ApiProperty({ description: 'Effective leverage being used', example: 5 })
  effectiveLeverage!: number;

  @ApiProperty({ description: 'Price at which position gets liquidated', example: 43200 })
  liquidationPrice!: number;

  @ApiProperty({ description: 'Distance to liquidation as percentage', example: 10 })
  liquidationDistance!: number;

  @ApiProperty({ description: 'Whether position size is valid', example: true })
  isValid!: boolean;

  @ApiPropertyOptional({ description: 'Warning messages if any' })
  warnings?: string[];
}

// ============ Risk Reward Response ============
export class RiskRewardResponseDto {
  @ApiProperty({ example: 1440 })
  riskPerUnit!: number;

  @ApiProperty()
  tp1!: { reward: number; ratio: number; percentage: string };

  @ApiProperty()
  tp2!: { reward: number; ratio: number; percentage: string };

  @ApiProperty()
  tp3!: { reward: number; ratio: number; percentage: string };

  @ApiProperty({ example: 2.5 })
  overall!: number;

  @ApiProperty({ example: true })
  meetsMinimum!: boolean;

  @ApiProperty({ example: 'good' })
  quality!: string;
}

// ============ Leverage Response ============
export class LeverageResponseDto {
  @ApiProperty({ description: 'Recommended leverage', example: 5 })
  recommended!: number;

  @ApiProperty({ description: 'Conservative option', example: 3 })
  conservative!: number;

  @ApiProperty({ description: 'Moderate option', example: 5 })
  moderate!: number;

  @ApiProperty({ description: 'Aggressive option', example: 7 })
  aggressive!: number;

  @ApiProperty({ description: 'Reasoning for recommendation', example: 'Base 7x for 1h day trades. Capped at 5x for intermediate level.' })
  reasoning!: string;

  @ApiProperty({ description: 'Adjustments applied' })
  adjustments!: string[];

  @ApiProperty({ example: 38400 })
  liquidationPrice!: number;

  @ApiProperty({ example: '20.0% below entry' })
  liquidationDistance!: string;

  @ApiProperty({ example: '20.0%' })
  maxDrawdown!: string;

  @ApiProperty()
  warnings!: string[];

  @ApiProperty({ enum: ['swing', 'day', 'scalp', 'ultra-scalp'] })
  tradeStyle!: string;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'extreme'] })
  riskLevel!: string;
}

// ============ Portfolio Allocation Response ============
export class AllocationItemDto {
  @ApiProperty({ example: 'High Conviction' })
  tier!: string;

  @ApiProperty({ example: 2000 })
  allocation!: number;

  @ApiProperty({ example: '20%' })
  percentage!: string;

  @ApiProperty({ example: 1 })
  riskPerTrade!: number;

  @ApiProperty({ example: 3 })
  leverage!: number;
}

export class PortfolioAllocationResponseDto {
  @ApiProperty({ example: 10000 })
  balance!: number;

  @ApiProperty({ type: [AllocationItemDto] })
  tiers!: AllocationItemDto[];
}

// ============ HTF Bias Response ============
export class HTFBiasResponseDto {
  @ApiProperty({ enum: ['bullish', 'bearish', 'neutral'], example: 'bullish' })
  bias!: 'bullish' | 'bearish' | 'neutral';

  @ApiProperty({ minimum: 0, maximum: 100, example: 75 })
  confidence!: number;

  @ApiProperty({ example: 'Strong bullish momentum on higher timeframes' })
  reasoning!: string;

  @ApiProperty()
  details!: {
    weekly: { trend: string; rsi: number };
    daily: { trend: string; rsi: number };
  };
}

// ============ Support/Resistance Response ============
export class SupportResistanceLevelDto {
  @ApiProperty({ example: 48500 })
  price!: number;

  @ApiProperty({ enum: ['support', 'resistance'], example: 'resistance' })
  type!: 'support' | 'resistance';

  @ApiProperty({ minimum: 1, maximum: 5, example: 3 })
  strength!: number;

  @ApiPropertyOptional({ example: -2.5 })
  distance?: number;
}

// ============ Complete Analysis Response ============
export class AIAnalysisDto {
  @ApiProperty()
  entry!: { price: number; zone: string };

  @ApiProperty()
  stopLoss!: { price: number; reasoning: string };

  @ApiProperty()
  takeProfit!: {
    tp1: { price: number; gain: string };
    tp2: { price: number; gain: string };
    tp3: { price: number; gain: string };
  };

  @ApiProperty()
  reasoning!: string;
}

export class ChecklistDto {
  /**
   * Historical only. The 0-100 score was removed on 5 Aug 2026 after score
   * buckets were measured and found not to rank outcomes; the column is kept
   * so past rows still report what the system said at the time. Null on every
   * row written since. Read `conditionsMet` instead.
   */
  @ApiProperty({ example: 75, nullable: true, deprecated: true })
  totalScore!: number | null;

  @ApiProperty({ example: 4 })
  conditionsMet!: number;

  @ApiProperty()
  conditions!: {
    htfBias: boolean;
    keyLevel: boolean;
    momentum: boolean;
    structure: boolean;
    confirmation: boolean;
  };
}

export class SummaryDto {
  @ApiProperty({ enum: ['LONG', 'SHORT', 'WAIT'], example: 'LONG' })
  action!: 'LONG' | 'SHORT' | 'WAIT';

  @ApiProperty({ enum: ['low', 'medium', 'high'], example: 'high' })
  confidence!: 'low' | 'medium' | 'high';

  @ApiProperty({ example: true })
  shouldTrade!: boolean;

  @ApiProperty({ example: 'Strong bullish setup with 4/5 conditions met' })
  quickReason!: string;

  @ApiPropertyOptional()
  warnings?: string[];
}

export class CompleteAnalysisResponseDto {
  @ApiProperty({ example: 'BTC' })
  coin!: string;

  @ApiProperty({ example: 48500 })
  currentPrice!: number;

  @ApiProperty({ example: '2026-05-16T19:30:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: SummaryDto })
  summary!: SummaryDto;

  @ApiProperty({ type: ChecklistDto })
  checklist!: ChecklistDto;

  @ApiProperty({ type: HTFBiasResponseDto })
  htfBias!: HTFBiasResponseDto;

  @ApiPropertyOptional({ type: AIAnalysisDto })
  aiAnalysis?: AIAnalysisDto;

  @ApiPropertyOptional()
  riskManagement?: {
    positionSizing: PositionSizeResponseDto;
    leverageRecommendation: LeverageResponseDto;
    riskReward: RiskRewardResponseDto;
  };
}
