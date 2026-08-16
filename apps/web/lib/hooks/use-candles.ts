'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api/client';
import type { Candle } from '@/app/api/candles/route';
import { queryKeys } from './query-keys';

export type { Candle };

interface CandlesResponse {
  symbol: string;
  interval: string;
  candles: Candle[];
}

/**
 * Public market data, so it is cached hard: the only candle that changes is the
 * one still forming, and a chart of a saved analysis is mostly history.
 */
export function useCandles(
  symbol: string | undefined,
  interval = '1h',
  limit = 500,
  /**
   * Anchor the window here (ms) instead of ending it at now. Without it the
   * series is always "the most recent N", which for an analysis older than N
   * bars does not contain the analysis at all.
   */
  startTime?: number,
) {
  return useQuery({
    queryKey: queryKeys.candles(symbol ?? '', interval, startTime),
    queryFn: async () => {
      const data = await fetchApi<CandlesResponse>(
        `/api/candles?symbol=${encodeURIComponent(symbol ?? '')}&interval=${interval}&limit=${limit}` +
          (startTime === undefined ? '' : `&startTime=${startTime}`),
      );
      return data.candles;
    },
    enabled: Boolean(symbol),
    staleTime: 60 * 1000,
    // The socket owns the newest bar, and closed bars never change. A refetch
    // on window focus only re-ran setData, which snapped the forming candle
    // back to its state at fetch time until the next socket message.
    refetchOnWindowFocus: false,
  });
}
