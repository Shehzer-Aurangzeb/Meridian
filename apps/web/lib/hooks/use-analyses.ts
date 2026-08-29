'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, RequestError } from '@/lib/api/client';
import type {
  AnalysesStats,
  AnalysisDetail,
  AnalysisListResponse,
  RunAnalysisResponse,
  SavedNarration,
} from '@/types/analyses';
import type { Bucket } from '@/lib/history-buckets';
import { queryKeys } from './query-keys';

export interface AnalysesFilter {
  symbol?: string;
  /** Rows per page. Backend default 20. */
  limit?: number;
  /** Only analyses from the last N days — a window, not a silent row cap. */
  days?: number;
  /**
   * Include outcome, R, freshness and the plan geometry a card draws. Costs
   * the backend a price per coin, so leave it off where rows are only counted.
   */
  status?: boolean;
  /** Filter by scoreboard group. Applied in SQL, so it spans every page. */
  bucket?: Bucket | 'all';
  /** Order. Applied in SQL, so "best R" means best of all of them. */
  sort?: 'newest' | 'oldest' | 'best' | 'worst';
}

function toQuery(filter: AnalysesFilter, cursor?: string): string {
  const params = new URLSearchParams();
  if (filter.symbol) params.set('symbol', filter.symbol.toUpperCase());
  if (filter.limit) params.set('limit', String(filter.limit));
  if (filter.days) params.set('days', String(filter.days));
  if (filter.status) params.set('status', 'true');
  if (filter.bucket && filter.bucket !== 'all') params.set('bucket', filter.bucket);
  if (filter.sort && filter.sort !== 'newest') params.set('sort', filter.sort);
  if (cursor) params.set('cursor', cursor);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/** One page. Used where a fixed number of rows is wanted and nothing more. */
export function useAnalyses(filter: AnalysesFilter = {}) {
  return useQuery({
    queryKey: queryKeys.analyses.list(filter),
    queryFn: () => fetchApi<AnalysisListResponse>(`/api/analyses${toQuery(filter)}`),
  });
}

/**
 * The history list, a page at a time.
 *
 * Cursor rather than offset: three analyses are saved a day, so rows arrive
 * between requests, and offset paging would repeat or skip a row every time
 * one did.
 */
export function useAnalysesPages(filter: AnalysesFilter = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.analyses.pages(filter),
    queryFn: ({ pageParam }) =>
      fetchApi<AnalysisListResponse>(`/api/analyses${toQuery(filter, pageParam)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Someone who scrolls a long way should not hold every page they passed.
    maxPages: 10,
  });
}

/**
 * The scoreboard. Its own request, so the numbers land without waiting for
 * rows — and it counts the whole window, not the page on screen.
 */
export function useAnalysesStats(filter: Pick<AnalysesFilter, 'symbol' | 'days'> = {}) {
  const params = new URLSearchParams();
  if (filter.symbol) params.set('symbol', filter.symbol.toUpperCase());
  if (filter.days) params.set('days', String(filter.days));
  const q = params.toString();

  return useQuery({
    queryKey: queryKeys.analyses.stats(filter),
    queryFn: () => fetchApi<AnalysesStats>(`/api/analyses/stats${q ? `?${q}` : ''}`),
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
 * The AI's explanation of one analysis. Costs money the first time and nothing
 * after. Kept separate on purpose: the analysis must display whether or not
 * the AI is available.
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
