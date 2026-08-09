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
) {
  return useQuery({
    queryKey: queryKeys.candles(symbol ?? '', interval),
    queryFn: async () => {
      const data = await fetchApi<CandlesResponse>(
        `/api/candles?symbol=${encodeURIComponent(symbol ?? '')}&interval=${interval}&limit=${limit}`,
      );
      return data.candles;
    },
    enabled: Boolean(symbol),
    staleTime: 60 * 1000,
  });
}
