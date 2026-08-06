import { Injectable, Logger } from '@nestjs/common';
import { Candle } from '../../common/types/candle.types';
import { Timeframe, TIMEFRAMES, CANDLE_LIMITS } from '../../common/constants/timeframes';
import {
  SupportResistanceLevel,
  SRSwingPoint,
  ClusteredLevel,
  FibLevel,
  MarkedLevel,
  ConfluenceZone,
  SRDetectionOptions,
  SR_DEFAULTS,
} from '../interfaces/support-resistance.types';

@Injectable()
export class SupportResistanceService {
  private readonly logger = new Logger(SupportResistanceService.name);

  /**
   * The pure half of `findLevels`: swing detection → clustering → touch
   * filtering → strength. No I/O.
   *
   * Exists so callers that already hold a candle window (the coordinator's
   * shared `IndicatorContext`) can get levels without a second fetch. This
   * is the ONLY level engine — the price-anchored grid it replaced snapped
   * swings onto a lattice derived from current price, so a 0.07% move could
   * relabel a level from "support, 4 touches" to "resistance, 1 test".
   */
  levelsFromCandles(
    candles: Candle[],
    timeframe: Timeframe = TIMEFRAMES.DAILY,
    currentPrice: number,
    options: SRDetectionOptions = {},
  ): SupportResistanceLevel[] {
    const {
      clusterThreshold = SR_DEFAULTS.CLUSTER_THRESHOLD,
      minTouches = SR_DEFAULTS.MIN_TOUCHES,
      maxLevels = SR_DEFAULTS.MAX_LEVELS,
    } = options;

    if (candles.length < 20) {
      this.logger.warn(`Insufficient candles for S/R analysis: ${candles.length}`);
      return [];
    }

    // 2. Find swing highs and lows
    const swingHighs = this.findSwingHighs(candles);
    const swingLows = this.findSwingLows(candles);

    this.logger.debug(
      `Found ${swingHighs.length} swing highs and ${swingLows.length} swing lows`,
    );

    // 3. Cluster nearby levels
    const resistanceClusters = this.clusterLevels(swingHighs, clusterThreshold, 'resistance');
    const supportClusters = this.clusterLevels(swingLows, clusterThreshold, 'support');

    // 4. Convert clusters to levels with strength calculation
    const resistanceLevels = resistanceClusters
      .filter((c) => c.count >= minTouches)
      .map((c) => this.clusterToLevel(c, timeframe, currentPrice, candles));

    const supportLevels = supportClusters
      .filter((c) => c.count >= minTouches)
      .map((c) => this.clusterToLevel(c, timeframe, currentPrice, candles));

    // 5. Combine and sort by distance from current price
    const allLevels = [...resistanceLevels, ...supportLevels].sort(
      (a, b) => a.distancePercent - b.distancePercent,
    );

    // 6. Return top levels
    return allLevels.slice(0, maxLevels);
  }

