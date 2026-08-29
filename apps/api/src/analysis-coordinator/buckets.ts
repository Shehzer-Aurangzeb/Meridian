import { Prisma } from '@prisma/client';

/**
 * Where an analysis stands, in the groups the scoreboard shows.
 *
 * Won or lost is decided AFTER fees. Before fees the same trades can look
 * profitable while actually losing money.
 */
export type Bucket =
  | 'openUp'
  | 'openDown'
  | 'wonClosed'
  | 'lostClosed'
  /** Held the full window, never reached a target or the stop. Its own bucket
   *  because the R is a MARK, not a realised exit. */
  | 'expired'
  | 'neverStarted'
  | 'tooEarly'
  | 'unscored';

export const BUCKETS: Bucket[] = [
  'openUp',
  'openDown',
  'wonClosed',
  'lostClosed',
  'expired',
  'neverStarted',
  'tooEarly',
  'unscored',
];

/** Which bucket one row falls in. THE definition — `bucketWhere` must match it. */
export function bucketOf(outcome: string | null, netR: number | null): Bucket {
  switch (outcome) {
    case 'PENDING':
      return 'tooEarly';
    case 'MISSED':
      return 'neverStarted';
    case 'OPEN':
      return (netR ?? 0) >= 0 ? 'openUp' : 'openDown';
    case 'STOPPED':
      return 'lostClosed';
    case 'ALL_TARGETS':
      return 'wonClosed';
    case 'PARTIAL':
      return (netR ?? 0) >= 0 ? 'wonClosed' : 'lostClosed';
    case 'EXPIRED':
      return 'expired';
    // No plan, or no candles. Counted nowhere visible, so it can neither
    // flatter nor damage the split.
    default:
      return 'unscored';
  }
}

/** The same rule as SQL, so the list can filter by bucket without loading rows. */
export function bucketWhere(bucket: Bucket): Prisma.CoordinatorRunWhereInput {
  const netRAtLeastZero = [{ netR: { gte: 0 } }, { netR: null }];
  switch (bucket) {
    case 'tooEarly':
      return { outcome: 'PENDING' };
    case 'neverStarted':
      return { outcome: 'MISSED' };
    case 'openUp':
      return { outcome: 'OPEN', OR: netRAtLeastZero };
    case 'openDown':
      return { outcome: 'OPEN', netR: { lt: 0 } };
    case 'lostClosed':
      return {
        OR: [{ outcome: 'STOPPED' }, { outcome: 'PARTIAL', netR: { lt: 0 } }],
      };
    case 'wonClosed':
      return {
        OR: [{ outcome: 'ALL_TARGETS' }, { outcome: 'PARTIAL', OR: netRAtLeastZero }],
      };
    case 'expired':
      return { outcome: 'EXPIRED' };
    case 'unscored':
      return { OR: [{ outcome: null }, { outcome: 'UNSCOREABLE' }] };
  }
}
