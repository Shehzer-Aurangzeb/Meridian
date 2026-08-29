import type { AnalysisListItem } from '@/types/analyses';

/**
 * Where an analysis stands, in the groups the scoreboard shows.
 *
 * The BACKEND decides which bucket a row is in — it arrives on `status.bucket`
 * and in the stats response. This file only names them, so the card and the
 * scoreboard cannot disagree about the same row.
 */
export type Bucket =
  | 'openUp'
  | 'openDown'
  | 'wonClosed'
  | 'lostClosed'
  | 'neverStarted'
  | 'tooEarly'
  /** Held the full window, no target and no stop. Its own group because the R
   *  is a MARK, not a realised exit. */
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

/** Was this built before the planner boundary? Shown, but left out of totals. */
export function isPreEpoch(row: AnalysisListItem, epoch: string | undefined): boolean {
  return epoch !== undefined && Date.parse(row.createdAt) < Date.parse(epoch);
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
