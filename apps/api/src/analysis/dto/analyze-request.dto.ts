import { IsString, IsOptional, IsIn, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class AnalyzeRequestDto {
  @IsString()
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Coin must be uppercase alphanumeric (e.g., BTC, ETH)',
  })
  @Transform(({ value }) => value?.toUpperCase())
  coin!: string;

  @IsOptional()
  @IsIn(['1h', '4h', '12h', '1d'], {
    message: 'Timeframe must be one of: 1h, 4h, 12h, 1d',
  })
  timeframe?: string = '4h';
}
