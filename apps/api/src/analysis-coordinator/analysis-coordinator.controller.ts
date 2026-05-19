import {
  Controller,
  Sse,
  Post,
  Body,
  Query,
  MessageEvent,
  Logger,
  UsePipes,
  ValidationPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { ClaudeService } from '../ai/ai.service';
import { ClaudeAnalysisResponse } from '../ai/interfaces/claude-response.types';
import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from './analysis-coordinator.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { CoordinatorAnalysisResult } from './interfaces/coordinator.types';
import {
  StreamAnalysisQueryDto,
  StreamAnalysisEvent,
} from './dto/stream-analysis.dto';

@ApiTags('analysis-coordinator')
@Controller('analysis-coordinator')
export class AnalysisCoordinatorController {
  private readonly logger = new Logger(AnalysisCoordinatorController.name);

  constructor(
    private readonly coordinator: AnalysisCoordinatorService,
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly marketRegimeService: MarketRegimeService,
    private readonly claudeService: ClaudeService,
    private readonly persistence: CoordinatorPersistenceService,
  ) {}

  /**
   * Server-Sent Events stream that drives the analysis pipeline step by
   * step and pushes live progress updates to the client.
   *
   * Emission sequence:
   *   1. FETCHING_DATA      — emitted immediately on subscription.
   *   2. REGIME_CLASSIFIED  — after candle fetch + regime classification.
   *   3. AI_THINKING        — only if `shouldInvokeAI` is true.
   *   4. COMPLETE           — final combined payload; stream closes.
   *   5. ERROR              — terminal error event; stream closes.
   *
   * Throttled per IP to bound the long-lived connection budget.
   */
  @Sse('stream')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Stream analysis pipeline as Server-Sent Events',
    description:
      'Runs the full analysis pipeline (fetch → regime → strategy route → AI) ' +
      'and streams progress updates as SSE events. The stream terminates after ' +
      'emitting either a COMPLETE or ERROR event.',
  })
  @ApiQuery({ name: 'coin', required: true, example: 'BTC' })
  @ApiQuery({
    name: 'timeframe',
    required: true,
    enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
    example: '1h',
  })
  @ApiResponse({
    status: 200,
    description:
      'Server-Sent Events stream (text/event-stream). Each event is a ' +
      'JSON-encoded `StreamAnalysisEvent` payload.',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  streamAnalysis(
    @Query() query: StreamAnalysisQueryDto,
  ): Observable<MessageEvent> {
    const { coin, timeframe } = query;

    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;
      let coordinatorResult: CoordinatorAnalysisResult | null = null;
      const startedAt = Date.now();

      const emit = (event: StreamAnalysisEvent): void => {
        if (cancelled) return;
        subscriber.next({ data: event });
      };

      // Heartbeat — keeps the connection alive through proxy idle timeouts
      // (Nginx 60s, Cloudflare 100s) during long Claude waits.
      const heartbeat = setInterval(() => {
        emit({ status: 'HEARTBEAT', ts: Date.now() });
      }, 15_000);

      const run = async (): Promise<void> => {
        try {
          // ── Step 1: FETCHING_DATA ────────────────────────────────────
          emit({
            status: 'FETCHING_DATA',
            message: `Fetching ${ANALYSIS_CANDLE_LIMIT} candles from Binance API...`,
          });

          const candles = await this.binanceService.getCandles(
            coin,
            timeframe,
            ANALYSIS_CANDLE_LIMIT,
          );
          if (cancelled) return;

          const context = this.indicatorsService.buildContext(
            coin,
            timeframe,
            candles,
          );

          // ── Step 2: REGIME_CLASSIFIED ────────────────────────────────
          const regimeResult =
            this.marketRegimeService.classifyFromContext(context);

          emit({
            status: 'REGIME_CLASSIFIED',
            message: 'Market regime calculated successfully.',
            data: regimeResult,
          });

          // ── Step 3: Pivot on strategy route ──────────────────────────
          coordinatorResult = this.coordinator.routeFromRegime(
            context,
            timeframe,
            regimeResult,
          );
          if (cancelled) return;

          // ── Step 4: AI_THINKING (conditional) ────────────────────────
          let aiResponse: ClaudeAnalysisResponse | null = null;
          if (coordinatorResult.shouldInvokeAI) {
            emit({
              status: 'AI_THINKING',
              message:
                'Quantitative gates passed. Invoking Claude 4.7 Opus for psychological analysis...',
            });

            aiResponse =
              await this.claudeService.analyzeWithChecklist(coordinatorResult);
            if (cancelled) return;
          }

          // ── Step 5: COMPLETE ─────────────────────────────────────────
          emit({
            status: 'COMPLETE',
            payload: {
              coordinator: coordinatorResult,
              ai: aiResponse,
            },
          });

          this.persistence.persist({
            coordinatorResult,
            aiResponse,
            durationMs: Date.now() - startedAt,
          });

          clearInterval(heartbeat);
          subscriber.complete();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown pipeline error';
          this.logger.error(
            `SSE pipeline failure | coin=${coin} | timeframe=${timeframe} | message=${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          emit({ status: 'ERROR', error: message });

          if (coordinatorResult) {
            this.persistence.persist({
              coordinatorResult,
              aiResponse: null,
              durationMs: Date.now() - startedAt,
              errorMessage: message,
            });
          } else {
            this.persistence.persistError({
              symbol: coin,
              timeframe,
              durationMs: Date.now() - startedAt,
              errorMessage: message,
            });
          }

          clearInterval(heartbeat);
          subscriber.complete();
        }
      };

      void run();

      // Teardown — fired if the client disconnects mid-stream.
      return () => {
        cancelled = true;
        clearInterval(heartbeat);
        this.logger.debug(
          `SSE stream cancelled by client | coin=${coin} | timeframe=${timeframe}`,
        );
      };
    });
  }

  /**
   * Non-streaming variant of the SSE pipeline. Runs the full coordinator
   * + AI flow synchronously and returns a single JSON payload. Suitable
   * for server-side callers (RSC, cron jobs, background workers) that
   * don't need progress events.
   *
   * Persistence is fire-and-forget, identical to the SSE path.
   */
  @Post('coordinate')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Run analysis pipeline synchronously (non-streaming)',
    description:
      'Executes the same fetch → regime → strategy route → AI pipeline as the ' +
      'SSE endpoint and returns the final result as a single JSON response.',
  })
  @ApiBody({ type: StreamAnalysisQueryDto })
  @ApiResponse({ status: 200, description: 'Coordinator analysis completed.' })
  @ApiResponse({ status: 400, description: 'Invalid request body.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  @ApiResponse({ status: 500, description: 'Pipeline failure.' })
  async coordinateAnalysis(@Body() body: StreamAnalysisQueryDto): Promise<{
    success: true;
    data: {
      coordinator: CoordinatorAnalysisResult;
      ai: ClaudeAnalysisResponse | null;
      durationMs: number;
    };
  }> {
    const { coin, timeframe } = body;
    const startedAt = Date.now();
    let coordinatorResult: CoordinatorAnalysisResult | null = null;

    try {
      const candles = await this.binanceService.getCandles(
        coin,
        timeframe,
        ANALYSIS_CANDLE_LIMIT,
      );
      const context = this.indicatorsService.buildContext(
        coin,
        timeframe,
        candles,
      );
      const regimeResult =
        this.marketRegimeService.classifyFromContext(context);

      coordinatorResult = this.coordinator.routeFromRegime(
        context,
        timeframe,
        regimeResult,
      );

      let aiResponse: ClaudeAnalysisResponse | null = null;
      if (coordinatorResult.shouldInvokeAI) {
        aiResponse =
          await this.claudeService.analyzeWithChecklist(coordinatorResult);
      }

      const durationMs = Date.now() - startedAt;
      this.persistence.persist({
        coordinatorResult,
        aiResponse,
        durationMs,
      });

      return {
        success: true,
        data: { coordinator: coordinatorResult, ai: aiResponse, durationMs },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown pipeline error';
      this.logger.error(
        `POST /coordinate failure | coin=${coin} | timeframe=${timeframe} | message=${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      const durationMs = Date.now() - startedAt;
      if (coordinatorResult) {
        this.persistence.persist({
          coordinatorResult,
          aiResponse: null,
          durationMs,
          errorMessage: message,
        });
      } else {
        this.persistence.persistError({
          symbol: coin,
          timeframe,
          durationMs,
          errorMessage: message,
        });
      }

      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
