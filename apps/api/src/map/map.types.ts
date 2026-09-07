/**
 * The wire shape of the market map.
 *
 * ─── Two rules the TYPES enforce, not just the docs ──────────────────────
 *
 * 1. Every probability is `Calibrated | null`. There is no bare `number`
 *    anywhere a probability could go, so a field cannot be populated without
 *    also carrying its `n` and the date its table was fitted.
 *
 * 2. A null carries a REASON. `zoneBounce: null` on its own invites a client
 *    to render "—" and move on; `{ value: null, reason: "..." }` makes the
 *    absence legible, and it is the honest answer to "why is there no number
 *    here" without the reader having to find an evidence document.
 *
 * What is null today, and why:
 *   zone bounce   Layer 2, Brier worse than the base rate. All twelve bucket
 *                 keys predicted within 3.7 points of each other, so the
 *                 forecast was honest and carried no information.
 *   regime exit   Layer 2, ECE 5.06 against a bar of 5.00, driven by trends
 *                 being markedly less persistent in the holdout than in
 *                 training.
 *   unwind lift   Layer 3, conditional 11.7% against an 11.1% base rate.
 */

/** A number that earned the right to be called a probability. */
export interface Calibrated {
  value: number;
  /** Observations behind it. Never omitted, never zero when `value` is set. */
  n: number;
  ci95?: [number, number];
  /** When the table this came from was fitted. Calibration decays. */
  fittedAt: string;
}

/** A probability that is not published, and the reason it is not. */
export interface Withheld {
  value: null;
  reason: string;
  /** Where the decision is recorded, so the reason is checkable. */
  evidence: string;
}

export type Probability = Calibrated | Withheld;

export interface ConeBand {
  /** Fractions, not percents: 0.0062 is 62 bp. */
  p50: number;
  p80: number;
  p90: number;
  /** Measured coverage of each band on the holdout, as a share. */
  coverage: { p50: number; p80: number; p90: number };
}

export interface ExpectedMoveOut {
  /** Keyed by horizon in hours. */
  horizons: Record<number, ConeBand>;
  calibrated: true;
  fittedAt: string;
  note: string;
}

export interface RegimeOut {
  state: 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';
  ageHours: number;
  /** True when the age ran to the edge of the data and may be longer. */
  ageTruncated: boolean;
  reason: string;
  exitWithin24h: Probability;
}

export interface ZoneOut {
  low: number;
  high: number;
  center: number;
  type: 'support' | 'resistance';
  sources: string[];
  distancePercent: number;
  spanPercent: number;
  bounceWithin4h: Probability;
  /** Null when the zone sits beyond the archive's +-5% reach. */
  shell: number | null;
}

export interface LiquidityOut {
  shells: Array<{
    shell: number;
    bidNotional: number;
    askNotional: number;
    bidPercentile: number;
    askPercentile: number;
  }>;
  imbalance: number | null;
  coverage: string;
  asOf: string | null;
}

export interface CrowdingOut {
  fundingPercentile: number | null;
  oiChange24h: number | null;
  score: number | null;
  components: string[];
  note: string;
}

export interface MarketMap {
  symbol: string;
  asOf: string;
  spot: number;
  expectedMove: ExpectedMoveOut | null;
  regime: RegimeOut | null;
  zones: ZoneOut[];
  liquidity: LiquidityOut | null;
  crowding: CrowdingOut | null;
  /** Everything this map does NOT claim, carried with the map itself. */
  disclaimers: string[];
}

export interface ConditionQuery {
  fundingPercentileMin?: number;
  oiChange24hMin?: number;
  percentBMin?: number;
  percentBMax?: number;
  horizonHours?: number;
}

export interface ConditionResult {
  matches: number;
  blocks: number;
  firstMatch: string | null;
  lastMatch: string | null;
  outcomes: {
    absMove: { p50: number; p90: number } | null;
    adverse5pct: { rate: number; baseRate: number } | null;
    direction: { up: number; down: number } | null;
    medianOiChange: number | null;
  } | null;
  /**
   * Set when the matches are too few or too clustered to read.
   *
   * The magnitude gate produced a bootstrap interval of [2.62, 2.62] from 17
   * trades inside a single 30-day block — zero width, resampling one month
   * against itself, and it looked exactly like certainty. This field exists so
   * a caller cannot repeat that.
   */
  warning: string | null;
}
