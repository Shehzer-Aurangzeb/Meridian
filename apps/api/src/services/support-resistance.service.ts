import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { Candle, TimeInterval } from '../types/candle.types';
import { Timeframe, TIMEFRAMES, CANDLE_LIMITS } from '../constants/timeframes';
import {
  SupportResistanceLevel,
  SRSwingPoint,
  ClusteredLevel,
  FibonacciLevels,
  SupportResistanceAnalysis,
  SRDetectionOptions,
  SR_DEFAULTS,
} from '../types/support-resistance.types';

@Injectable()
export class SupportResistanceService {
  private readonly logger = new Logger(SupportResistanceService.name);

  constructor(private readonly binanceService: BinanceService) {}

  /**
   * Main method to find all support and resistance levels
   */
  async findLevels(
    symbol: string,
    timeframe: Timeframe = TIMEFRAMES.DAILY,
    currentPrice: number,
    options: SRDetectionOptions = {},
  ): Promise<SupportResistanceLevel[]> {
    const {
      clusterThreshold = SR_DEFAULTS.CLUSTER_THRESHOLD,
      minTouches = SR_DEFAULTS.MIN_TOUCHES,
      maxLevels = SR_DEFAULTS.MAX_LEVELS,
      lookbackCandles = SR_DEFAULTS.LOOKBACK_CANDLES,
    } = options;

    this.logger.log(`Finding S/R levels for ${symbol} on ${timeframe}`);

    // 1. Fetch sufficient candles
    const candles = await this.binanceService.getCandles(
      symbol,
      timeframe as TimeInterval,
      lookbackCandles,
    );

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
   * Find the nearest significant level to current price
   */
  async findNearestLevel(
    symbol: string,
    currentPrice: number,
    timeframe: Timeframe = TIMEFRAMES.DAILY,
    maxDistancePercent: number = 5,
  ): Promise<SupportResistanceLevel | null> {
    const levels = await this.findLevels(symbol, timeframe, currentPrice);

    // Filter to levels within max distance
    const nearby = levels.filter((l) => l.distancePercent <= maxDistancePercent);

    if (nearby.length === 0) return null;

    // Return strongest level (highest strength score)
    return nearby.sort((a, b) => b.strength - a.strength)[0];
  }

  /**
   * Find nearest support level below current price
   */
  async findNearestSupport(
    symbol: string,
    currentPrice: number,
    timeframe: Timeframe = TIMEFRAMES.DAILY,
  ): Promise<SupportResistanceLevel | null> {
    const levels = await this.findLevels(symbol, timeframe, currentPrice);

    // Filter to support levels below current price
    const supports = levels.filter(
      (l) => l.type === 'support' && l.price < currentPrice,
    );

    if (supports.length === 0) return null;

    // Return closest (by distance)
    return supports.sort((a, b) => a.distancePercent - b.distancePercent)[0];
  }

  /**
   * Find nearest resistance level above current price
   */
  async findNearestResistance(
    symbol: string,
    currentPrice: number,
    timeframe: Timeframe = TIMEFRAMES.DAILY,
  ): Promise<SupportResistanceLevel | null> {
    const levels = await this.findLevels(symbol, timeframe, currentPrice);

    // Filter to resistance levels above current price
    const resistances = levels.filter(
      (l) => l.type === 'resistance' && l.price > currentPrice,
    );

    if (resistances.length === 0) return null;

    // Return closest (by distance)
    return resistances.sort((a, b) => a.distancePercent - b.distancePercent)[0];
  }

  /**
   * Get complete S/R analysis including Fibonacci levels
   */
  async getFullAnalysis(
    symbol: string,
    currentPrice: number,
    timeframe: Timeframe = TIMEFRAMES.DAILY,
  ): Promise<SupportResistanceAnalysis> {
    const levels = await this.findLevels(symbol, timeframe, currentPrice);

    // Find nearest support and resistance
    const nearestSupport = levels.find(
      (l) => l.type === 'support' && l.price < currentPrice,
    ) || null;
    const nearestResistance = levels.find(
      (l) => l.type === 'resistance' && l.price > currentPrice,
    ) || null;

    // Calculate Fibonacci if we have both support and resistance
    let fibonacci: FibonacciLevels | null = null;
    if (nearestSupport && nearestResistance) {
      fibonacci = this.calculateFibonacciLevels(
        nearestSupport.price,
        nearestResistance.price,
        'up',
      );
    }

    return {
      levels,
      nearestSupport,
      nearestResistance,
      fibonacci,
      currentPrice,
      analyzedAt: new Date(),
    };
  }

  /**
   * Calculate Fibonacci retracement levels
   */
  calculateFibonacciLevels(
    swingLow: number,
    swingHigh: number,
    direction: 'up' | 'down' = 'up',
  ): FibonacciLevels {
    const range = swingHigh - swingLow;

    if (direction === 'up') {
      // For uptrend, retracement levels go from high down
      return {
        level_0: swingLow,
        level_236: swingLow + range * 0.236,
        level_382: swingLow + range * 0.382,
        level_500: swingLow + range * 0.5,
        level_618: swingLow + range * 0.618,
        level_786: swingLow + range * 0.786,
        level_100: swingHigh,
        direction,
      };
    } else {
      // For downtrend, retracement levels go from low up
      return {
        level_0: swingHigh,
        level_236: swingHigh - range * 0.236,
        level_382: swingHigh - range * 0.382,
        level_500: swingHigh - range * 0.5,
        level_618: swingHigh - range * 0.618,
        level_786: swingHigh - range * 0.786,
        level_100: swingLow,
        direction,
      };
    }
  }

  /**
   * Analyze levels from pre-fetched candles (for use with multi-timeframe service)
   */
  analyzeCandlesForLevels(
    candles: Candle[],
    currentPrice: number,
    timeframe: Timeframe,
    options: SRDetectionOptions = {},
  ): SupportResistanceLevel[] {
    const {
      clusterThreshold = SR_DEFAULTS.CLUSTER_THRESHOLD,
      minTouches = SR_DEFAULTS.MIN_TOUCHES,
      maxLevels = SR_DEFAULTS.MAX_LEVELS,
    } = options;

    if (candles.length < 20) {
      return [];
    }

    // Find swing highs and lows
    const swingHighs = this.findSwingHighs(candles);
    const swingLows = this.findSwingLows(candles);

    // Cluster levels
    const resistanceClusters = this.clusterLevels(swingHighs, clusterThreshold, 'resistance');
    const supportClusters = this.clusterLevels(swingLows, clusterThreshold, 'support');

    // Convert to levels
    const resistanceLevels = resistanceClusters
      .filter((c) => c.count >= minTouches)
      .map((c) => this.clusterToLevel(c, timeframe, currentPrice, candles));

    const supportLevels = supportClusters
      .filter((c) => c.count >= minTouches)
      .map((c) => this.clusterToLevel(c, timeframe, currentPrice, candles));

    // Combine and sort
    return [...resistanceLevels, ...supportLevels]
      .sort((a, b) => a.distancePercent - b.distancePercent)
      .slice(0, maxLevels);
  }

  /**
   * Find nearest level from pre-analyzed levels (for checklist integration)
   */
  findNearestFromLevels(
    levels: SupportResistanceLevel[],
    currentPrice: number,
    tradeType: 'long' | 'short',
    maxDistancePercent: number = 5,
  ): SupportResistanceLevel | null {
    const targetType = tradeType === 'long' ? 'support' : 'resistance';

    // Filter by type and distance
    const relevant = levels.filter(
      (l) =>
        l.type === targetType &&
        l.distancePercent <= maxDistancePercent,
    );

    if (relevant.length === 0) return null;

    // Return strongest nearby level
    return relevant.sort((a, b) => {
      // Prefer stronger levels
      if (b.strength !== a.strength) return b.strength - a.strength;
      // Then by proximity
      return a.distancePercent - b.distancePercent;
    })[0];
  }
}
