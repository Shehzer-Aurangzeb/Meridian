import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';
import { ClaudeAnalysisResponse } from '../ai/interfaces/claude-response.types';
import { AnalysisRecord } from './analyze.service';

/**
 * What gets saved for one analysis run.
 *
 * TODO: two old columns are no longer written but kept in the database, so
 * past rows still show what the old system said at the time. They can be
 * dropped later if that history stops mattering.
 */
export interface CoordinatorRunInput {
  coordinatorResult: CoordinatorAnalysisResult;
  aiResponse: ClaudeAnalysisResponse | null;
  durationMs: number;
  errorMessage?: string | null;
  /**
   * Optional smart-TTL expiry. When provided, persisted on the row so
   * downstream consumers (UI countdown, cleanup jobs) can reason about
   * signal freshness. Null/omitted ⇒ no TTL recorded.
   */
  expiresAt?: Date | null;
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

  /**
   * Saves a complete analysis, levels and plans included. Waited on, unlike
   * the other save: a scheduled run that failed to save has done nothing.
   */
  async persistAnalysis(record: AnalysisRecord): Promise<{ id: string }> {
    return this.prisma.coordinatorRun.create({
      data: {
        symbol: record.symbol,
        timeframe: record.timeframes.regime,
        regime: record.regime.regime,
        strategyRoute: record.route,
        // Records whether a Claude call ran. Nothing narrates on this path
        // yet — narration is a caller's flag, not a pipeline stage.
        shouldInvokeAI: false,
        aiAction: null,
        aiConfidence: null,
        coordinatorPayload: record as unknown as Prisma.InputJsonValue,
        aiPayload: Prisma.JsonNull,
        durationMs: record.durationMs,
      },
      select: { id: true },
    });
  }

  private async write(input: CoordinatorRunInput): Promise<void> {
    const { coordinatorResult, aiResponse, durationMs, errorMessage, expiresAt } = input;

    await this.prisma.coordinatorRun.create({
      data: {
        symbol: coordinatorResult.symbol,
        timeframe: coordinatorResult.timeframe,
        regime: coordinatorResult.regimeResult.regime,
        strategyRoute: coordinatorResult.strategyRoute,
        // The pipeline no longer emits a verdict, so this column now records
        // what actually happened: did a Claude call run for this row. Kept
        // rather than migrated, per the no-migration decision — historical
        // rows keep their original "was this gated in" meaning.
        shouldInvokeAI: aiResponse !== null,
        aiAction: aiResponse?.action ?? null,
        aiConfidence: aiResponse?.confidence ?? null,
        coordinatorPayload: coordinatorResult as unknown as Prisma.InputJsonValue,
        aiPayload:
          aiResponse === null
            ? Prisma.JsonNull
            : (aiResponse as unknown as Prisma.InputJsonValue),
        durationMs,
        errorMessage: errorMessage ?? null,
        expiresAt: expiresAt ?? null,
      },
    });
  }
}
