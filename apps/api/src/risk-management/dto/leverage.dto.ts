import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExperienceLevel, TradeStyle } from '../interfaces/leverage.types';

export class RecommendLeverageDto {
  @ApiProperty({
    description: 'Trading timeframe (e.g., 1h, 4h, 1d)',
    example: '1h',
  })
  @IsString()
  timeframe!: string;
  
  @ApiProperty({
    description: 'Checklist score from analysis (0-100)',
    minimum: 0,
    maximum: 100,
    example: 75,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  checklistScore!: number;
  
  @ApiProperty({
    description: 'Average True Range value',
    minimum: 0,
    example: 500,
  })
  @IsNumber()
  @Min(0)
  atr!: number;
  
  @ApiProperty({
    description: 'Current market price',
    minimum: 0,
    example: 48000,
  })
  @IsNumber()
  @Min(0)
  currentPrice!: number;
  
  @ApiProperty({
    description: 'Stop loss percentage from entry',
    minimum: 0,
    maximum: 100,
    example: 3,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  stopLossPercentage!: number;
  
  @ApiProperty({
    description: 'Trader experience level',
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    example: 'intermediate',
  })
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel!: ExperienceLevel;
  
  @ApiPropertyOptional({
    description: 'Trading style',
    enum: ['swing', 'day', 'scalp', 'ultra-scalp'],
    example: 'day',
  })
  @IsOptional()
  @IsEnum(['swing', 'day', 'scalp', 'ultra-scalp'])
  tradeStyle?: TradeStyle;
  
  @ApiPropertyOptional({
    description: 'Risk tolerance preference',
    enum: ['conservative', 'moderate', 'aggressive'],
    example: 'moderate',
  })
  @IsOptional()
  @IsEnum(['conservative', 'moderate', 'aggressive'])
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  
  @ApiPropertyOptional({
    description: 'Current market cycle',
    enum: ['bull', 'bear', 'ranging'],
    example: 'bull',
  })
  @IsOptional()
  @IsEnum(['bull', 'bear', 'ranging'])
  marketCycle?: 'bull' | 'bear' | 'ranging';
}

export class GetLeverageConstraintsDto {
  @ApiProperty({
    description: 'Trader experience level',
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    example: 'intermediate',
  })
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel!: ExperienceLevel;
  
  @ApiProperty({
    description: 'Trading timeframe',
    example: '1h',
  })
  @IsString()
  timeframe!: string;
}
