import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { AnalysisRecord } from './analyze.service';
import {
  isTerminalOutcome,
  OUTCOME_WINDOW_HOURS,
  PlanResult,
  scorePlans,
} from './outcome';
import { leadPlan } from './verdict';

/**
 * Scores saved analyses once and writes the result to the row.
 *
 * Two rules:
 *   1. A terminal outcome is never re-scored. Its candles are already past.
 *   2. `scoredAt` null means "score me" — including a row whose candles would
 *      not load, so a network failure is retried, not frozen as a verdict.
 */

/** Hourly bars from the analysis, plus two for the part-formed hour at each end. */
const OUTCOME_TIMEFRAME: TimeInterval = '1h';
const OUTCOME_CANDLES = OUTCOME_WINDOW_HOURS + 2;

/** Rows fetched at once. 8 stays comfortably inside Binance's weight budget. */
const FETCH_CONCURRENCY = 8;

/** What one row needs before it can be scored. */
type Scorable = {
  id: string;
  symbol: string;
  createdAt: Date;
  coordinatorPayload: unknown;
  outcome: string | null;
  scoredAt: Date | null;
};

export interface ScoreRunResult {
  /** Rows the query handed us. */
  considered: number;
  /** Rows written with a real outcome. */
  scored: number;
  /** Rows settled without fetching anything, because they build no plan. */
  noPlan: number;
  /** Rows whose candles could not be loaded. Left unsettled, so retried. */
  unscoreable: number;
  /** Candle windows actually fetched. */
  candleFetches: number;
  ms: number;
}

/**
 * The columns written for one row. The scalars are a PROJECTION of
 * `outcomePayload` — the lead plan's fields lifted out of it, never a second
 * computation of netR.
 */
export function outcomeColumns(
  plans: AnalysisRecord['plans'],
  results: PlanResult[],
  scoredAt: Date | null,
): Prisma.CoordinatorRunUpdateInput {
  const lead = leadPlan(plans);
  const result = lead ? results[plans.indexOf(lead)] : undefined;

  return {
    // Dates become ISO strings in JSONB. Read paths only pass them back out.
    outcomePayload: results as unknown as Prisma.InputJsonValue,
    scoredAt,
    outcome: result?.outcome ?? null,
    outcomeDirection: result?.direction ?? null,
    grossR: result?.r ?? null,
    netR: result?.netR ?? null,
    targetsHit: result?.targetsHit ?? null,
    entryFilledAt: result?.filledAt ?? null,
  };
}

@Injectable()
export class OutcomeScorerService {
  private readonly logger = new Logger(OutcomeScorerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
  ) {}

  /**
   * Score every row that can still move, plus every row never scored.
   * `ids` narrows it to specific rows — used right after an analysis is saved.
   */
  async scoreUnresolved(options: { ids?: string[]; now?: number } = {}): Promise<ScoreRunResult> {
    const started = Date.now();
    const now = options.now ?? started;

    const rows = (await this.prisma.coordinatorRun.findMany({
      where: {
        ...(options.ids ? { id: { in: options.ids } } : {}),
        // Unsettled, or still moving. A terminal row matches neither arm,
        // which is what makes this cheap.
        OR: [{ scoredAt: null }, { outcome: { in: ['PENDING', 'OPEN'] } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        symbol: true,
        createdAt: true,
        coordinatorPayload: true,
        outcome: true,
        scoredAt: true,
      },
    })) as Scorable[];

    return this.score(rows, now, started);
  }

  /** Score EVERY row, terminal included. The backfill — the only caller allowed past the guard. */
  async scoreAll(options: { now?: number } = {}): Promise<ScoreRunResult> {
    const started = Date.now();
    const rows = (await this.prisma.coordinatorRun.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        symbol: true,
        createdAt: true,
        coordinatorPayload: true,
        outcome: true,
        scoredAt: true,
      },
    })) as Scorable[];

    return this.score(rows, options.now ?? started, started, { allowTerminal: true });
  }

  private async score(
    rows: Scorable[],
    now: number,
    started: number,
    options: { allowTerminal?: boolean } = {},
  ): Promise<ScoreRunResult> {
    const out: ScoreRunResult = {
      considered: rows.length,
      scored: 0,
      noPlan: 0,
      unscoreable: 0,
      candleFetches: 0,
      ms: 0,
    };

    // A settled terminal row here means the query lost its filter. That bug is
    // silent — it still works, just slow again — so fail loudly instead.
    if (!options.allowTerminal) {
      const frozen = rows.filter((r) => r.scoredAt !== null && isTerminalOutcome(r.outcome));
      if (frozen.length > 0) {
        throw new Error(
          `Refusing to re-score ${frozen.length} terminal row(s) — ` +
            `e.g. ${frozen[0].id} is ${frozen[0].outcome}, settled ${frozen[0].scoredAt?.toISOString()}. ` +
            `A terminal outcome cannot change; something dropped the query filter.`,
        );
      }
    }

    // No plan means nothing to score, so no candles are fetched. 145 of 603
    // rows in production.
    const needCandles: Scorable[] = [];
    const noPlan: string[] = [];
    for (const row of rows) {
      const analysis = row.coordinatorPayload as AnalysisRecord | null;
      if (!analysis?.plans || analysis.plans.length === 0 || !leadPlan(analysis.plans)) {
        noPlan.push(row.id);
        continue;
      }
      needCandles.push(row);
    }
    if (noPlan.length > 0) {
      // All the same values, so one statement.
      await this.prisma.coordinatorRun.updateMany({
        where: { id: { in: noPlan } },
        data: outcomeColumns([], [], new Date(now)) as Prisma.CoordinatorRunUpdateManyMutationInput,
      });
      out.noPlan = noPlan.length;
    }

    for (let i = 0; i < needCandles.length; i += FETCH_CONCURRENCY) {
      const batch = needCandles.slice(i, i + FETCH_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (row) => {
          const candles = await this.binance
            .getCandlesFrom(row.symbol, OUTCOME_TIMEFRAME, row.createdAt.getTime(), OUTCOME_CANDLES)
            .catch(() => [] as Candle[]);
          return [row, candles] as const;
        }),
      );
      out.candleFetches += fetched.length;

      for (const [row, candles] of fetched) {
        const analysis = row.coordinatorPayload as AnalysisRecord;
        // Strictly after the analysis: the hour in progress when it was taken
        // must not open the trade after the fact.
        const results = scorePlans(
          analysis.plans,
          candles.filter((c) => c.time.getTime() > row.createdAt.getTime()),
          row.createdAt,
          now,
        );

        // Failed fetch: keep the badge honest, but leave `scoredAt` null so
        // the next run tries again.
        const failed = results.every((r) => r.outcome === 'UNSCOREABLE');
        if (failed) out.unscoreable += 1;
        else out.scored += 1;

        await this.prisma.coordinatorRun.update({
          where: { id: row.id },
          data: outcomeColumns(analysis.plans, results, failed ? null : new Date(now)),
        });
      }
    }

    out.ms = Date.now() - started;
    this.logger.log(JSON.stringify(out));
    return out;
  }
}
