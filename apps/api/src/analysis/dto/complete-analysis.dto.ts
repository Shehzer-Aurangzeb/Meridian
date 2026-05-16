import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CompleteAnalysisDto {
  // Required
  @IsString()
  coin!: string;

  // Optional - analysis parameters
  @IsOptional()
  @IsEnum(['swing', 'day', 'scalp'])
  tradeType?: 'swing' | 'day' | 'scalp';

  @IsOptional()
  @IsString()
  timeframe?: string;

  // Optional - risk management
  @IsOptional()
  @IsNumber()
  @Min(100)
  accountBalance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(5)
  riskPercentage?: number;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';

  @IsOptional()
  @IsEnum(['conservative', 'moderate', 'aggressive'])
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';

  // Optional - preferences
  @IsOptional()
  @IsBoolean()
  includeRiskManagement?: boolean;

  @IsOptional()
  @IsBoolean()
  includeFibonacci?: boolean;
}

export class QuickAnalysisDto {
  @IsString()
  coin!: string;
}
