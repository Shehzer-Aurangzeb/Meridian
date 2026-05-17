import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteAnalysisDto {
  @ApiProperty({
    description: 'Cryptocurrency symbol (e.g., BTC, ETH, SOL)',
    example: 'BTC',
  })
  @IsString()
  @IsNotEmpty({ message: 'Coin symbol is required' })
  coin!: string;

  @ApiPropertyOptional({
    description: 'Type of trade strategy',
    enum: ['swing', 'day', 'scalp'],
    example: 'day',
  })
  @IsOptional()
  @IsEnum(['swing', 'day', 'scalp'])
  tradeType?: 'swing' | 'day' | 'scalp';

  @ApiPropertyOptional({
    description: 'Primary timeframe for analysis',
    example: '1h',
  })
  @IsOptional()
  @IsString()
  timeframe?: string;

  @ApiPropertyOptional({
    description: 'Total account balance in USD',
    minimum: 100,
    example: 10000,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  accountBalance?: number;

  @ApiPropertyOptional({
    description: 'Risk percentage per trade (0.5-5%)',
    minimum: 0.5,
    maximum: 5,
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(5)
  riskPercentage?: number;

  @ApiPropertyOptional({
    description: 'Trader experience level (affects leverage caps)',
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    example: 'intermediate',
  })
  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';

  @ApiPropertyOptional({
    description: 'Risk tolerance preference',
    enum: ['conservative', 'moderate', 'aggressive'],
    example: 'moderate',
  })
  @IsOptional()
  @IsEnum(['conservative', 'moderate', 'aggressive'])
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';

  @ApiPropertyOptional({
    description: 'Include risk management calculations',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeRiskManagement?: boolean;

  @ApiPropertyOptional({
    description: 'Include Fibonacci levels in analysis',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeFibonacci?: boolean;
}

export class QuickAnalysisDto {
  @ApiProperty({
    description: 'Cryptocurrency symbol',
    example: 'BTC',
  })
  @IsString()
  coin!: string;
}
