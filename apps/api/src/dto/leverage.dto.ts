import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { ExperienceLevel, TradeStyle } from '../types/leverage.types';

export class RecommendLeverageDto {
  @IsString()
  timeframe!: string;
  
  @IsNumber()
  @Min(0)
  @Max(100)
  checklistScore!: number;
  
  @IsNumber()
  @Min(0)
  atr!: number;
  
  @IsNumber()
  @Min(0)
  currentPrice!: number;
  
  @IsNumber()
  @Min(0)
  @Max(100)
  stopLossPercentage!: number;
  
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel!: ExperienceLevel;
  
  @IsOptional()
  @IsEnum(['swing', 'day', 'scalp', 'ultra-scalp'])
  tradeStyle?: TradeStyle;
  
  @IsOptional()
  @IsEnum(['conservative', 'moderate', 'aggressive'])
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  
  @IsOptional()
  @IsEnum(['bull', 'bear', 'ranging'])
  marketCycle?: 'bull' | 'bear' | 'ranging';
}

export class GetLeverageConstraintsDto {
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel!: ExperienceLevel;
  
  @IsString()
  timeframe!: string;
}
