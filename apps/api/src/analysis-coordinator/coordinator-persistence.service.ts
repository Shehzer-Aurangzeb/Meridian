import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';
import { ClaudeAnalysisResponse } from '../ai/interfaces/claude-response.types';

/**
 * Input payload for a single coordinator run record.
 *
 * `aiResponse` is null when the AI gate was not triggered (e.g. checklist
 * status was WATCHING). `errorMessage` is populated only for failed runs.
 */
export interface CoordinatorRunInput {
  coordinatorResult: CoordinatorAnalysisResult;
  aiResponse: ClaudeAnalysisResponse | null;
  durationMs: number;
  errorMessage?: string | null;
}

@Injectable()
export class CoordinatorPersistenceService {
  private readonly logger = new Logger(CoordinatorPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget persistence of a completed coordinator run.
   *
   * Never throws. Persistence failures are logged but do not propagate —
   * the SSE pipeline must never be blocked or corrupted by a DB error.
   */
  persist(input: CoordinatorRunInput): void {
    void this.write(input).catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Unknown persistence error';
      this.logger.error(
        `CoordinatorRun persistence failed | symbol=${input.coordinatorResult.symbol} | route=${input.coordinatorResult.strategyRoute} | message=${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  /**
   * Persist a run that errored before producing a coordinator result.
   * Used by the SSE controller's ERROR branch when the failure occurs
   * before the strategy route has been determined.
   */
  persistError(args: {
    symbol: string;
    timeframe: string;
    durationMs: number;
    errorMessage: string;
  }): void {
    void this.prisma.coordinatorRun
      .create({
        data: {
          symbol: args.symbol,
          timeframe: args.timeframe,
          regime: 'UNKNOWN',
          strategyRoute: 'UNKNOWN',
          checklistStatus: null,
          totalScore: null,
          shouldInvokeAI: false,
          aiAction: null,
          aiConfidence: null,
          coordinatorPayload: {} as Prisma.InputJsonValue,
          aiPayload: Prisma.JsonNull,
          durationMs: args.durationMs,
          errorMessage: args.errorMessage,
        },
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown persistence error';
        this.logger.error(
          `CoordinatorRun error-row persistence failed | symbol=${args.symbol} | message=${message}`,
        );
      });
  }

  private async write(input: CoordinatorRunInput): Promise<void> {
    const { coordinatorResult, aiResponse, durationMs, errorMessage } = input;

    await this.prisma.coordinatorRun.create({
      data: {
        symbol: coordinatorResult.symbol,
        timeframe: coordinatorResult.timeframe,
        regime: coordinatorResult.regimeResult.regime,
        strategyRoute: coordinatorResult.strategyRoute,
        checklistStatus: coordinatorResult.checklistResult?.status ?? null,
        totalScore: coordinatorResult.checklistResult?.totalScore ?? null,
        shouldInvokeAI: coordinatorResult.shouldInvokeAI,
        aiAction: aiResponse?.action ?? null,
        aiConfidence: aiResponse?.confidence ?? null,
        coordinatorPayload: coordinatorResult as unknown as Prisma.InputJsonValue,
        aiPayload:
          aiResponse === null
            ? Prisma.JsonNull
            : (aiResponse as unknown as Prisma.InputJsonValue),
        durationMs,
        errorMessage: errorMessage ?? null,
      },
    });
  }
}
