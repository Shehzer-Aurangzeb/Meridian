'use client';

import { useQuery } from '@tanstack/react-query';
import type { PerformanceResponse, HistoryQueryOptions } from '@/types';
import { queryKeys } from './query-keys';

// ============ Fetch Helper ============

async function fetchApi<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }
  
  return response.json();
}

function buildQueryString(options?: HistoryQueryOptions): string {
  if (!options) return '';
  
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);
  
  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

// ============ Hooks ============

/**
 * @deprecated Uses legacy TradeAnalysis backend. Migrate to coordinator-runs endpoint.
 * Hook for fetching global performance stats
 * Used on: Dashboard (stats strip)
 */
export function usePerformance(options?: HistoryQueryOptions) {
  const queryString = buildQueryString(options);
  
  return useQuery({
    queryKey: queryKeys.performance.global(),
    queryFn: () => fetchApi<PerformanceResponse>(`/api/performance${queryString}`),
  });
}

/**
 * @deprecated Uses legacy TradeAnalysis backend. Migrate to coordinator-runs endpoint.
 * Hook for fetching performance stats for a specific coin
 * Used on: Coin detail view
 */
export function usePerformanceByCoin(coin: string, options?: HistoryQueryOptions) {
  const queryString = buildQueryString(options);
  
  return useQuery({
    queryKey: queryKeys.performance.byCoin(coin),
    queryFn: () => fetchApi<PerformanceResponse>(`/api/performance/${coin}${queryString}`),
    enabled: !!coin,
  });
}
