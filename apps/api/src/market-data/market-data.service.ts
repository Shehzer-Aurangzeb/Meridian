import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { Candle, TimeInterval } from '../common/types/candle.types';
import { CacheTelemetryService } from './cache-telemetry.service';

@Injectable()
export class BinanceService {
  private readonly baseUrl = 'https://api.binance.com/api/v3';
  private readonly fapiUrl = 'https://fapi.binance.com/fapi/v1';
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
    private readonly cacheTelemetry: CacheTelemetryService,
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
      this.cacheTelemetry.recordHit();
      return this.deserializeCandles(cached);
    }

    this.logger.debug(`Cache MISS: ${cacheKey}`);
    this.cacheTelemetry.recordMiss();

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
   * Fetch more than Binance's 1000-candle-per-request cap by walking
   * backwards with `endTime`, then stitching the pages into one ascending
   * series.
   *
   * Binance returns the `limit` candles ending at/before `endTime`, so each
   * page asks for the candles immediately preceding the oldest one we hold.
   *
   * Used by the backtest harness (statistical power needs more than the
   * 125 days a single 4h request yields) and available to
   * `PerformanceService`, which currently over-fetches a recent window and
   * slices in memory because it had no way to request a time range.
   *
   * @param symbol   Trading pair base (e.g. 'BTC')
   * @param interval Candle timeframe
   * @param total    How many candles to end up with
   */
  /**
   * Candles FORWARD from a point in time, rather than backward from now.
   *
   * `getCandlesPaged` answers "the most recent N", which is the wrong question
   * for scoring a saved analysis: an analysis taken 40 days ago was being
   * replayed against the last 30 days, a window its entry was never in. The
   * fill it recorded became invisible and a fresh one could be manufactured
   * from a later touch of the same price.
   *
   * Returns at most `limit` candles starting at or after `startTime`. Fewer
   * means the exchange could not serve the window — the caller must treat that
   * as unscoreable rather than scoring what did arrive.
   */
  async getCandlesFrom(
    symbol: string,
    interval: TimeInterval,
    startTime: number,
    limit: number,
  ): Promise<Candle[]> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = `candles:from:${tradingPair}:${interval}:${startTime}:${limit}`;

    const cached = await this.cacheManager.get<Candle[]>(cacheKey);
    if (cached) {
      this.cacheTelemetry.recordHit();
      return this.deserializeCandles(cached);
    }
    this.cacheTelemetry.recordMiss();

    const PAGE = 1000; // Binance hard cap per klines request
    const byTime = new Map<number, Candle>();
    let cursor = startTime;

    while (byTime.size < limit) {
      const page = await this.fetchCandlesFromBinance(
        tradingPair,
        interval,
        Math.min(PAGE, limit - byTime.size),
        3,
        undefined,
        cursor,
      );
      if (page.length === 0) break;

      const newest = page[page.length - 1].time.getTime();
      for (const c of page) byTime.set(c.time.getTime(), c);
      // No forward progress means we have reached the live edge.
      if (newest < cursor) break;
      cursor = newest + 1;
      await this.sleep(120); // stay well inside the klines weight budget
    }

    const candles = [...byTime.values()]
      .sort((a, b) => a.time.getTime() - b.time.getTime())
      .slice(0, limit);

    await this.cacheManager.set(cacheKey, candles, this.CANDLE_CACHE_TTL);
    return candles;
  }

  async getCandlesPaged(
    symbol: string,
    interval: TimeInterval,
    total: number,
  ): Promise<Candle[]> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = `candles:paged:${tradingPair}:${interval}:${total}`;

    const cached = await this.cacheManager.get<Candle[]>(cacheKey);
    if (cached) {
      this.cacheTelemetry.recordHit();
      return this.deserializeCandles(cached);
    }
    this.cacheTelemetry.recordMiss();

    const PAGE = 1000; // Binance hard cap per klines request
    const byTime = new Map<number, Candle>();
    let endTime: number | undefined;

    while (byTime.size < total) {
      const page = await this.fetchCandlesFromBinance(
        tradingPair,
        interval,
        Math.min(PAGE, total - byTime.size + 1),
        3,
        endTime,
      );
      if (page.length === 0) break;

      const oldest = page[0].time.getTime();
      for (const c of page) byTime.set(c.time.getTime(), c);

      // Next page ends just before the oldest candle we now hold. If the
      // window stopped advancing we've hit the start of listed history.
      if (endTime !== undefined && oldest >= endTime) break;
      endTime = oldest - 1;

      this.logger.debug(
        `Paged ${tradingPair} ${interval}: ${byTime.size}/${total}`,
      );
      await this.sleep(120); // stay well inside the klines weight budget
    }

    const candles = [...byTime.values()]
      .sort((a, b) => a.time.getTime() - b.time.getTime())
      .slice(-total);

    await this.cacheManager.set(cacheKey, candles, this.CANDLE_CACHE_TTL);
    return candles;
  }

  /**
   * Funding-rate history for a perpetual future, paged forward from
   * `startTime`. Free, no API key.
   *
   * Funding is the fee perp longs pay shorts (or vice versa) every 8h. It
   * is a direct read on crowd positioning: strongly positive means the
   * book is crowded long and paying to stay there. Unlike RSI/BB/ATR it is
   * not another transform of price — which is why it is the first genuinely
   * new input we've added.
   *
   * NOTE: the sibling endpoint `futures/data/openInterestHist` only retains
   * ~30 days, so open interest cannot be backtested over a multi-month
   * window and is deliberately not wired up here.
   */
  async getFundingRates(
    symbol: string,
    startTime: number,
  ): Promise<Array<{ time: Date; rate: number }>> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = `funding:${tradingPair}:${startTime}`;

    const cached =
      await this.cacheManager.get<Array<{ time: string; rate: number }>>(cacheKey);
    if (cached) {
      this.cacheTelemetry.recordHit();
      return cached.map((f) => ({ time: new Date(f.time), rate: f.rate }));
    }
    this.cacheTelemetry.recordMiss();

    const out = new Map<number, number>();
    let cursor = startTime;

    for (;;) {
      const res = await axios.get(`${this.fapiUrl}/fundingRate`, {
        params: { symbol: tradingPair, startTime: cursor, limit: 1000 },
        timeout: this.candleTimeout,
      });
      const rows = res.data as Array<{ fundingTime: number; fundingRate: string }>;
      if (rows.length === 0) break;

      for (const r of rows) out.set(r.fundingTime, parseFloat(r.fundingRate));

      const newest = rows[rows.length - 1].fundingTime;
      if (newest <= cursor) break; // no forward progress → end of history
      cursor = newest + 1;
      if (rows.length < 1000) break;
      await this.sleep(120);
    }

    const funding = [...out.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, rate]) => ({ time: new Date(t), rate }));

    await this.cacheManager.set(cacheKey, funding, this.CANDLE_CACHE_TTL);
    return funding;
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
      this.cacheTelemetry.recordHit();
      return cached;
    }

    this.logger.debug(`Price cache MISS: ${tradingPair}`);
    this.cacheTelemetry.recordMiss();

    // Fetch from Binance
    const price = await this.fetchPriceFromBinance(tradingPair);

    // Cache for shorter duration (price changes frequently)
    await this.cacheManager.set(cacheKey, price, this.PRICE_CACHE_TTL);

    return price;
  }

  /**
   * Generate a deterministic cache key for a candle request.
   *
   * The key intentionally contains ONLY the request parameters so it can
   * be reused by every identical call. Expiry is owned exclusively by the
   * global `CacheModule` TTL configuration — adding an artificial time
   * bucket here would short-circuit that TTL and cause spurious misses
   * around bucket boundaries.
   */
  private generateCandleCacheKey(
    symbol: string,
    interval: string,
    limit: number,
  ): string {
    return `candles:${symbol.toUpperCase()}:${interval}:${limit}`;
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
    endTime?: number,
    startTime?: number,
  ): Promise<Candle[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(`${this.baseUrl}/klines`, {
          params: {
            symbol: tradingPair,
            interval,
            limit,
            ...(endTime !== undefined ? { endTime } : {}),
            ...(startTime !== undefined ? { startTime } : {}),
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

          throw this.binanceError(error, 'candles', tradingPair);
        }

        if (attempt === retries) {
          throw new Error(`Failed to fetch candles for ${tradingPair} after ${retries} retries: ${error}`);
        }
      }
    }

    throw new Error(`Failed to fetch candles for ${tradingPair}`);
  }


  /**
   * Turn a Binance failure into the right kind of error, in one place.
   *
   * An unrecognised trading pair is the CALLER's mistake, not ours: it must
   * not surface as a 500. `pnpm analyze NOTACOIN` and
   * `POST /analyses?symbol=NOTACOIN` both reached here, and the second
   * answered "Internal server error" — which reads as an outage for what is
   * a typo, and would page you at 3am for one.
   *
   * Binance signals it with code -1121 / "Invalid symbol." on an HTTP 400.
   * Everything else stays a plain Error and keeps its 500, because it IS ours.
   */
  private binanceError(
    error: unknown,
    what: string,
    tradingPair: string,
  ): Error {
    if (!axios.isAxiosError(error)) {
      return new Error(`Binance API error fetching ${what} for ${tradingPair}`);
    }

    const data = error.response?.data as { code?: number; msg?: string } | undefined;
    const message = data?.msg || error.message;

    if (data?.code === -1121 || /invalid symbol/i.test(message)) {
      return new NotFoundException(
        `Unknown symbol ${tradingPair} — Binance does not list it`,
      );
    }

    return new Error(
      `Binance API error fetching ${what} for ${tradingPair}: ${message}`,
    );
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

          throw this.binanceError(error, 'price', tradingPair);
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
