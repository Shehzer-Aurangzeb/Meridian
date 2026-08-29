import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { aggregate } from '../common/replay/trade-scoring';
import { Bucket, BUCKETS, bucketOf } from './buckets';

export interface AnalysesStats {
  counts: Record<Bucket, number>;
  /** Everything the counts describe. */
  total: number;
  /** Rows that opened, so they have an R at all. */
  filled: number;
  /** Positions that are over: won, lost, or expired. */
  closed: number;
  /**
   * Rows built by an older planner, left out of every number above. Reported,
   * because a total that silently covers fewer rows than the list below it is
   * the same lie as hiding the rows.
   */
  excluded: number;
  /** Both marking conventions, never one silently. */
  netR: {
    /** Every filled trade, open ones valued where they sit. */
    marked: number;
    /** Trades that actually finished. Open and expired ones left out. */
    resolved: number;
    nResolved: number;
    /** How much of `marked` depends on valuing unfinished trades. */
    markingGap: number;
  };
  from: string;
  epoch: string;
}

/** Only these two are a MARK rather than a realised exit. */
const MARKED = new Set(['OPEN', 'EXPIRED']);

@Injectable()
export class AnalysisStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The scoreboard. Two narrow columns for every row in the window — no
   * payloads, no candles — then counted here.
   */
  async build(
    where: Prisma.CoordinatorRunWhereInput,
    epoch: Date,
    from: Date,
  ): Promise<AnalysesStats> {
    const rows = await this.prisma.coordinatorRun.findMany({
      where,
      select: { createdAt: true, outcome: true, netR: true },
    });

    const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
    let filled = 0;
    let closed = 0;
    let excluded = 0;
    const scored: Array<{ status: string; netR: number }> = [];

    for (const row of rows) {
      if (row.createdAt < epoch) {
        excluded += 1;
        continue;
      }
      const bucket = bucketOf(row.outcome, row.netR);
      counts[bucket] += 1;
      if (row.netR === null) continue;

      filled += 1;
      if (bucket === 'wonClosed' || bucket === 'lostClosed' || bucket === 'expired') closed += 1;
      // `aggregate` calls a row unresolved when its status is TIMEOUT, which is
      // the backtest's name for what the live scorer calls OPEN and EXPIRED.
      scored.push({
        status: MARKED.has(row.outcome ?? '') ? 'TIMEOUT' : (row.outcome as string),
        netR: row.netR,
      });
    }

    // The same function the backtest quotes. There is no second definition of
    // netR here, and there must never be one.
    const agg = aggregate(scored);

    return {
      counts,
      total: rows.length - excluded,
      filled,
      closed,
      excluded,
      netR: {
        marked: agg.totalR,
        resolved: agg.nResolved === 0 ? 0 : agg.expectancyResolved * agg.nResolved,
        nResolved: agg.nResolved,
        markingGap: Number.isNaN(agg.markingGap) ? 0 : agg.markingGap,
      },
      from: from.toISOString(),
      epoch: epoch.toISOString(),
    };
  }
}
