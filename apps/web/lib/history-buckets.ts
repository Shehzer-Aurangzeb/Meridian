import type { AnalysisListItem, AnalysisStatus } from '@/types/analyses';

/**
 * Where an analysis stands, in the six buckets that answer "how is this
 * going" without opening anything.
 *
 * The win/lose split uses NET R, after the round-trip cost. Gross would flatter
 * every number on the page: §14h was +0.046R gross and −0.039R net, which is
 * the difference between "this works" and "this does not".
 */
export type Bucket =
  | 'openUp'
  | 'openDown'
  | 'wonClosed'
  | 'lostClosed'
  | 'neverStarted'
  | 'tooEarly'
  /**
   * Filled, held the full 72h, and never reached a target or the stop. Its own
   * bucket rather than won/lost by sign, because the R is a MARK, not a
   * realised exit — folding it into "closed, won" is the survivorship error
   * that made the live scoreboard read better than the backtest.
   */
  | 'expired'
  | 'unscored';

export const BUCKET_LABEL: Record<Bucket, string> = {
  openUp: 'Open, in profit',
  openDown: 'Open, in loss',
  wonClosed: 'Closed, won',
  lostClosed: 'Closed, lost',
  expired: 'Expired, no verdict',
  neverStarted: 'Never started',
  tooEarly: 'Too early',
  unscored: 'No plan',
};

export function bucketOf(status: AnalysisStatus | null | undefined): Bucket {
  if (!status?.outcome) return 'unscored';
  switch (status.outcome) {
    case 'PENDING':
      return 'tooEarly';
    case 'MISSED':
      return 'neverStarted';
    case 'OPEN':
      return (status.netR ?? 0) >= 0 ? 'openUp' : 'openDown';
    case 'STOPPED':
      return 'lostClosed';
    case 'ALL_TARGETS':
      return 'wonClosed';
    case 'PARTIAL':
      return (status.netR ?? 0) >= 0 ? 'wonClosed' : 'lostClosed';
    case 'EXPIRED':
      return 'expired';
    // No candles, no verdict. Counted nowhere visible, so it cannot flatter or
    // damage the split — it is absent, and absent is the honest reading.
    case 'UNSCOREABLE':
      return 'unscored';
    default:
      return 'unscored';
  }
}

export interface ResultsSummary {
  counts: Record<Bucket, number>;
  /** Sum of net R over everything that filled. */
  netR: number;
  total: number;
  filled: number;
  closed: number;
}

/**
 * The funnel matters as much as the split. "2 won, 1 lost" reads as a 67% win
 * rate; "2 won, 1 lost, 44 never started" is a different statement about the
 * tool, and it is the true one. Callers must show `total` and `filled`
 * alongside the buckets.
 */
export function summariseResults(rows: AnalysisListItem[]): ResultsSummary {
  const counts: Record<Bucket, number> = {
    openUp: 0,
    openDown: 0,
    wonClosed: 0,
    lostClosed: 0,
    expired: 0,
    neverStarted: 0,
    tooEarly: 0,
    unscored: 0,
  };
  let netR = 0;
  let filled = 0;
  let closed = 0;

  for (const row of rows) {
    const bucket = bucketOf(row.status);
    counts[bucket] += 1;
    if (row.status?.netR != null) {
      netR += row.status.netR;
      filled += 1;
      // Expired counts as closed — the position is over. It just has no verdict.
      if (bucket === 'wonClosed' || bucket === 'lostClosed' || bucket === 'expired') {
        closed += 1;
      }
    }
  }

  return { counts, netR, total: rows.length, filled, closed };
}

/** The buckets a status filter offers, in the order they read best. */
export const FILTERABLE_BUCKETS: Bucket[] = [
  'openUp',
  'openDown',
  'wonClosed',
  'lostClosed',
  'expired',
  'neverStarted',
  'tooEarly',
];
