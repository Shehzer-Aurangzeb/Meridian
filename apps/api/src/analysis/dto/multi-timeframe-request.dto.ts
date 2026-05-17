import { IsString, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TradeType } from '../../common/constants/timeframes';

export class MultiTimeframeAnalysisDto {
  @ApiProperty({
    description: 'Cryptocurrency symbol',
    example: 'BTC',
  })
  @IsString()
  coin!: string;

  @ApiPropertyOptional({
    description: 'Trade type determines which timeframes to analyze',
    enum: ['swing', 'day', 'scalp'],
    default: 'day',
    example: 'day',
  })
  @IsOptional()
  @IsIn(['swing', 'day', 'scalp'])
  tradeType?: TradeType = 'day';

  @ApiPropertyOptional({
    description: 'Include detailed checklist breakdown',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeDetailedChecklist?: boolean = true;
}
