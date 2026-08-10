'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, RequestError } from '@/lib/api/client';
import type {
  AnalysisDetail,
  AnalysisListResponse,
  RunAnalysisResponse,
  SavedNarration,
} from '@/types/analyses';
import { queryKeys } from './query-keys';

export interface AnalysesFilter {
  symbol?: string;
  /** Backend default 50, max 1000. */
  limit?: number;
  /** Only analyses from the last N days — a window, not a silent row cap. */
  days?: number;
  /**
   * Score every row: outcome, R, freshness, and the plan geometry a card
   * draws. Costs the backend one price and one candle fetch PER COIN, so leave
   * it off wherever the rows are only being counted.
   */
  status?: boolean;
}

export function useAnalyses(filter: AnalysesFilter = {}) {
  const params = new URLSearchParams();
  if (filter.symbol) params.set('symbol', filter.symbol.toUpperCase());
  if (filter.limit) params.set('limit', String(filter.limit));
  if (filter.days) params.set('days', String(filter.days));
  if (filter.status) params.set('status', 'true');
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

/**
 * Claude's read of one analysis.
 *
 * Costs a model call the first time and nothing after — the backend caches it
 * on the row. Kept out of `useAnalysis` deliberately: the analysis must render
 * whether or not anyone wants the prose, and whether or not Claude is even
 * reachable.
 */
export function useNarrate(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<SavedNarration>(`/api/analyses/${id}/narrate`, { method: 'POST' }),
    // The call measures ~21s against a 30s API Gateway ceiling. If a cold
    // start eats the margin the gateway hangs up — but Lambda keeps running,
    // finishes, and writes the narration to the row. So the retry is not
    // hopeful: by the time it lands the endpoint returns the cached text.
    // Only for gateway-level failures; a 503 means Claude declined or the key
    // is missing, and retrying that just wastes another 30 seconds.
    retry: (failureCount, error) =>
      failureCount < 1 && error instanceof RequestError && error.status >= 502,
    retryDelay: 15_000,
    onSuccess: (narration) => {
      // Write it straight into the open detail view rather than refetching —
      // that would re-run the outcome replay for a field we already hold.
      queryClient.setQueryData<AnalysisDetail>(
        queryKeys.analyses.detail(id),
        (current) => (current ? { ...current, narration } : current),
      );
    },
  });
}
