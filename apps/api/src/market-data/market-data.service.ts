import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { Candle, TimeInterval } from '../common/types/candle.types';

@Injectable()
export class BinanceService {
  private readonly baseUrl = 'https://api.binance.com/api/v3';
  private readonly logger = new Logger(BinanceService.name);

  // Cache TTLs in milliseconds (cache-manager v7)
  private readonly CANDLE_CACHE_TTL = 300_000; // 5 minutes
  private readonly PRICE_CACHE_TTL = 30_000; // 30 seconds
  private readonly STALE_CACHE_TTL = 3_600_000; // 1 hour fallback for API failures

  // Configurable request timeouts (in ms)
  private readonly candleTimeout = parseInt(process.env.BINANCE_TIMEOUT_MS || '30000', 10);
  private readonly priceTimeout = parseInt(process.env.BINANCE_PRICE_TIMEOUT_MS || '10000', 10);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Fetches candle (OHLCV) data from Binance with caching
   * @param symbol - Trading pair base (e.g., 'BTC', 'ETH') - automatically appends 'USDT'
   * @param interval - Candle timeframe
   * @param limit - Number of candles to fetch (max 1000)
   */
  async getCandles(
    symbol: string,
    interval: TimeInterval,
    limit: number = 100,
  ): Promise<Candle[]> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = this.generateCandleCacheKey(tradingPair, interval, limit);

