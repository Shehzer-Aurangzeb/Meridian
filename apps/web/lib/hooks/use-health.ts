'use client';

import { useQuery } from '@tanstack/react-query';
import type { BffHealthResponse } from '@/types';
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

// ============ Hooks ============

/**
 * Hook for health check
 * Checks both BFF and backend health
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => fetchApi<BffHealthResponse>('/api/health'),
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
