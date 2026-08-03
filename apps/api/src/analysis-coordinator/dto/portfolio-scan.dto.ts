import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsPositive, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

import { ChecklistStatus, EntryChecklistResult } from '../../analysis/interfaces/checklist.types';
import { MarketRegime } from '../../market-regime/interfaces/market-regime.types';
import { SqueezeBreakoutSetup } from '../../squeeze-breakout/interfaces/squeeze-breakout.types';
import { ClaudeAnalysisResponse } from '../../ai/interfaces/claude-response.types';
import { StrategyRoute } from '../interfaces/coordinator.types';

/**
 * Input payload for the multi-timeframe portfolio scanner.
 *
 * Validated by the global `ValidationPipe` (whitelist + transform). `coin` is
 * normalised to uppercase before validation runs.
 */
export class PortfolioScanDto {
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
    description: 'Total capital available in the user\'s trading wallet (USDT).',
    example: 1000,
    minimum: 0,
    exclusiveMinimum: true,
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  walletBalance!: number;
}

/**
 * Macro bias derived from the 1d timeframe — the directional anchor that
 * sub-daily execution scans must align with.
 */
export interface MacroBias {
  timeframe: '1d';
  regime: MarketRegime | 'UNKNOWN';
  bias: 'long' | 'short' | 'neutral';
}

/**
 * Execution-horizon snapshot taken on the 4h (preferred) or 1h timeframe.
 *
 * Mirrors the coordinator's pipeline output: regime → strategy route →
 * either a squeeze breakout setup or a 5-point checklist evaluation.
 */
export interface ExecutionHorizon {
  timeframe: '4h' | '1h';
  strategyRoute: StrategyRoute | 'UNKNOWN';
  status: ChecklistStatus | 'PENDING_BREAKOUT' | 'WATCHING';
  score: number | null;
  shouldInvokeAI: boolean;
  squeezeSetup: SqueezeBreakoutSetup | null;
  checklistResult: EntryChecklistResult | null;
}

/**
 * Concrete sizing + risk envelope computed for the execution horizon. Null
 * when the execution horizon resolved to `WATCHING` (no trade to size).
 */
export interface RiskProfile {
  positionSize: number;
  marginRequired: number;
  recommendedLeverage: number;
  liquidationPrice: number;
  stopLossPrice: number;
  warnings: string[];
}

/**
 * Unified response payload for `POST /analysis-coordinator/portfolio-scan`.
 *
 * Combines macro bias (daily), execution horizon (4h/1h), pre-computed risk
 * sizing tied to the supplied wallet balance, and the optional AI insight.
 */
export interface MultiTimeframeScanResult {
  coin: string;
  walletBalance: number;
  macroBias: MacroBias;
  executionHorizon: ExecutionHorizon;
  riskProfile: RiskProfile | null;
  aiInsight: ClaudeAnalysisResponse | null;
  /**
   * ISO-8601 UTC timestamp at which this scan's signal is considered stale.
   * Derived from the chosen execution-horizon timeframe via the smart-TTL
   * mapping (15m=4h, 1h=12h, 4h=48h, 1d=7d). The frontend uses this to
   * render a live countdown next to the signal card.
   */
  expiresAt: string;
}