    // Try cache first
    const cached = await this.cacheManager.get<Candle[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT: ${cacheKey}`);
      return this.deserializeCandles(cached);
    }

    this.logger.debug(`Cache MISS: ${cacheKey}`);

    // Fetch from Binance with retry; fall back to stale cache on total failure
    const staleCacheKey = `stale:candles:${tradingPair}:${interval}:${limit}`;
    try {
      const candles = await this.fetchCandlesFromBinance(tradingPair, interval, limit);
      await this.cacheManager.set(cacheKey, candles, this.CANDLE_CACHE_TTL);
      // Also write a longer-lived stale copy for emergency fallback
      await this.cacheManager.set(staleCacheKey, candles, this.STALE_CACHE_TTL);
      return candles;
    } catch (error) {
      const stale = await this.cacheManager.get<Candle[]>(staleCacheKey);
      if (stale) {
        this.logger.warn(
          `Binance fetch failed for ${tradingPair} ${interval}, serving stale cached candles`,
        );
        return this.deserializeCandles(stale);
      }
      throw error;
    }
  }

  /**
   * Fetches current price for a trading pair from Binance with caching
   * @param symbol - Trading pair base (e.g., 'BTC', 'ETH') - automatically appends 'USDT'
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = `price:${tradingPair}`;

    // Try cache first
    const cached = await this.cacheManager.get<number>(cacheKey);
    if (cached !== undefined && cached !== null) {
      this.logger.debug(`Price cache HIT: ${tradingPair}`);
      return cached;
    }

    this.logger.debug(`Price cache MISS: ${tradingPair}`);

    // Fetch from Binance
    const price = await this.fetchPriceFromBinance(tradingPair);

    // Cache for shorter duration (price changes frequently)
    await this.cacheManager.set(cacheKey, price, this.PRICE_CACHE_TTL);

    return price;
  }

  /**
   * Generate cache key for candles
   * Includes time bucket to ensure cache invalidates every 5 minutes
   */
  private generateCandleCacheKey(
    symbol: string,
    interval: string,
    limit: number,
  ): string {
    // Round to 5-minute buckets for cache key
    const now = Date.now();
    const timeBucket = Math.floor(now / (5 * 60 * 1000));
    return `candles:${symbol}:${interval}:${limit}:${timeBucket}`;
  }

  /**
   * Deserialize candles from cache (Date objects need reconstruction)
   */
  private deserializeCandles(candles: Candle[]): Candle[] {
    return candles.map((c) => ({
      ...c,
      time: new Date(c.time),
    }));
  }

  /**
   * Fetch candles from Binance API with retry logic
   */
  private async fetchCandlesFromBinance(
    tradingPair: string,
    interval: string,
    limit: number,
    retries: number = 3,
  ): Promise<Candle[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(`${this.baseUrl}/klines`, {
          params: {
            symbol: tradingPair,
            interval,
            limit,
          },
          timeout: this.candleTimeout,
        });

        // Binance returns array of arrays:
        // [0] Open time, [1] Open, [2] High, [3] Low, [4] Close, [5] Volume, ...
        return response.data.map((kline: (string | number)[]): Candle => ({
          time: new Date(kline[0] as number),
          open: parseFloat(kline[1] as string),
          high: parseFloat(kline[2] as string),
          low: parseFloat(kline[3] as string),
          close: parseFloat(kline[4] as string),
          volume: parseFloat(kline[5] as string),
        }));
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
          const isNetworkError = !error.response && (isTimeout || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND');
          const isRateLimited = error.response?.status === 429;
          const isServerError = error.response?.status !== undefined && error.response.status >= 500;

          // Retry on network errors, timeouts, rate limits, or server errors
          if ((isNetworkError || isRateLimited || isServerError) && attempt < retries) {
            const reason = isTimeout
              ? 'timeout'
              : isNetworkError
                ? `network error (${error.code})`
                : isRateLimited
                  ? 'rate limited'
                  : 'server error';
            this.logger.warn(
              `Binance ${reason} for ${tradingPair} ${interval}, retrying ${attempt}/${retries}`,
            );
            await this.sleep(1000 * attempt); // Exponential backoff
            continue;
          }

          const message = error.response?.data?.msg || error.message;
          throw new Error(`Binance API error fetching candles for ${tradingPair}: ${message}`);
        }

        if (attempt === retries) {
          throw new Error(`Failed to fetch candles for ${tradingPair} after ${retries} retries: ${error}`);
        }
      }
    }

    throw new Error(`Failed to fetch candles for ${tradingPair}`);
  }

  /**
   * Fetch price from Binance API with retry logic
   */
  private async fetchPriceFromBinance(
    tradingPair: string,
    retries: number = 3,
  ): Promise<number> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(`${this.baseUrl}/ticker/price`, {
          params: { symbol: tradingPair },
          timeout: this.priceTimeout,
        });

        return parseFloat(response.data.price);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
          const isNetworkError = !error.response && (isTimeout || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND');
          const isRateLimited = error.response?.status === 429;
          const isServerError = error.response?.status !== undefined && error.response.status >= 500;

          if ((isNetworkError || isRateLimited || isServerError) && attempt < retries) {
            const reason = isTimeout
              ? 'timeout'
              : isNetworkError
                ? `network error (${error.code})`
                : isRateLimited
                  ? 'rate limited'
                  : 'server error';
            this.logger.warn(
              `Binance price ${reason} for ${tradingPair}, retrying ${attempt}/${retries}`,
            );
            await this.sleep(500 * attempt);
            continue;
          }

          const message = error.response?.data?.msg || error.message;
          throw new Error(`Binance API error fetching price for ${tradingPair}: ${message}`);
        }

        if (attempt === retries) {
          throw new Error(`Failed to fetch price for ${tradingPair} after ${retries} retries: ${error}`);
        }
      }
    }

    throw new Error(`Failed to fetch price for ${tradingPair}`);
  }

  /**
   * Helper to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Invalidate cache for a symbol (useful for testing)
   */
  async invalidateCache(symbol: string): Promise<void> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    // Note: In-memory cache doesn't support pattern deletion
    // For Redis, use: await this.cacheManager.store.keys(`candles:${tradingPair}:*`)
    await this.cacheManager.del(`price:${tradingPair}`);
    this.logger.log(`Invalidated cache for ${tradingPair}`);
  }
}
