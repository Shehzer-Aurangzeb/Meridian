'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnalyses } from '@/lib/hooks/use-analyses';
import { summariseAnalyses } from '@/lib/summarise-analyses';
import type { AnalysisListItem } from '@/types/analyses';
import {
  DEFAULT_FILTERS,
  type HistoryFilters,
} from '@/components/features/history/filter-bar';
import type { PaginationState } from '@/components/features/history/pagination';

/**
 * One fetch, then filter, sort and page in memory.
 *
 * ponytail: 200 rows is the API's ceiling and roughly a week of scheduled runs
 * at ten coins every 8 hours. Move filtering server-side when that stops
 * covering the range you want to look at.
 */
const FETCH_LIMIT = 200;
const PAGE_SIZE = 12;

const RANGE_MS: Record<HistoryFilters['dateRange'], number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  all: Number.POSITIVE_INFINITY,
};

export function useHistoryPage() {
  const router = useRouter();
  const [filters, setFiltersState] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useAnalyses({ limit: FETCH_LIMIT });
  const rows = useMemo(() => data?.analyses ?? [], [data]);

  const summaryStats = useMemo(() => summariseAnalyses(rows), [rows]);

  const matched = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    const cutoff = Date.now() - RANGE_MS[filters.dateRange];

    const result = rows.filter((row) => {
      if (search && !row.symbol.includes(search)) return false;
      if (filters.regime !== 'all' && row.regime !== filters.regime) return false;
      if (filters.route !== 'all' && row.strategyRoute !== filters.route) return false;
      return new Date(row.createdAt).getTime() >= cutoff;
    });

    // Already newest-first from the API; oldest-first is the same list reversed.
    return filters.sort === 'oldest' ? [...result].reverse() : result;
  }, [rows, filters]);

  const entries = useMemo(
    () => matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [matched, page]
  );

  const pagination: PaginationState = {
    page,
    pageSize: PAGE_SIZE,
    totalCount: matched.length,
  };

  return {
    summaryStats,
    entries,
    totalFiltered: matched.length,
    totalFetched: rows.length,
    filters,
    pagination,
    isLoading,
    error: error?.message ?? null,
    // Any filter change invalidates the current page number.
    setFilters: (next: HistoryFilters) => {
      setFiltersState(next);
      setPage(1);
    },
    setPage,
    openAnalysis: (entry: AnalysisListItem) => router.push(`/history/${entry.id}`),
  };
}
