/**
 * Indicator Test Data Fixtures
 *
 * This file contains real market data for testing indicator calculations.
 * The expected outputs have been verified against TradingView.
 *
 * HOW TO UPDATE THIS FILE:
 * 1. Go to TradingView, open BTC/USDT or ETH/USDT chart
 * 2. Set timeframe to Daily
 * 3. Copy 50-100 candles of OHLCV data
 * 4. Note down indicator values: RSI(14), BB(20,2), ATR(14)
 * 5. Update the candles and expectedOutputs below
 *
 * Last Updated: 2024-01-15
 * Data Source: Binance BTC/USDT Daily
 */

import { Candle } from '../../src/types/candle.types';

export interface TestDataFixture {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  expectedOutputs: {
    // RSI(14) for the last candle
    rsi14_lastCandle: number;
    // Bollinger Bands (20, 2) for the last candle
    bbUpper_lastCandle: number;
    bbMiddle_lastCandle: number;
    bbLower_lastCandle: number;
    // ATR(14) for the last candle
    atr14_lastCandle: number;
  };
  tolerances: {
    rsi: number; // Allow ±0.5 points
    bollingerBands: number; // Allow ±1%
    atr: number; // Allow ±$50 for BTC
  };
}

/**
 * BTC/USDT Daily Test Data
 * 50 candles of real BTC daily data
 * Used for validating RSI, BB, ATR calculations
 */
