'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { HistoryPageHeader } from '@/components/features/history/history-page-header';
import { SummaryStats, MOCK_SUMMARY_STATS } from '@/components/features/history/summary-stats';
import { FilterBar } from '@/components/features/history/filter-bar';
import type { HistoryFilters } from '@/components/features/history/filter-bar';
import { HistoryTable, MOCK_HISTORY } from '@/components/features/history/history-table';
import type { HistoryEntry } from '@/components/features/history/history-table';
import { Pagination } from '@/components/features/history/pagination';
import type { PaginationState } from '@/components/features/history/pagination';
import { Disclaimer } from '@/components/ui/disclaimer';

export default function HistoryPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<HistoryFilters>({
    search: '',
    signal: 'all',
    outcome: 'all',
    dateRange: '30d',
    sort: 'newest',
  });
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 12,
    totalCount: 128,
  });

  const filteredEntries = useMemo(() => {
    return MOCK_HISTORY.filter((entry) => {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        if (
          !entry.coin.toLowerCase().includes(search) &&
          !entry.strategy.toLowerCase().includes(search)
        ) {
          return false;
        }
      }

      if (filters.signal !== 'all') {
        if (filters.signal === 'skipped' && entry.signal !== 'skip') return false;
        if (filters.signal === 'long' && entry.signal !== 'long') return false;
        if (filters.signal === 'short' && entry.signal !== 'short') return false;
      }

      if (filters.outcome !== 'all') {
        if (filters.outcome === 'win' && entry.outcome !== 'win') return false;
        if (filters.outcome === 'loss' && entry.outcome !== 'loss') return false;
        if (filters.outcome === 'open' && entry.outcome !== 'open') return false;
      }

      return true;
    });
  }, [filters.search, filters.signal, filters.outcome]);

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      if (filters.sort === 'conf-desc') return b.confidence - a.confidence;
      if (filters.sort === 'conf-asc') return a.confidence - b.confidence;
      return 0;
    });
  }, [filteredEntries, filters.sort]);

  const handleRowClick = useCallback((entry: HistoryEntry) => {
    router.push(`/analysis?id=${entry.id}`);
  }, [router]);

  const handlePageChange = useCallback((page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  }, []);

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <HistoryPageHeader />

      <SummaryStats data={MOCK_SUMMARY_STATS} />

      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        totalCount={pagination.totalCount}
        showingCount={sortedEntries.length}
      />

      <HistoryTable entries={sortedEntries} onRowClick={handleRowClick} />

      <Pagination pagination={pagination} onPageChange={handlePageChange} />

      <Disclaimer text="Outcomes are tracked from the entry zone until price hits target or stop. 'Open' trades remain unresolved." />
    </div>
  );
}
