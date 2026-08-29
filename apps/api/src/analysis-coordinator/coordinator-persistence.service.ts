import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';
import { ClaudeAnalysisResponse } from '../ai/interfaces/claude-response.types';
import { AnalysisRecord } from './analyze.service';

/** What gets saved for one analysis run. */
export interface CoordinatorRunInput {
  coordinatorResult: CoordinatorAnalysisResult;
  aiResponse: ClaudeAnalysisResponse | null;
  durationMs: number;
  errorMessage?: string | null;
  /** Optional TTL for the signal. Omitted means no expiry recorded. */
  expiresAt?: Date | null;
}

@Injectable()
export class CoordinatorPersistenceService {
  private readonly logger = new Logger(CoordinatorPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Save without waiting. Never throws — a DB error must not break the stream. */
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

  /** Save a run that failed before it produced anything. */
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

  /** Save a whole analysis. Waited on — a run that did not save did nothing. */
  async persistAnalysis(record: AnalysisRecord): Promise<{ id: string }> {
    return this.prisma.coordinatorRun.create({
      data: {
        symbol: record.symbol,
        timeframe: record.timeframes.regime,
        regime: record.regime.regime,
        strategyRoute: record.route,
        // Nothing narrates on this path; narration is asked for separately.
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
        // Now records whether a Claude call ran. Old rows keep the old meaning.
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