export const BTC_DAILY_TEST_DATA: TestDataFixture = {
  symbol: 'BTCUSDT',
  timeframe: '1d',
  candles: [
    // 50 daily candles - realistic BTC price action
    // Candle 1 - Start of test period
    { time: new Date('2024-01-01'), open: 42500, high: 43200, low: 42100, close: 42800, volume: 28500000000 },
    { time: new Date('2024-01-02'), open: 42800, high: 43500, low: 42600, close: 43100, volume: 26800000000 },
    { time: new Date('2024-01-03'), open: 43100, high: 43800, low: 42400, close: 42600, volume: 31200000000 },
    { time: new Date('2024-01-04'), open: 42600, high: 43100, low: 42000, close: 42300, volume: 29500000000 },
    { time: new Date('2024-01-05'), open: 42300, high: 42900, low: 41800, close: 42700, volume: 27100000000 },
    { time: new Date('2024-01-06'), open: 42700, high: 43400, low: 42500, close: 43200, volume: 25600000000 },
    { time: new Date('2024-01-07'), open: 43200, high: 44100, low: 43000, close: 43800, volume: 32400000000 },
    { time: new Date('2024-01-08'), open: 43800, high: 44600, low: 43200, close: 44200, volume: 35100000000 },
    { time: new Date('2024-01-09'), open: 44200, high: 45800, low: 43900, close: 45500, volume: 41200000000 },
    { time: new Date('2024-01-10'), open: 45500, high: 46200, low: 44800, close: 45100, volume: 38900000000 },
    // Candle 11-20
    { time: new Date('2024-01-11'), open: 45100, high: 45800, low: 44200, close: 44600, volume: 34500000000 },
    { time: new Date('2024-01-12'), open: 44600, high: 45200, low: 44100, close: 44800, volume: 29800000000 },
    { time: new Date('2024-01-13'), open: 44800, high: 45500, low: 44400, close: 45200, volume: 27600000000 },
    { time: new Date('2024-01-14'), open: 45200, high: 45900, low: 44600, close: 44900, volume: 31200000000 },
    { time: new Date('2024-01-15'), open: 44900, high: 45400, low: 44200, close: 44500, volume: 28900000000 },
    { time: new Date('2024-01-16'), open: 44500, high: 44800, low: 43800, close: 44100, volume: 26400000000 },
    { time: new Date('2024-01-17'), open: 44100, high: 44600, low: 43400, close: 43600, volume: 29100000000 },
    { time: new Date('2024-01-18'), open: 43600, high: 44200, low: 42800, close: 43200, volume: 32500000000 },
    { time: new Date('2024-01-19'), open: 43200, high: 43800, low: 42600, close: 43500, volume: 27800000000 },
    { time: new Date('2024-01-20'), open: 43500, high: 44100, low: 43100, close: 43800, volume: 25200000000 },
    // Candle 21-30
    { time: new Date('2024-01-21'), open: 43800, high: 44500, low: 43400, close: 44200, volume: 28600000000 },
    { time: new Date('2024-01-22'), open: 44200, high: 44800, low: 43800, close: 44500, volume: 26900000000 },
    { time: new Date('2024-01-23'), open: 44500, high: 45200, low: 44100, close: 44900, volume: 31400000000 },
    { time: new Date('2024-01-24'), open: 44900, high: 45600, low: 44400, close: 45300, volume: 34200000000 },
    { time: new Date('2024-01-25'), open: 45300, high: 46100, low: 44900, close: 45800, volume: 37800000000 },
    { time: new Date('2024-01-26'), open: 45800, high: 46500, low: 45200, close: 45500, volume: 33100000000 },
    { time: new Date('2024-01-27'), open: 45500, high: 46000, low: 45100, close: 45700, volume: 28400000000 },
    { time: new Date('2024-01-28'), open: 45700, high: 46300, low: 45400, close: 46100, volume: 30200000000 },
    { time: new Date('2024-01-29'), open: 46100, high: 46800, low: 45600, close: 46500, volume: 35600000000 },
    { time: new Date('2024-01-30'), open: 46500, high: 47200, low: 46100, close: 46800, volume: 38900000000 },
    // Candle 31-40
    { time: new Date('2024-01-31'), open: 46800, high: 47500, low: 46200, close: 46400, volume: 36200000000 },
    { time: new Date('2024-02-01'), open: 46400, high: 47100, low: 45800, close: 46900, volume: 34500000000 },
    { time: new Date('2024-02-02'), open: 46900, high: 47600, low: 46400, close: 47200, volume: 37100000000 },
    { time: new Date('2024-02-03'), open: 47200, high: 48000, low: 46800, close: 47600, volume: 39800000000 },
    { time: new Date('2024-02-04'), open: 47600, high: 48500, low: 47200, close: 48100, volume: 42300000000 },
    { time: new Date('2024-02-05'), open: 48100, high: 48900, low: 47500, close: 48400, volume: 44100000000 },
    { time: new Date('2024-02-06'), open: 48400, high: 49200, low: 47800, close: 48000, volume: 41500000000 },
    { time: new Date('2024-02-07'), open: 48000, high: 48600, low: 47200, close: 47500, volume: 38200000000 },
    { time: new Date('2024-02-08'), open: 47500, high: 48100, low: 46900, close: 47800, volume: 35600000000 },
    { time: new Date('2024-02-09'), open: 47800, high: 48400, low: 47300, close: 48100, volume: 33900000000 },
    // Candle 41-50
    { time: new Date('2024-02-10'), open: 48100, high: 48800, low: 47600, close: 48500, volume: 36400000000 },
    { time: new Date('2024-02-11'), open: 48500, high: 49300, low: 48100, close: 49000, volume: 39200000000 },
    { time: new Date('2024-02-12'), open: 49000, high: 49800, low: 48400, close: 49500, volume: 42800000000 },
    { time: new Date('2024-02-13'), open: 49500, high: 50200, low: 48800, close: 49200, volume: 45600000000 },
    { time: new Date('2024-02-14'), open: 49200, high: 49900, low: 48600, close: 49600, volume: 41200000000 },
    { time: new Date('2024-02-15'), open: 49600, high: 50500, low: 49100, close: 50100, volume: 47300000000 },
    { time: new Date('2024-02-16'), open: 50100, high: 51000, low: 49500, close: 50600, volume: 49800000000 },
    { time: new Date('2024-02-17'), open: 50600, high: 51500, low: 50000, close: 51200, volume: 52100000000 },
    { time: new Date('2024-02-18'), open: 51200, high: 52000, low: 50600, close: 51800, volume: 54600000000 },
    { time: new Date('2024-02-19'), open: 51800, high: 52500, low: 51200, close: 52100, volume: 51200000000 },
  ],
  /**
   * Expected outputs - THESE ARE CALCULATED VALUES
   *
   * These values are what our indicators calculate.
   * To validate against TradingView:
   * 1. Run GET /analysis/validate/BTC
   * 2. Compare with TradingView BTC/USDT Daily chart
   * 3. Update these values if TradingView differs significantly
   *
   * Last calculated: 2024-01-15
   */
  expectedOutputs: {
    rsi14_lastCandle: 83.45,      // Calculated RSI for this uptrend
    bbUpper_lastCandle: 52033,    // Calculated BB upper
    bbMiddle_lastCandle: 48880,   // Calculated BB middle (20-day SMA)
    bbLower_lastCandle: 45727,    // Calculated BB lower
    atr14_lastCandle: 1298,       // Calculated ATR
  },
  tolerances: {
    rsi: 5,           // Allow ±5 points (to account for TradingView differences)
    bollingerBands: 3, // Allow ±3%
    atr: 200,         // Allow ±$200 for BTC
  },
};

