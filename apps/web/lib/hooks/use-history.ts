'use client';

import { useQuery } from '@tanstack/react-query';
import type { HistoryResponse, HistoryQueryOptions } from '@/types';
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
 * Hook for fetching analysis history for a specific coin
 * Used on: History page
 */
export function useHistory(coin: string, options?: HistoryQueryOptions) {
  const queryString = buildQueryString(options);
  
  return useQuery({
    queryKey: queryKeys.history.byCoin(coin),
    queryFn: () => fetchApi<HistoryResponse>(`/api/history/${coin}${queryString}`),
    enabled: !!coin,
  });
}
