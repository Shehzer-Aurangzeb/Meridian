import { IsNumber, Min, Max, IsOptional } from 'class-validator';

export class CalculatePositionSizeDto {
  @IsNumber()
  @Min(100, { message: 'Account balance must be at least $100' })
  accountBalance!: number;

  @IsNumber()
  @Min(0.5, { message: 'Risk percentage must be at least 0.5%' })
  @Max(5, { message: 'Risk percentage cannot exceed 5%' })
  riskPercentage!: number;

  @IsNumber()
  @Min(0.00001, { message: 'Entry price must be positive' })
  entryPrice!: number;

  @IsNumber()
  @Min(0.00001, { message: 'Stop loss must be positive' })
  stopLoss!: number;

  @IsNumber()
  @Min(1, { message: 'Leverage must be at least 1x' })
  @Max(20, { message: 'Leverage cannot exceed 20x' })
  leverage!: number;
}

export class CalculateRiskRewardDto {
  @IsNumber()
  @Min(0.00001)
  entryPrice!: number;

  @IsNumber()
  @Min(0.00001)
  stopLoss!: number;

  @IsNumber()
  @Min(0.00001)
  tp1!: number;

  @IsNumber()
  @Min(0.00001)
  tp2!: number;

  @IsNumber()
  @Min(0.00001)
  tp3!: number;
}

export class PortfolioAllocationQueryDto {
  @IsNumber()
  @Min(100, { message: 'Balance must be at least $100' })
  balance!: number;
}
