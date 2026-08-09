'use client';

import { useCallback, useMemo, useReducer } from 'react';
import { useRouter } from 'next/navigation';
import { usePerformance } from '@/lib/hooks/use-performance';
import {
  mapToSummaryStats,
  mapToHistoryEntries,
  filterHistoryEntries,
  sortHistoryEntries,
} from '@/lib/utils/history-mapper';
import type { SummaryStatsData } from '@/components/features/history/summary-stats';
import type { HistoryEntry } from '@/components/features/history/history-table';
import type { HistoryFilters } from '@/components/features/history/filter-bar';
import type { PaginationState } from '@/components/features/history/pagination';

interface HistoryPageState {
  filters: HistoryFilters;
  pagination: PaginationState;
}

type HistoryPageAction =
  | { type: 'SET_FILTERS'; filters: HistoryFilters }
  | { type: 'SET_SEARCH'; search: string }
  | { type: 'SET_SIGNAL_FILTER'; signal: HistoryFilters['signal'] }
  | { type: 'SET_OUTCOME_FILTER'; outcome: HistoryFilters['outcome'] }
  | { type: 'SET_DATE_RANGE'; dateRange: HistoryFilters['dateRange'] }
  | { type: 'SET_SORT'; sort: HistoryFilters['sort'] }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_PAGE_SIZE'; pageSize: number }
  | { type: 'RESET_FILTERS' };

const DEFAULT_FILTERS: HistoryFilters = {
  search: '',
  signal: 'all',
  outcome: 'all',
  dateRange: '30d',
  sort: 'newest',
};

const DEFAULT_PAGINATION: PaginationState = {
  page: 1,
  pageSize: 12,
  totalCount: 0,
};

const initialState: HistoryPageState = {
  filters: DEFAULT_FILTERS,
  pagination: DEFAULT_PAGINATION,
};

function historyReducer(state: HistoryPageState, action: HistoryPageAction): HistoryPageState {
  switch (action.type) {
    case 'SET_FILTERS':
      return {
        ...state,
        filters: action.filters,
        pagination: { ...state.pagination, page: 1 }, // Reset to page 1 on filter change
      };

    case 'SET_SEARCH':
      return {
        ...state,
        filters: { ...state.filters, search: action.search },
        pagination: { ...state.pagination, page: 1 },
      };

    case 'SET_SIGNAL_FILTER':
      return {
        ...state,
        filters: { ...state.filters, signal: action.signal },
        pagination: { ...state.pagination, page: 1 },
      };

    case 'SET_OUTCOME_FILTER':
      return {
        ...state,
        filters: { ...state.filters, outcome: action.outcome },
        pagination: { ...state.pagination, page: 1 },
      };

    case 'SET_DATE_RANGE':
      return {
        ...state,
        filters: { ...state.filters, dateRange: action.dateRange },
        pagination: { ...state.pagination, page: 1 },
      };

    case 'SET_SORT':
      return {
        ...state,
        filters: { ...state.filters, sort: action.sort },
        pagination: { ...state.pagination, page: 1 },
      };

    case 'SET_PAGE':
      return {
        ...state,
        pagination: { ...state.pagination, page: action.page },
      };

    case 'SET_PAGE_SIZE':
      return {
        ...state,
        pagination: { ...state.pagination, pageSize: action.pageSize, page: 1 },
      };

    case 'RESET_FILTERS':
      return {
        ...state,
        filters: DEFAULT_FILTERS,
        pagination: { ...state.pagination, page: 1 },
      };

    default:
      return state;
  }
}

export function useHistoryPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(historyReducer, initialState);

  const { data: performanceResponse, isLoading, error } = usePerformance({ limit: 100 });

  const summaryStats: SummaryStatsData | null = useMemo(() => {
    if (!performanceResponse?.success || !performanceResponse.data) return null;
    return mapToSummaryStats(performanceResponse.data);
  }, [performanceResponse]);

  const allEntries: HistoryEntry[] = useMemo(() => {
    if (!performanceResponse?.success || !performanceResponse.data) return [];
    return mapToHistoryEntries(performanceResponse.data.recentAnalyses);
  }, [performanceResponse]);

  const filteredEntries = useMemo(() => {
    return filterHistoryEntries(allEntries, {
      search: state.filters.search,
      signal: state.filters.signal,
      outcome: state.filters.outcome,
    });
  }, [allEntries, state.filters.search, state.filters.signal, state.filters.outcome]);

  const sortedEntries = useMemo(() => {
    return sortHistoryEntries(filteredEntries, state.filters.sort);
  }, [filteredEntries, state.filters.sort]);

  const paginatedEntries = useMemo(() => {
    const start = (state.pagination.page - 1) * state.pagination.pageSize;
    const end = start + state.pagination.pageSize;
    return sortedEntries.slice(start, end);
  }, [sortedEntries, state.pagination.page, state.pagination.pageSize]);

  const pagination: PaginationState = useMemo(() => ({
    ...state.pagination,
    totalCount: sortedEntries.length,
  }), [state.pagination, sortedEntries.length]);

  const setFilters = useCallback((filters: HistoryFilters) => {
    dispatch({ type: 'SET_FILTERS', filters });
  }, []);

  const setSearch = useCallback((search: string) => {
    dispatch({ type: 'SET_SEARCH', search });
  }, []);

  const setSignalFilter = useCallback((signal: HistoryFilters['signal']) => {
    dispatch({ type: 'SET_SIGNAL_FILTER', signal });
  }, []);

  const setOutcomeFilter = useCallback((outcome: HistoryFilters['outcome']) => {
    dispatch({ type: 'SET_OUTCOME_FILTER', outcome });
  }, []);

  const setDateRange = useCallback((dateRange: HistoryFilters['dateRange']) => {
    dispatch({ type: 'SET_DATE_RANGE', dateRange });
  }, []);

  const setSort = useCallback((sort: HistoryFilters['sort']) => {
    dispatch({ type: 'SET_SORT', sort });
  }, []);

  const setPage = useCallback((page: number) => {
    dispatch({ type: 'SET_PAGE', page });
  }, []);

  const resetFilters = useCallback(() => {
    dispatch({ type: 'RESET_FILTERS' });
  }, []);

  const handleRowClick = useCallback((entry: HistoryEntry) => {
    router.push(`/analysis?id=${entry.id}`);
  }, [router]);

  return {
    summaryStats,
    entries: paginatedEntries,
    totalFiltered: sortedEntries.length,

    filters: state.filters,
    pagination,

    isLoading,
    error: error?.message ?? null,

    setFilters,
    setSearch,
    setSignalFilter,
    setOutcomeFilter,
    setDateRange,
    setSort,
    resetFilters,

    setPage,

    handleRowClick,
  };
}
