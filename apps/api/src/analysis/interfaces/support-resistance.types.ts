import { Timeframe, TIMEFRAMES } from '../../common/constants/timeframes';

/**
 * A detected support or resistance level
 */
export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // 1-5, how many times tested
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
  LOOKBACK_CANDLES: 100,
  SWING_LOOKBACK: 2, // Bars to look back/forward for swing detection
  STRENGTH_THRESHOLDS: {
    WEAK: 2,
    MODERATE: 3,
    STRONG: 4,
    VERY_STRONG: 5,
  },
} as const;

/**
 * Which band of charts a level came from.
 *
 * A weekly level is where positions were built and defended over months; a
 * 15-minute level is where price paused for an hour. Pooling them as equal
 * votes in one price cluster is what made seven charts measure worse than
 * three (CHARTS_AB.md), so the tier travels with the level from here on.
 */
export type ZoneTier = 'HTF' | 'MID' | 'LTF';

/** Slowest first. Used to reduce a zone's marks to the zone's own tier. */
export const TIER_ORDER: ZoneTier[] = ['HTF', 'MID', 'LTF'];

/**
 * A price mark from any source, ready to be tested for confluence.
 * `source` is what gets shown to the user, so it must name its origin.
 */
export interface MarkedLevel {
  price: number;
  type: 'support' | 'resistance';
  source: string; // '0.5 Fib (12h)', '4h swing x3'
  touchCount?: number;
  tier: ZoneTier;
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
  /**
   * The SLOWEST tier that contributed a mark. A zone touched by a 12h swing
   * and a 15m swing is an HTF zone — the weekly structure is what is being
   * traded and the 15m mark is corroboration, not the subject.
   */
  tier: ZoneTier;
}

/**
 * Which band each chart belongs to.
 *
 * Only HTF zones are tradeable and only HTF zones are targets — see
 * TradePlanService. MID and LTF levels are still found and still marked; they
 * corroborate an HTF zone, they do not create one.
 */
export const TIER_CHARTS: Record<ZoneTier, Timeframe[]> = {
  HTF: [TIMEFRAMES.WEEKLY, TIMEFRAMES.DAILY, TIMEFRAMES.TWELVE_HOUR],
  MID: [TIMEFRAMES.FOUR_HOUR, TIMEFRAMES.ONE_HOUR],
  LTF: [TIMEFRAMES.THIRTY_MIN, TIMEFRAMES.FIFTEEN_MIN],
};

export function tierOf(timeframe: Timeframe): ZoneTier {
  const tier = (Object.keys(TIER_CHARTS) as ZoneTier[]).find((tr) =>
    TIER_CHARTS[tr].includes(timeframe),
  );
  if (!tier) throw new Error(`No tier for ${timeframe}; add it to TIER_CHARTS`);
  return tier;
}

/**
 * Which chart's volatility sets the stop for a zone of each tier.
 *
 * The FASTEST chart in the tier, and that is a choice worth stating. Measured
 * 27 Aug across BTC/ETH/SOL, ATR as a share of price: 1w 10.3%, 1d 3.7%,
 * 12h 2.9%, 4h 1.7%, 1h 0.75%, 30m 0.47%, 15m 0.30%.
 *
 * A stop one ATR(1w) beyond a weekly zone would be ~10% wide — further than
 * HTF zones typically sit apart, so the first target would be inside the stop
 * and no plan could ever show a reward. 12h keeps an HTF stop wider than the
 * old flat ATR(4h), which is the direction the hierarchy argues for, without
 * that collapse.
 *
 * MID and LTF entries are unused while only HTF zones are tradeable; they are
 * defined so the map is complete, not because anything reads them yet.
 */
export const TIER_ATR_TIMEFRAME: Record<ZoneTier, Timeframe> = {
  HTF: TIMEFRAMES.TWELVE_HOUR,
  MID: TIMEFRAMES.ONE_HOUR,
  LTF: TIMEFRAMES.FIFTEEN_MIN,
};

/**
 * How wide the clustering band is, as a fraction of THAT CHART'S OWN ATR.
 *
 * Replaces a flat 0.5% applied to every chart. At $78k a 0.5% band is ~$390:
 * fine on a 1h chart, absurd on a weekly one, where two swings essentially
 * never landed that close and the 2-touch filter then discarded nearly
 * everything. The weekly was contributing about one mark in fifty.
 *
 * 0.67 is not a tuned number: it is the value that reproduces the existing
 * 0.5% on the 1h chart (median ATR(1h) = 0.748% of price, 0.5/0.748 = 0.67).
 * So this is a generalisation of the old constant, not a replacement for it —
 * 1h behaviour is unchanged and every other chart now scales to its own noise.
 */
export const CLUSTER_ATR_FRACTION = 0.67;
