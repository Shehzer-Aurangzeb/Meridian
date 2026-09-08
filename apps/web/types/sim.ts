import type { MarketMap } from './map';

export type SimOutcome =
  | 'PENDING'
  | 'MISSED'
  | 'OPEN'
  | 'STOPPED'
  | 'PARTIAL'
  | 'ALL_TARGETS'
  | 'EXPIRED'
  | 'UNSCOREABLE';

export interface SimTarget {
  price: number;
  weightPercent: number;
}

export interface SimTrade {
  id: string;
  batchId: string;
  symbol: string;
  verdict: 'TAKE' | 'SKIP';
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  targets: SimTarget[];
  rationale: string | null;
  mapSnapshot: MarketMap;
  spotAtDecision: number;
  usedOutsideData: boolean;
  decidedAt: string;
  /** Null until the 96-hour window closes. Never zero for an unfinished trade. */
  outcome: SimOutcome | null;
  grossR: number | null;
  netR: number | null;
  targetsHit: number | null;
  barsHeld: number | null;
  filledAt: string | null;
  scoredAt: string | null;
}

export interface SimList {
  rows: SimTrade[];
  nextCursor: string | null;
}

export interface Arm {
  n: number;
  netR: number | null;
  wins: number;
}

export interface SimStats {
  batches: number;
  trades: number;
  resolved: number;
  pending: number;
  take: Arm;
  skip: Arm;
  delta: { point: number; lo: number; hi: number; blocks: number } | null;
  warning: string | null;
}
