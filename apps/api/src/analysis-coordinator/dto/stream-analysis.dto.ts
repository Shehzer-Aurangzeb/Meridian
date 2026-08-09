import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { TimeInterval } from '../../common/types/candle.types';

/**
 * Query parameters for the SSE streaming analysis endpoint.
 *
 * Validated by the global `ValidationPipe` (whitelist + transform), so any
 * unknown query keys are stripped and `coin` is automatically uppercased.
 */
export class StreamAnalysisQueryDto {
  @ApiProperty({
    description: 'Base asset symbol (e.g. "BTC", "ETH"). Auto-uppercased.',
    example: 'BTC',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase().trim() : value,
  )
  @Matches(/^[A-Z0-9]{2,15}$/, {
    message: 'coin must be 2-15 uppercase alphanumeric characters',
  })
  coin!: string;

  @ApiProperty({
    description: 'Candle timeframe',
    enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
    example: '1h',
  })
  @IsEnum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const)
  timeframe!: TimeInterval;
}

/**
 * Discriminated union of SSE event payloads emitted by `streamAnalysis`.
 */
export type StreamAnalysisEvent =
  | { status: 'FETCHING_DATA'; message: string }
  | { status: 'REGIME_CLASSIFIED'; message: string; data: unknown }
  | { status: 'AI_THINKING'; message: string }
  | { status: 'HEARTBEAT'; ts: number }
  | { status: 'COMPLETE'; payload: unknown }
  | { status: 'ERROR'; error: string };
