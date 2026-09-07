import { Timeframe } from '../../common/constants/timeframes';

/**
 * A detected support or resistance level
 */
export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  // `strength`, a 1-5 score, was removed on 5 Sept 2026. It was an assigned
  // number wearing the clothes of a measured one, and it is the construct that
  // produced this project's worst production defect: thresholds named
  // MIN_TESTS were compared against it, so "minimum 3 touches" silently meant
  // "score of at least 3" for ~14% of levels. Zone confidence is a MEASURED
  // frequency from now on and is attached downstream, not computed here.
  // See docs/PRODUCT_LAYERS.md Layer 2.
  timeframe: Timeframe;
  lastTested: Date;
  held: boolean; // Did it hold or break?
  distancePercent: number; // Distance from current price
  touchCount: number; // Raw number of touches
}

/**
 * A swing point used for S/R detection
 */
export interface SRSwingPoint {
  price: number;
  type: 'high' | 'low';
  index: number;
  timestamp: Date;
}

/**
 * Clustered level from multiple nearby swing points
 */
export interface ClusteredLevel {
  price: number; // Average/median price of cluster
  type: 'support' | 'resistance';
  points: SRSwingPoint[];
  count: number; // Number of points in cluster
  priceRange: {
    min: number;
    max: number;
  };
}

/**
 * One Fibonacci level. Quarters of the range, not the more common ratios, and
 * labelled by where they sit in that range rather than by where price is now
 * — so the marks stay put as price moves.
 */
export interface FibLevel {
  ratio: number; // 0 | 0.25 | 0.5 | 0.75 | 1
  price: number;
  type: 'support' | 'resistance';
}

/**
 * Options for S/R detection
 */
export interface SRDetectionOptions {
  clusterThreshold?: number; // Percentage for clustering (default 0.5%)
  minTouches?: number; // Minimum touches to be considered (default 2)
  maxLevels?: number; // Maximum levels to return (default 10)
  lookbackCandles?: number; // How many candles to analyze (default 100)
}

/**
 * Constants for S/R detection
 */
export const SR_DEFAULTS = {
  CLUSTER_THRESHOLD: 0.5, // 0.5% price range for clustering
  MIN_TOUCHES: 2,
  MAX_LEVELS: 10,
  // LOOKBACK_CANDLES lived here and governed nothing. `SupportResistanceService`
  // never read it — it scans every candle handed in, and the window is chosen by
  // the CALLER via `CANDLE_LIMITS`. The one script that read it now owns it.
  SWING_LOOKBACK: 2, // Bars to look back/forward for swing detection
  // STRENGTH_THRESHOLDS went with the 1-5 score it fed. See SupportResistanceLevel.
} as const;

/**
 * A price mark from any source, ready to be tested for confluence.
 * `source` is what gets shown to the user, so it must name its origin.
 */
export interface MarkedLevel {
  price: number;
  type: 'support' | 'resistance';
  source: string; // '0.5 Fib (12h)', '4h swing x3'
  touchCount?: number;
}

/**
 * A price band where several levels, found in different ways, land within
 * about half a percent of each other. A single level is not a zone, which is
 * why every contributor is listed.
 */
export interface ConfluenceZone {
  low: number;
  high: number;
  center: number;
  type: 'support' | 'resistance';
  sources: string[];
  spanPercent: number;
  /** Signed: negative = zone is below spot. */
  distancePercent: number;
}
