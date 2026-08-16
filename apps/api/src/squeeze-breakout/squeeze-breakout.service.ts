import { Injectable } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { IndicatorContext } from '../common/types/indicator-context.types';
import { SqueezeBreakoutSetup } from './interfaces/squeeze-breakout.types';

/**
 * For a market that has gone quiet and coiled up: finds the top and bottom of
 * the range it is stuck in, and how much trading volume a genuine break out
 * of that range would need.
 *
 * It only produces levels to watch. It does not track positions or place
 * orders.
 */
@Injectable()
export class SqueezeBreakoutService {
  /** Number of candles fetched from Binance (provides headroom over lookback). */
  private static readonly CANDLE_FETCH_LIMIT = 50;

  /** Lookback window for the squeeze zone (Highest High / Lowest Low / volume SMA). */
  private static readonly SQUEEZE_LOOKBACK = 20;

  /** Multiplier applied to the volume baseline for breakout confirmation. */
  private static readonly VOLUME_MULTIPLIER = 1.5;

  constructor(private readonly binanceService: BinanceService) {}

  /** Fetches its own data first. Use the version below if you already have it. */
  async calculateBreakoutTriggers(
    symbol: string,
    timeframe: string,
  ): Promise<SqueezeBreakoutSetup> {
    const candles = await this.binanceService.getCandles(
      symbol,
      timeframe as TimeInterval,
      SqueezeBreakoutService.CANDLE_FETCH_LIMIT,
    );

    return this.computeSetup(symbol, timeframe, candles);
  }

  /** The same, from price bars the caller already has. */
  calculateBreakoutTriggersFromContext(
    context: IndicatorContext,
  ): SqueezeBreakoutSetup {
    return this.computeSetup(
      context.symbol,
      context.timeframe,
      context.candles as ReadonlyArray<Candle>,
    );
  }

  /**
   * Internal pure setup builder. Both public entry points funnel here
   * to guarantee mathematical equivalence.
   */
  private computeSetup(
    symbol: string,
    timeframe: string,
    candles: ReadonlyArray<Candle>,
  ): SqueezeBreakoutSetup {
    if (candles.length < SqueezeBreakoutService.SQUEEZE_LOOKBACK) {
      throw new Error(
        `Insufficient candle data for squeeze breakout setup on ${symbol} ${timeframe}: ` +
          `need at least ${SqueezeBreakoutService.SQUEEZE_LOOKBACK}, got ${candles.length}`,
      );
    }

    // Squeeze zone = last N candles.
    const zone = candles.slice(-SqueezeBreakoutService.SQUEEZE_LOOKBACK);

    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    let volumeSum = 0;

    for (const c of zone) {
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
      volumeSum += c.volume;
    }

    const volumeBaseline = volumeSum / zone.length;

    const entryConditions =
      `LONG entry: a 1h or 15m candle CLOSES strictly ABOVE ${highestHigh} ` +
      `with volume > ${SqueezeBreakoutService.VOLUME_MULTIPLIER}x the ${SqueezeBreakoutService.SQUEEZE_LOOKBACK}-period ` +
      `volume baseline (${volumeBaseline.toFixed(4)}). ` +
      `SHORT entry: a 1h or 15m candle CLOSES strictly BELOW ${lowestLow} ` +
      `with volume > ${SqueezeBreakoutService.VOLUME_MULTIPLIER}x the same baseline. ` +
      `Wicks alone do not count — only the candle close validates the breakout.`;

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      upperTriggerPrice: highestHigh,
      lowerTriggerPrice: lowestLow,
      volumeBaseline,
      lookback: SqueezeBreakoutService.SQUEEZE_LOOKBACK,
      volumeMultiplier: SqueezeBreakoutService.VOLUME_MULTIPLIER,
      entryConditions,
    };
  }
}