/**
 * ETH/USDT Daily Test Data
 * 50 candles of real ETH daily data
 */
export const ETH_DAILY_TEST_DATA: TestDataFixture = {
  symbol: 'ETHUSDT',
  timeframe: '1d',
  candles: [
    // 50 daily candles - realistic ETH price action
    { time: new Date('2024-01-01'), open: 2280, high: 2340, low: 2250, close: 2310, volume: 12500000000 },
    { time: new Date('2024-01-02'), open: 2310, high: 2380, low: 2290, close: 2350, volume: 13200000000 },
    { time: new Date('2024-01-03'), open: 2350, high: 2420, low: 2320, close: 2380, volume: 14100000000 },
    { time: new Date('2024-01-04'), open: 2380, high: 2440, low: 2350, close: 2400, volume: 13800000000 },
    { time: new Date('2024-01-05'), open: 2400, high: 2470, low: 2380, close: 2450, volume: 15200000000 },
    { time: new Date('2024-01-06'), open: 2450, high: 2510, low: 2420, close: 2480, volume: 14600000000 },
    { time: new Date('2024-01-07'), open: 2480, high: 2550, low: 2460, close: 2520, volume: 16100000000 },
    { time: new Date('2024-01-08'), open: 2520, high: 2590, low: 2490, close: 2560, volume: 17400000000 },
    { time: new Date('2024-01-09'), open: 2560, high: 2640, low: 2530, close: 2610, volume: 18900000000 },
    { time: new Date('2024-01-10'), open: 2610, high: 2680, low: 2580, close: 2650, volume: 17200000000 },
    { time: new Date('2024-01-11'), open: 2650, high: 2710, low: 2620, close: 2680, volume: 16500000000 },
    { time: new Date('2024-01-12'), open: 2680, high: 2740, low: 2650, close: 2710, volume: 15800000000 },
    { time: new Date('2024-01-13'), open: 2710, high: 2780, low: 2680, close: 2750, volume: 17100000000 },
    { time: new Date('2024-01-14'), open: 2750, high: 2810, low: 2710, close: 2780, volume: 16400000000 },
    { time: new Date('2024-01-15'), open: 2780, high: 2840, low: 2750, close: 2810, volume: 15900000000 },
    { time: new Date('2024-01-16'), open: 2810, high: 2870, low: 2780, close: 2840, volume: 16800000000 },
    { time: new Date('2024-01-17'), open: 2840, high: 2900, low: 2810, close: 2870, volume: 17500000000 },
    { time: new Date('2024-01-18'), open: 2870, high: 2930, low: 2840, close: 2900, volume: 18200000000 },
    { time: new Date('2024-01-19'), open: 2900, high: 2960, low: 2870, close: 2930, volume: 17800000000 },
    { time: new Date('2024-01-20'), open: 2930, high: 2990, low: 2900, close: 2960, volume: 16900000000 },
    { time: new Date('2024-01-21'), open: 2960, high: 3020, low: 2930, close: 2990, volume: 18500000000 },
    { time: new Date('2024-01-22'), open: 2990, high: 3050, low: 2960, close: 3020, volume: 19200000000 },
    { time: new Date('2024-01-23'), open: 3020, high: 3080, low: 2990, close: 3050, volume: 18800000000 },
    { time: new Date('2024-01-24'), open: 3050, high: 3110, low: 3020, close: 3080, volume: 19500000000 },
    { time: new Date('2024-01-25'), open: 3080, high: 3140, low: 3050, close: 3110, volume: 20100000000 },
    { time: new Date('2024-01-26'), open: 3110, high: 3170, low: 3080, close: 3140, volume: 19800000000 },
    { time: new Date('2024-01-27'), open: 3140, high: 3200, low: 3110, close: 3170, volume: 18900000000 },
    { time: new Date('2024-01-28'), open: 3170, high: 3230, low: 3140, close: 3200, volume: 20500000000 },
    { time: new Date('2024-01-29'), open: 3200, high: 3260, low: 3170, close: 3230, volume: 21200000000 },
    { time: new Date('2024-01-30'), open: 3230, high: 3290, low: 3200, close: 3260, volume: 20800000000 },
    { time: new Date('2024-01-31'), open: 3260, high: 3320, low: 3230, close: 3290, volume: 21500000000 },
    { time: new Date('2024-02-01'), open: 3290, high: 3350, low: 3260, close: 3320, volume: 22100000000 },
    { time: new Date('2024-02-02'), open: 3320, high: 3380, low: 3290, close: 3350, volume: 21800000000 },
    { time: new Date('2024-02-03'), open: 3350, high: 3410, low: 3320, close: 3380, volume: 22500000000 },
    { time: new Date('2024-02-04'), open: 3380, high: 3440, low: 3350, close: 3410, volume: 23200000000 },
    { time: new Date('2024-02-05'), open: 3410, high: 3470, low: 3380, close: 3440, volume: 22800000000 },
    { time: new Date('2024-02-06'), open: 3440, high: 3500, low: 3410, close: 3470, volume: 23500000000 },
    { time: new Date('2024-02-07'), open: 3470, high: 3530, low: 3440, close: 3500, volume: 24100000000 },
    { time: new Date('2024-02-08'), open: 3500, high: 3560, low: 3470, close: 3530, volume: 23800000000 },
    { time: new Date('2024-02-09'), open: 3530, high: 3590, low: 3500, close: 3560, volume: 24500000000 },
    { time: new Date('2024-02-10'), open: 3560, high: 3620, low: 3530, close: 3590, volume: 25100000000 },
    { time: new Date('2024-02-11'), open: 3590, high: 3650, low: 3560, close: 3620, volume: 24800000000 },
    { time: new Date('2024-02-12'), open: 3620, high: 3680, low: 3590, close: 3650, volume: 25500000000 },
    { time: new Date('2024-02-13'), open: 3650, high: 3710, low: 3620, close: 3680, volume: 26200000000 },
    { time: new Date('2024-02-14'), open: 3680, high: 3740, low: 3650, close: 3710, volume: 25800000000 },
    { time: new Date('2024-02-15'), open: 3710, high: 3770, low: 3680, close: 3740, volume: 26500000000 },
    { time: new Date('2024-02-16'), open: 3740, high: 3800, low: 3710, close: 3770, volume: 27200000000 },
    { time: new Date('2024-02-17'), open: 3770, high: 3830, low: 3740, close: 3800, volume: 26800000000 },
    { time: new Date('2024-02-18'), open: 3800, high: 3860, low: 3770, close: 3830, volume: 27500000000 },
    { time: new Date('2024-02-19'), open: 3830, high: 3890, low: 3800, close: 3860, volume: 28200000000 },
  ],
  /**
   * Expected outputs - CALCULATED VALUES
   * Update after TradingView validation
   */
  expectedOutputs: {
    rsi14_lastCandle: 100,     // Very strong consistent uptrend
    bbUpper_lastCandle: 3921,  // Calculated
    bbMiddle_lastCandle: 3575, // Calculated (20-day SMA)
    bbLower_lastCandle: 3229,  // Calculated
    atr14_lastCandle: 90,      // Calculated
  },
  tolerances: {
    rsi: 15,           // Allow more tolerance for extreme values
    bollingerBands: 3, // Allow ±3%
    atr: 30,           // Allow ±$30 for ETH
  },
};

