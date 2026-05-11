import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Candle, TimeInterval } from '../types/candle.types';

@Injectable()
export class BinanceService {
  private readonly baseUrl = 'https://api.binance.com/api/v3';

  /**
   * Fetches candle (OHLCV) data from Binance
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

    try {
      const response = await axios.get(`${this.baseUrl}/klines`, {
        params: {
          symbol: tradingPair,
          interval,
          limit,
        },
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
        const message = error.response?.data?.msg || error.message;
        throw new Error(`Binance API error fetching candles for ${tradingPair}: ${message}`);
      }
      throw new Error(`Failed to fetch candles for ${tradingPair}: ${error}`);
    }
  }

  /**
   * Fetches current price for a trading pair from Binance
   * @param symbol - Trading pair base (e.g., 'BTC', 'ETH') - automatically appends 'USDT'
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const tradingPair = `${symbol.toUpperCase()}USDT`;

    try {
      const response = await axios.get(`${this.baseUrl}/ticker/price`, {
        params: {
          symbol: tradingPair,
        },
      });

      return parseFloat(response.data.price);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.msg || error.message;
        throw new Error(`Binance API error fetching price for ${tradingPair}: ${message}`);
      }
      throw new Error(`Failed to fetch price for ${tradingPair}: ${error}`);
    }
  }
}
