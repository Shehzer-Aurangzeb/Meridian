import { IsString, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { TradeType } from '../constants/timeframes';

export class MultiTimeframeAnalysisDto {
  @IsString()
  coin!: string;

  @IsOptional()
  @IsIn(['swing', 'day', 'scalp'])
  tradeType?: TradeType = 'day';

  @IsOptional()
  @IsBoolean()
  includeDetailedChecklist?: boolean = true;
}