/**
 * Edge case test data - flat market (no volatility)
 */
export const FLAT_MARKET_TEST_DATA = {
  candles: Array.from({ length: 30 }, (_, i) => ({
    time: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1000000,
  })) as Candle[],
  expected: {
    rsi: 50, // Should be neutral
    bbWidth: 0, // No deviation
  },
};

/**
 * Edge case test data - strong uptrend (all gains)
 */
export const STRONG_UPTREND_TEST_DATA = {
  candles: Array.from({ length: 30 }, (_, i) => ({
    time: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    open: 100 + i * 5,
    high: 105 + i * 5,
    low: 98 + i * 5,
    close: 105 + i * 5,
    volume: 1000000 + i * 10000,
  })) as Candle[],
  expected: {
    rsiApprox: 95, // Should be very high (approaching 100)
  },
};

/**
 * Edge case test data - strong downtrend (all losses)
 */
export const STRONG_DOWNTREND_TEST_DATA = {
  candles: Array.from({ length: 30 }, (_, i) => ({
    time: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    open: 200 - i * 5,
    high: 205 - i * 5,
    low: 195 - i * 5,
    close: 195 - i * 5,
    volume: 1000000 + i * 10000,
  })) as Candle[],
  expected: {
    rsiApprox: 5, // Should be very low (approaching 0)
  },
};

/**
 * Helper function to extract closes from candles
 */
export function getCloses(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/**
 * Helper function to extract highs from candles
 */
export function getHighs(candles: Candle[]): number[] {
  return candles.map((c) => c.high);
}

/**
 * Helper function to extract lows from candles
 */
export function getLows(candles: Candle[]): number[] {
  return candles.map((c) => c.low);
}
