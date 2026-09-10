import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, SimTrade } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import {
  SCORING_WINDOW_HOURS,
  MIN_AGE_HOURS,
  SimPlanInput,
  isTerminal,
  scoreSimTrade,
} from './sim.scoring';
import { SimStats, simStats } from './sim.stats';
import { SimTradeInput } from './sim.dto';

const HOUR_MS = 3_600_000;

/**
 * Records analyst calls and resolves them against real bars.
 *
 * Scoring happens on read rather than on a schedule: the EventBridge rule was
 * removed on 7 September and a journal at this volume does not justify bringing
 * one back. A row is scored ONCE, after its whole 96-hour window has elapsed.
 * Nothing scores a live position — an unfinished trade has no verdict, and a
 * number attached to one invites being totalled as though it did.
 */
@Injectable()
export class SimService {
  private readonly logger = new Logger(SimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
  ) {}

  async createBatch(trades: SimTradeInput[]): Promise<{ batchId: string; trades: number }> {
    const batchId = randomUUID();
    await this.prisma.simTrade.createMany({
      data: trades.map((t) => ({
        batchId,
        symbol: t.symbol,
        verdict: t.verdict,
        direction: t.direction,
        entry: t.entry,
        stop: t.stop,
        targets: t.targets as unknown as Prisma.InputJsonValue,
        rationale: t.rationale ?? null,
        mapSnapshot: t.mapSnapshot as Prisma.InputJsonValue,
        spotAtDecision: t.spotAtDecision,
        usedOutsideData: t.usedOutsideData ?? false,
        decidedAt: t.decidedAt ? new Date(t.decidedAt) : new Date(),
      })),
    });
    return { batchId, trades: trades.length };
  }

  /** The journal. Scores anything due first, so this read IS the scorer. */
  async list(take = 100, cursor?: string): Promise<{ rows: SimTrade[]; nextCursor: string | null }> {
    await this.scoreOutstanding();
    const limit = Math.min(Math.max(take, 1), 500);
    const rows = await this.prisma.simTrade.findMany({
      take: limit + 1,
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    return {
      rows: hasMore ? rows.slice(0, limit) : rows,
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  async findOne(id: string): Promise<SimTrade | null> {
    await this.scoreOutstanding();
    return this.prisma.simTrade.findUnique({ where: { id } });
  }

  async stats(): Promise<SimStats> {
    await this.scoreOutstanding();
    const rows = await this.prisma.simTrade.findMany({
      select: { verdict: true, netR: true, outcome: true, decidedAt: true, batchId: true },
    });
    return simStats(rows);
  }

  /**
   * Resolve every row whose window has closed. Returns how many were written.
   *
   * A row whose candles will not load keeps `scoredAt: null`, so a failed fetch
   * is retried on the next read rather than frozen as a verdict.
   */
  /**
   * Bring every unsettled row up to date with what the candles now show.
   *
   * This used to wait for the full 96-hour window before looking at anything.
   * That window is the WORST case — an entry filled in the last minute of the
   * 24-hour fill window, then held the full 72 — and applying it to every row
   * meant a trade stopped out at hour 4 sat unexamined for another 92, its
   * outcome already decided and unreadable. A row is now read as soon as there
   * are bars to read, and `scoreOne` still only marks it FINISHED when the
   * candles can no longer change the answer.
   */
  async scoreOutstanding(now = Date.now()): Promise<number> {
    const due = await this.prisma.simTrade.findMany({
      where: {
        scoredAt: null,
        decidedAt: { lte: new Date(now - MIN_AGE_HOURS * HOUR_MS) },
      },
      orderBy: { decidedAt: 'asc' },
    });

    let written = 0;
    for (const row of due) {
      const scored = await this.scoreOne(row, now);
      if (scored) written += 1;
    }
    if (written > 0) this.logger.log(`scored ${written} of ${due.length} due rows`);
    return written;
  }

  private async scoreOne(row: SimTrade, now: number): Promise<boolean> {
    const plan = toPlanInput(row);
    if (plan === null) {
      this.logger.warn(`${row.id}: unusable plan, left unscored`);
      return false;
    }

    let candles;
    try {
      candles = await this.binance.getCandlesFrom(
        row.symbol,
        '1h',
        row.decidedAt.getTime(),
        SCORING_WINDOW_HOURS + 2,
      );
    } catch (err) {
      this.logger.warn(`${row.symbol}: candles unavailable — ${(err as Error).message}`);
      return false;
    }

    const result = scoreSimTrade(plan, candles, row.decidedAt, now);
    if (result.outcome === 'UNSCOREABLE') {
      this.logger.warn(`${row.id}: history does not reach the decision, will retry`);
      return false;
    }

    await this.prisma.simTrade.update({
      where: { id: row.id },
      data: {
        outcome: result.outcome,
        grossR: result.grossR,
        netR: result.netR,
        targetsHit: result.targetsHit,
        barsHeld: result.barsHeld,
        filledAt: result.filledAt,
        scoredAt: isTerminal(result.outcome) ? new Date(now) : null,
      },
    });
    return true;
  }
}

/** Reads a stored row's plan back, or null if it cannot be scored at all. */
export function toPlanInput(row: SimTrade): SimPlanInput | null {
  if (row.direction !== 'long' && row.direction !== 'short') return null;
  if (!Number.isFinite(row.entry) || !Number.isFinite(row.stop)) return null;
  if (row.entry === row.stop) return null;

  const targets = Array.isArray(row.targets) ? row.targets : [];
  const parsed: Array<{ price: number; weightPercent: number }> = [];
  for (const t of targets) {
    if (typeof t !== 'object' || t === null) return null;
    const { price, weightPercent } = t as Record<string, unknown>;
    if (typeof price !== 'number' || typeof weightPercent !== 'number') return null;
    if (!Number.isFinite(price) || !Number.isFinite(weightPercent)) return null;
    parsed.push({ price, weightPercent });
  }

  return { direction: row.direction, entry: row.entry, stop: row.stop, targets: parsed };
}
