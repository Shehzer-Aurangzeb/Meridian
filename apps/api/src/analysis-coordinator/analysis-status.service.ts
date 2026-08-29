import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { AnalysisRecord } from './analyze.service';
import { analysisFreshness, Freshness } from './freshness';
import { PlanOutcome, PlanResult } from './outcome';
import { leadPlan } from './verdict';
import { Bucket, bucketOf } from './buckets';

/** A stored result, as it comes back out of JSONB — filledAt is a string, not a Date. */
export type StoredResult = Omit<PlanResult, 'filledAt'> & { filledAt: string | null };

/** Where one analysis stands, for a history card. */
export interface AnalysisStatus {
  direction: 'long' | 'short' | null;
  outcome: PlanOutcome | null;
  /** Result in R before fees. */
  r: number | null;
  /** Result in R after fees. This is the one the scoreboard adds up. */
  netR: number | null;
  freshness: Freshness;
  filledAt: string | null;
  targetsHit: number;
  /** Which scoreboard group this row belongs to. Decided here so the card and
   *  the scoreboard can never put the same row in two places. */
  bucket: Bucket;
  currentPrice: number;
  /** When the outcome was worked out. An OPEN trade's netR is only as fresh as this. */
  scoredAt: string | null;
  /** Just the prices a card draws. */
  plan: {
    entries: number[];
    averageEntry: number;
    stop: number;
    targets: number[];
    riskPercent: number;
    blendedR: number;
  } | null;
}

/** The row shape this service needs. */
export interface StatusRow {
  id: string;
  symbol: string;
  createdAt: Date;
  coordinatorPayload: unknown;
  outcomePayload: unknown;
  scoredAt: Date | null;
}

/** Nothing has scored this plan yet. Not a verdict — an absence of one. */
export const NOT_SCORED = (direction: 'long' | 'short'): StoredResult => ({
  direction,
  outcome: 'UNSCOREABLE',
  r: null,
  netR: null,
  filledAt: null,
  targetsHit: 0,
  legsFilled: 0,
  filledFraction: 0,
  barsHeld: 0,
});

/** Read the stored results off a row, or null if there are none to trust. */
export function storedResults(payload: unknown, plans: TradePlan[]): StoredResult[] | null {
  return Array.isArray(payload) && payload.length === plans.length
    ? (payload as StoredResult[])
    : null;
}

/** One result per plan, in plan order. Falls back to "not scored" for every plan. */
export function resultsFor(payload: unknown, plans: TradePlan[]): StoredResult[] {
  return storedResults(payload, plans) ?? plans.map((p) => NOT_SCORED(p.direction));
}

/**
 * Turns saved rows into what a card shows.
 *
 * Fetches NO candles. The outcome was scored once by OutcomeScorerService and
 * stored; only freshness is worked out here, because it depends on the price
 * right now — and that is one lookup per coin, not one per row.
 */
@Injectable()
export class AnalysisStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly binance: BinanceService,
  ) {}

  /**
   * Live price and the newest analysis, once per coin rather than once per row.
   *
   * `excludeId` is what the detail page passes: without it an analysis is
   * compared against itself and can never read as superseded.
   */
  async perSymbol(symbols: string[], excludeId?: string) {
    return new Map(
      await Promise.all(
        symbols.map(async (coin) => {
          // A dead exchange must not take the page down — the row still shows.
          const [price, newest] = await Promise.all([
            this.binance.getCurrentPrice(coin).catch(() => NaN),
            this.prisma.coordinatorRun.findFirst({
              where: { symbol: coin, ...(excludeId ? { id: { not: excludeId } } : {}) },
              orderBy: { createdAt: 'desc' },
              select: { coordinatorPayload: true },
            }),
          ]);
          return [coin, { price, newest }] as const;
        }),
      ),
    );
  }

  async build(rows: StatusRow[], excludeId?: string): Promise<Map<string, AnalysisStatus>> {
    const perSymbol = await this.perSymbol([...new Set(rows.map((r) => r.symbol))], excludeId);
    const out = new Map<string, AnalysisStatus>();

    for (const row of rows) {
      const analysis = row.coordinatorPayload as AnalysisRecord | null;
      const shared = perSymbol.get(row.symbol);
      if (!analysis?.plans || !analysis?.map || !shared) continue;

      const newest = shared.newest?.coordinatorPayload as AnalysisRecord | undefined;
      const freshness = analysisFreshness(
        analysis,
        shared.price,
        newest?.map ? { map: newest.map } : null,
      );

      const base = {
        freshness,
        currentPrice: shared.price,
        scoredAt: row.scoredAt?.toISOString() ?? null,
      };

      // No zone was close enough to build a plan from, so there is nothing to score.
      const lead = leadPlan(analysis.plans);
      if (!lead) {
        out.set(row.id, {
          ...base,
          direction: null,
          outcome: null,
          r: null,
          netR: null,
          filledAt: null,
          targetsHit: 0,
          bucket: bucketOf(null, null),
          plan: null,
        });
        continue;
      }

      // The card shows one line, so only the lead plan's result.
      const stored = storedResults(row.outcomePayload, analysis.plans);
      const scored = stored?.[analysis.plans.indexOf(lead)] ?? NOT_SCORED(lead.direction);

      out.set(row.id, {
        ...base,
        direction: scored.direction,
        outcome: scored.outcome,
        r: scored.r,
        // Straight from the scorer. Recomputing it here is how the card and the
        // scoreboard once showed two different numbers.
        netR: scored.netR,
        filledAt: scored.filledAt,
        targetsHit: scored.targetsHit,
        bucket: bucketOf(scored.outcome, scored.netR),
        plan: {
          entries: lead.entries.map((e) => e.price),
          averageEntry: lead.averageEntry,
          stop: lead.stop,
          targets: lead.targets.map((t) => t.price),
          riskPercent: lead.riskPercent,
          blendedR: lead.blendedR,
        },
      });
    }
    return out;
  }
}