  /**
   * Find swing highs in candle data
   * Swing High: high[i] > high[i-N] && high[i] > high[i+N]
   */
  private findSwingHighs(
    candles: Candle[],
    lookback: number = SR_DEFAULTS.SWING_LOOKBACK,
  ): SRSwingPoint[] {
    const swingHighs: SRSwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      let isSwingHigh = true;

      // Check all bars in lookback range
      for (let j = 1; j <= lookback; j++) {
        if (
          candles[i - j].high >= current.high ||
          candles[i + j].high >= current.high
        ) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          price: current.high,
          type: 'high',
          index: i,
          timestamp: current.time,
        });
      }
    }

    return swingHighs;
  }

  /**
   * Find swing lows in candle data
   * Swing Low: low[i] < low[i-N] && low[i] < low[i+N]
   */
  private findSwingLows(
    candles: Candle[],
    lookback: number = SR_DEFAULTS.SWING_LOOKBACK,
  ): SRSwingPoint[] {
    const swingLows: SRSwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      let isSwingLow = true;

      // Check all bars in lookback range
      for (let j = 1; j <= lookback; j++) {
        if (
          candles[i - j].low <= current.low ||
          candles[i + j].low <= current.low
        ) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        swingLows.push({
          price: current.low,
          type: 'low',
          index: i,
          timestamp: current.time,
        });
      }
    }

    return swingLows;
  }

  /**
   * Cluster nearby swing points into levels
   * Groups points within threshold% of each other
   */
  private clusterLevels(
    points: SRSwingPoint[],
    thresholdPercent: number,
    type: 'support' | 'resistance',
  ): ClusteredLevel[] {
    if (points.length === 0) return [];

    // Sort points by price
    const sortedPoints = [...points].sort((a, b) => a.price - b.price);
    const clusters: ClusteredLevel[] = [];
    let currentCluster: SRSwingPoint[] = [sortedPoints[0]];

    for (let i = 1; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const clusterAvg =
        currentCluster.reduce((sum, p) => sum + p.price, 0) / currentCluster.length;

      // Check if point is within threshold of cluster average
      const distance = Math.abs((point.price - clusterAvg) / clusterAvg) * 100;

      if (distance <= thresholdPercent) {
        // Add to current cluster
        currentCluster.push(point);
      } else {
        // Start new cluster
        if (currentCluster.length > 0) {
          clusters.push(this.createCluster(currentCluster, type));
        }
        currentCluster = [point];
      }
    }

    // Don't forget the last cluster
    if (currentCluster.length > 0) {
      clusters.push(this.createCluster(currentCluster, type));
    }

    return clusters;
  }

  /**
   * Create a ClusteredLevel from an array of swing points
   */
  private createCluster(
    points: SRSwingPoint[],
    type: 'support' | 'resistance',
  ): ClusteredLevel {
    const prices = points.map((p) => p.price);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    return {
      price: avgPrice,
      type,
      points,
      count: points.length,
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices),
      },
    };
  }

  /**
   * Convert a cluster to a SupportResistanceLevel
   */
  private clusterToLevel(
    cluster: ClusteredLevel,
    timeframe: Timeframe,
    currentPrice: number,
    candles: Candle[],
  ): SupportResistanceLevel {
    const distancePercent =
      Math.abs((cluster.price - currentPrice) / currentPrice) * 100;

    // Get most recent touch
    const sortedByTime = [...cluster.points].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
    const lastTested = sortedByTime[0].timestamp;

    // Check if level held (price didn't close beyond it)
    const held = this.checkIfLevelHeld(cluster, candles);

    // Calculate strength (1-5 based on touch count)
    const strength = this.calculateLevelStrength(cluster, held);

    return {
      price: cluster.price,
      type: cluster.type,
      strength,
      timeframe,
      lastTested,
      held,
      distancePercent,
      touchCount: cluster.count,
    };
  }

  /**
   * Check if a level held (didn't get broken through)
   */
  // ponytail: scans from the FIRST touch, so on a 250-candle window almost
  // every level reads `held: false` — price nearly always violates by >0.5%
  // somewhere between two touches. Measured on BTC 1d: 10 of 10 levels false.
  // The −0.5 penalty in `calculateLevelStrength` therefore applies uniformly
  // and does not change ORDERING, only the absolute number, so it is not
  // urgent. Fix when "invalidated" is defined for the zone state machine:
  // "held" should almost certainly mean "held since the MOST RECENT touch".
  private checkIfLevelHeld(cluster: ClusteredLevel, candles: Candle[]): boolean {
    const levelPrice = cluster.price;
    const tolerance = levelPrice * 0.005; // 0.5% tolerance

    // Get candles after the first touch
    const firstTouchIndex = Math.min(...cluster.points.map((p) => p.index));
    const candlesAfterTouch = candles.slice(firstTouchIndex);

    if (cluster.type === 'resistance') {
      // For resistance, check if price closed above it
      const broken = candlesAfterTouch.some(
        (c) => c.close > levelPrice + tolerance,
      );
      return !broken;
    } else {
      // For support, check if price closed below it
      const broken = candlesAfterTouch.some(
        (c) => c.close < levelPrice - tolerance,
      );
      return !broken;
    }
  }

  /**
   * Calculate level strength (1-5)
   * Based on touch count and whether it held
   */
  private calculateLevelStrength(cluster: ClusteredLevel, held: boolean): number {
    const { count } = cluster;
    const { STRENGTH_THRESHOLDS } = SR_DEFAULTS;

    let strength: number;

    if (count >= STRENGTH_THRESHOLDS.VERY_STRONG) {
      strength = 5;
    } else if (count >= STRENGTH_THRESHOLDS.STRONG) {
      strength = 4;
    } else if (count >= STRENGTH_THRESHOLDS.MODERATE) {
      strength = 3;
    } else if (count >= STRENGTH_THRESHOLDS.WEAK) {
      strength = 2;
    } else {
      strength = 1;
    }

    // Bonus for holding
    if (held && strength < 5) {
      strength += 0.5;
    }

    // Penalty for breaking
    if (!held && strength > 1) {
      strength -= 0.5;
    }

    return Math.round(strength);
  }

  /**
   * Playbook Fibonacci (p51, "STEP 1: Fibonacci Level Marking").
   *
   * Quarter-based: 0 / 0.25 / 0.5 / 0.75 / 1.0. NOT the classic
   * 0.236 / 0.382 / 0.618 — this trader marks quarters, and the worked
   * example (low 25,000 / high 40,000 -> 28,750 / 32,500 / 36,250) only
   * reproduces on quarters.
   *
   * Types come from position in the range, per the playbook's colour code,
   * so the marks do not move when spot does.
   */
  fibLevels(swingLow: number, swingHigh: number): FibLevel[] {
    const range = swingHigh - swingLow;
    if (!(range > 0)) return [];

    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      ratio,
      price: swingLow + range * ratio,
      type: ratio <= 0.5 ? ('support' as const) : ('resistance' as const),
    }));
  }

  /**
   * The swing high / low that anchor the Fibonacci range.
   *
   * "Swing High: Highest point in recent range · Swing Low: Lowest point"
   * (p51). Uses detected swings rather than raw min/max so a single wick
   * cannot define the range.
   */
  fibAnchors(candles: Candle[]): { low: number; high: number } | null {
    const highs = this.findSwingHighs(candles);
    const lows = this.findSwingLows(candles);
    if (highs.length === 0 || lows.length === 0) return null;

    return {
      low: Math.min(...lows.map((p) => p.price)),
      high: Math.max(...highs.map((p) => p.price)),
    };
  }

  /**
   * Group marks that agree into confluence zones.
   *
   * Same running-average grouping as `clusterLevels`, but over heterogeneous
   * marks (Fib + S/R, any timeframe) rather than swing points of one type.
   *
   * A zone needs `minSources` INDEPENDENT contributors — that is what makes
   * it confluence rather than one level with a wide band. Duplicate sources
   * are collapsed, so the same level counted twice does not manufacture
   * agreement.
   *
   * Callers therefore control what "independent" means through `source`.
   * Encode the METHOD (and timeframe), not the touch count: two 1d
   * resistance clusters sitting next to each other are one piece of
   * evidence, whereas a resistance and a support at the same price are two
   * — that is an S/R flip, and it is exactly what confluence should reward.
   */
  findConfluenceZones(
    marks: MarkedLevel[],
    currentPrice: number,
    thresholdPercent: number = SR_DEFAULTS.CLUSTER_THRESHOLD,
    minSources: number = 2,
  ): ConfluenceZone[] {
    if (marks.length === 0) return [];

    const sorted = [...marks].sort((a, b) => a.price - b.price);
    const groups: MarkedLevel[][] = [];
    let current: MarkedLevel[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const avg = current.reduce((sum, m) => sum + m.price, 0) / current.length;
      const apart = Math.abs((sorted[i].price - avg) / avg) * 100;

      if (apart <= thresholdPercent) {
        current.push(sorted[i]);
      } else {
        groups.push(current);
        current = [sorted[i]];
      }
    }
    groups.push(current);

    return groups
      .map((g) => {
        const prices = g.map((m) => m.price);
        const low = Math.min(...prices);
        const high = Math.max(...prices);
        const center = prices.reduce((a, b) => a + b, 0) / prices.length;
        const sources = [...new Set(g.map((m) => m.source))];

        // Majority type; ties resolve to whichever side of spot the zone sits.
        const supports = g.filter((m) => m.type === 'support').length;
        const type =
          supports * 2 === g.length
            ? center < currentPrice
              ? ('support' as const)
              : ('resistance' as const)
            : supports * 2 > g.length
              ? ('support' as const)
              : ('resistance' as const);

        return {
          low,
          high,
          center,
          type,
          sources,
          spanPercent: center === 0 ? 0 : ((high - low) / center) * 100,
          distancePercent: ((center - currentPrice) / currentPrice) * 100,
        };
      })
      .filter((z) => z.sources.length >= minSources)
      .sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent));
  }
}
