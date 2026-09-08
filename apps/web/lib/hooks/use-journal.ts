'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api/client';
import type { SimList, SimStats } from '@/types/sim';

/**
 * The journal, and the scoreboard over it.
 *
 * Both endpoints score anything whose window has closed before answering, so
 * these reads are what resolve the record. There is no scheduled scorer.
 */
export function useJournal() {
  const list = useQuery({
    queryKey: ['sim', 'list'],
    queryFn: () => fetchApi<SimList>('/api/sim?take=500'),
    staleTime: 60_000,
  });

  const stats = useQuery({
    queryKey: ['sim', 'stats'],
    queryFn: () => fetchApi<SimStats>('/api/sim/stats'),
    staleTime: 60_000,
  });

  return {
    rows: list.data?.rows ?? [],
    stats: stats.data ?? null,
    loading: list.isPending || stats.isPending,
    error: ((list.error ?? stats.error) as Error | undefined)?.message ?? null,
  };
}
