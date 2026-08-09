'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api/client';
import type { HealthResponse } from '@/types/analyses';
import { queryKeys } from './query-keys';

/** Works signed out, which tells "API is down" from "session expired". */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => fetchApi<HealthResponse>('/api/health'),
    refetchInterval: 30_000,
  });
}
