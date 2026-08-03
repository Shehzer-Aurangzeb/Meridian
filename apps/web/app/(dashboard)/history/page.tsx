'use client';

import { Suspense } from 'react';
import { HistoryPageHeader } from '@/components/features/history/history-page-header';
import { SummaryStats } from '@/components/features/history/summary-stats';
import { FilterBar } from '@/components/features/history/filter-bar';
import { HistoryTable } from '@/components/features/history/history-table';
import { Pagination } from '@/components/features/history/pagination';
import { Disclaimer } from '@/components/ui/disclaimer';
import { useHistoryPage } from '@/lib/hooks/use-history-page';

function HistoryLoading() {
  return (
    <div className="p-5 md:p-8 lg:p-10">
      <div className="animate-pulse">
        <div className="h-8 bg-surface rounded w-48 mb-6" />
        <div className="h-32 bg-surface rounded mb-8" />
        <div className="h-16 bg-surface rounded mb-4" />
        <div className="h-96 bg-surface rounded" />
      </div>
    </div>
  );
}

function HistoryContent() {
  const {
    summaryStats,
    entries,
    totalFiltered,
    filters,
    pagination,
    isLoading,
    setFilters,
    setPage,
    handleRowClick,
  } = useHistoryPage();

  if (isLoading) {
    return <HistoryLoading />;
  }

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <HistoryPageHeader />

      {summaryStats && <SummaryStats data={summaryStats} />}

      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        totalCount={pagination.totalCount}
        showingCount={totalFiltered}
      />

      <HistoryTable entries={entries} onRowClick={handleRowClick} />

      <Pagination pagination={pagination} onPageChange={setPage} />

      <Disclaimer text="Outcomes are tracked from the entry zone until price hits target or stop. 'Open' trades remain unresolved." />
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryLoading />}>
      <HistoryContent />
    </Suspense>
  );
}
