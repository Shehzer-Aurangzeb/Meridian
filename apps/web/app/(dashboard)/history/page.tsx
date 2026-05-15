'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  HistoryPageHeader,
  SummaryStats,
  FilterBar,
  HistoryTable,
  Pagination,
  MOCK_SUMMARY_STATS,
  MOCK_HISTORY,
} from '@/components/history';
import type { HistoryFilters, HistoryEntry, PaginationState } from '@/components/history';

/**
 * Disclaimer footer
 */
function Disclaimer() {
  return (
    <footer className="flex items-center justify-between text-xs text-text-tertiary mt-10 pt-6 border-t border-border/10 dark:border-border">
      <div>
        Outcomes are tracked from the entry zone until price hits target or stop. "Open" trades remain unresolved.
      </div>
      <div className="font-display text-sm font-medium tracking-[0.04em]">Meridian</div>
    </footer>
  );
}

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

  // Filter entries based on current filters
  const filteredEntries = MOCK_HISTORY.filter((entry) => {
    // Search filter
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (
        !entry.coin.toLowerCase().includes(search) &&
        !entry.strategy.toLowerCase().includes(search)
      ) {
        return false;
      }
    }

    // Signal filter
    if (filters.signal !== 'all') {
      if (filters.signal === 'skipped' && entry.signal !== 'skip') return false;
      if (filters.signal === 'long' && entry.signal !== 'long') return false;
      if (filters.signal === 'short' && entry.signal !== 'short') return false;
    }

    // Outcome filter
    if (filters.outcome !== 'all') {
      if (filters.outcome === 'win' && entry.outcome !== 'win') return false;
      if (filters.outcome === 'loss' && entry.outcome !== 'loss') return false;
      if (filters.outcome === 'open' && entry.outcome !== 'open') return false;
    }

    return true;
  });

  // Sort entries
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (filters.sort === 'conf-desc') return b.confidence - a.confidence;
    if (filters.sort === 'conf-asc') return a.confidence - b.confidence;
    // newest/oldest would sort by actual date in production
    return 0;
  });

  const handleRowClick = (entry: HistoryEntry) => {
    // Navigate to analysis detail page
    router.push(`/analysis?id=${entry.id}`);
  };

  const handlePageChange = (page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  };

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

      <Disclaimer />
    </div>
  );
}
