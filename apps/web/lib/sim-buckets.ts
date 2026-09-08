import type { SimTrade } from '@/types/sim';

export const SCORING_WINDOW_HOURS = 96;

/**
 * Where a recorded call stands.
 *
 * `waiting` is its own group and never folded into a result. A trade still
 * inside its window has no verdict, and an empty state that reads like a loss
 * is the same mistake as scoring an open position at zero — which is how one
 * result in this project's history read -0.106R instead of -0.202R.
 */
export type Bucket = 'won' | 'lost' | 'noVerdict' | 'neverFilled' | 'waiting';

export const BUCKET_LABEL: Record<Bucket, string> = {
  won: 'Made money',
  lost: 'Lost money',
  noVerdict: 'Ran out of time',
  neverFilled: 'Never started',
  waiting: 'Still running',
};

export const BUCKET_TONE: Record<Bucket, string> = {
  won: 'text-green',
  lost: 'text-rust',
  noVerdict: 'text-text-secondary',
  neverFilled: 'text-text-tertiary',
  waiting: 'text-text-tertiary',
};

/** What the outcome is called on a card, in the reader's words. */
export const OUTCOME_LABEL: Record<string, string> = {
  ALL_TARGETS: 'Reached every target',
  PARTIAL: 'Took some profit, then stopped',
  STOPPED: 'Stopped out',
  MISSED: 'Price never reached the entry',
  EXPIRED: 'Held the full time without resolving',
  OPEN: 'Still open',
  PENDING: 'Waiting to start',
  UNSCOREABLE: 'Could not be scored',
};

export function bucketOf(row: SimTrade): Bucket {
  if (row.outcome === null || row.netR === null) return 'waiting';
  switch (row.outcome) {
    case 'MISSED':
      return 'neverFilled';
    case 'EXPIRED':
      return 'noVerdict';
    case 'STOPPED':
    case 'PARTIAL':
    case 'ALL_TARGETS':
      return row.netR > 0 ? 'won' : 'lost';
    default:
      return 'waiting';
  }
}

export const FILTERABLE: Bucket[] = ['won', 'lost', 'noVerdict', 'neverFilled', 'waiting'];

/** Hours until a call can be scored, or null once its window has closed. */
export function hoursRemaining(row: SimTrade, now = Date.now()): number | null {
  const closes = Date.parse(row.decidedAt) + SCORING_WINDOW_HOURS * 3_600_000;
  const left = (closes - now) / 3_600_000;
  return left > 0 ? Math.ceil(left) : null;
}

export interface Batch {
  batchId: string;
  decidedAt: string;
  rows: SimTrade[];
  takes: number;
  passes: number;
  resolved: number;
}

/** Newest batch first, and coins within a batch in the order they were asked. */
export function groupByBatch(rows: SimTrade[]): Batch[] {
  const byId = new Map<string, SimTrade[]>();
  for (const row of rows) {
    const cell = byId.get(row.batchId);
    if (cell) cell.push(row);
    else byId.set(row.batchId, [row]);
  }

  return Array.from(byId.entries())
    .map(([batchId, group]) => {
      const sorted = [...group].sort(
        (a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt),
      );
      return {
        batchId,
        decidedAt: sorted[0].decidedAt,
        rows: sorted,
        takes: sorted.filter((r) => r.verdict === 'TAKE').length,
        passes: sorted.filter((r) => r.verdict === 'SKIP').length,
        resolved: sorted.filter((r) => bucketOf(r) !== 'waiting').length,
      };
    })
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
}
