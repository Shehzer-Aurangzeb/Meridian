'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api/client';
import type {
  AnalysisDetail,
  AnalysisListResponse,
  RunAnalysisResponse,
} from '@/types/analyses';
import { queryKeys } from './query-keys';

export interface AnalysesFilter {
  symbol?: string;
  /** Backend default 50, max 200. */
  limit?: number;
}

export function useAnalyses(filter: AnalysesFilter = {}) {
  const params = new URLSearchParams();
  if (filter.symbol) params.set('symbol', filter.symbol.toUpperCase());
  if (filter.limit) params.set('limit', String(filter.limit));
  const query = params.toString();

  return useQuery({
    queryKey: queryKeys.analyses.list(filter),
    queryFn: () =>
      fetchApi<AnalysisListResponse>(`/api/analyses${query ? `?${query}` : ''}`),
  });
}

/** Level map, plans, live price, freshness and outcomes — all recomputed on read. */
export function useAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.analyses.detail(id ?? ''),
    queryFn: () => fetchApi<AnalysisDetail>(`/api/analyses/${id}`),
    enabled: Boolean(id),
    // Short: freshness is a function of the current price.
    staleTime: 30 * 1000,
  });
}

/** Takes seconds — four Binance timeframes, plus a cold Lambda boot. */
export function useRunAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (symbol: string) =>
      fetchApi<RunAnalysisResponse>(
        `/api/analyses?symbol=${encodeURIComponent(symbol.toUpperCase())}`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      // The new row tops every list, and may have superseded an open detail view.
      queryClient.invalidateQueries({ queryKey: queryKeys.analyses.all });
    },
  });
}
