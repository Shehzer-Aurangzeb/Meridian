'use client';

import { HistoryPageHeader } from '@/components/features/history/history-page-header';
import { SummaryStats } from '@/components/features/history/summary-stats';
import { FilterBar } from '@/components/features/history/filter-bar';
import { HistoryTable } from '@/components/features/history/history-table';
import { Pagination } from '@/components/features/history/pagination';
import { Disclaimer } from '@/components/ui/disclaimer';
import { Skeleton } from '@/components/ui/skeleton';
import { useHistoryPage } from '@/lib/hooks/use-history-page';

function HistoryLoading() {
  return (
    <div className="animate-pulse">
      <Skeleton className="h-8 w-48 mb-6" />
      <Skeleton className="h-32 mb-8" />
      <Skeleton className="h-16 mb-4" />
      <Skeleton className="h-96" />
    </div>
  );
}

export default function HistoryPage() {
  const {
    summaryStats,
    entries,
    totalFiltered,
    totalFetched,
    filters,
    pagination,
    isLoading,
    error,
    setFilters,
    setPage,
    openAnalysis,
  } = useHistoryPage();

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <HistoryPageHeader />

      {isLoading && <HistoryLoading />}

      {error && (
        <div className="bg-surface border border-rust/30 rounded-lg p-6 text-center">
          <p className="text-rust text-sm font-medium">Could not load analyses</p>
          <p className="text-text-tertiary text-sm mt-1">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {summaryStats && <SummaryStats data={summaryStats} />}

          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            totalCount={totalFetched}
            showingCount={totalFiltered}
          />

          <HistoryTable entries={entries} onRowClick={openAnalysis} />

          <Pagination pagination={pagination} onPageChange={setPage} />
        </>
      )}

      <Disclaimer text="Outcomes are scored per analysis, on the analysis itself — open one to see whether its plans filled, stopped or were missed." />
    </div>
  );
}
