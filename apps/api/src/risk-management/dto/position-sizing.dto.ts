import { IsNumber, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalculatePositionSizeDto {
  @ApiProperty({
    description: 'Total account balance in USD',
    minimum: 100,
    example: 10000,
  })
  @IsNumber()
  @Min(100, { message: 'Account balance must be at least $100' })
  accountBalance!: number;

  @ApiProperty({
    description: 'Risk percentage per trade (0.5-5%)',
    minimum: 0.5,
    maximum: 5,
    example: 1,
  })
  @IsNumber()
  @Min(0.5, { message: 'Risk percentage must be at least 0.5%' })
  @Max(5, { message: 'Risk percentage cannot exceed 5%' })
  riskPercentage!: number;

  @ApiProperty({
    description: 'Entry price for the trade',
    minimum: 0.00001,
    example: 48000,
  })
  @IsNumber()
  @Min(0.00001, { message: 'Entry price must be positive' })
  entryPrice!: number;

  @ApiProperty({
    description: 'Stop loss price',
    minimum: 0.00001,
    example: 46560,
  })
  @IsNumber()
  @Min(0.00001, { message: 'Stop loss must be positive' })
  stopLoss!: number;

  @ApiProperty({
    description: 'Leverage multiplier (1-20x)',
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsNumber()
  @Min(1, { message: 'Leverage must be at least 1x' })
  @Max(20, { message: 'Leverage cannot exceed 20x' })
  leverage!: number;
}

export class CalculateRiskRewardDto {
  @ApiProperty({
    description: 'Entry price for the trade',
    example: 48000,
  })
  @IsNumber()
  @Min(0.00001)
  entryPrice!: number;

  @ApiProperty({
    description: 'Stop loss price',
    example: 46560,
  })
  @IsNumber()
  @Min(0.00001)
  stopLoss!: number;

  @ApiProperty({
    description: 'First take profit target',
    example: 49440,
  })
  @IsNumber()
  @Min(0.00001)
  tp1!: number;

  @ApiProperty({
    description: 'Second take profit target',
    example: 50880,
  })
  @IsNumber()
  @Min(0.00001)
  tp2!: number;

  @ApiProperty({
    description: 'Third take profit target',
    example: 52320,
  })
  @IsNumber()
  @Min(0.00001)
  tp3!: number;
}

export class PortfolioAllocationQueryDto {
  @ApiProperty({
    description: 'Portfolio balance in USD',
    minimum: 100,
    example: 10000,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(100, { message: 'Balance must be at least $100' })
  balance!: number;
}
