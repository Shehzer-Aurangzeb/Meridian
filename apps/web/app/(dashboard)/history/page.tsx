'use client';

import { HistoryPageHeader } from '@/components/features/history/history-page-header';
import { ResultsScoreboard } from '@/components/features/history/results-scoreboard';
import { FilterBar } from '@/components/features/history/filter-bar';
import { AnalysisCard } from '@/components/features/history/analysis-card';
import { Disclaimer } from '@/components/ui/disclaimer';
import { Skeleton } from '@/components/ui/skeleton';
import { useHistoryPage } from '@/lib/hooks/use-history-page';
import { isPreEpoch } from '@/lib/history-buckets';

function HistoryLoading() {
  return (
    <div className="animate-pulse">
      <Skeleton className="h-8 w-48 mb-6" />
      <Skeleton className="h-24 mb-8" />
      <Skeleton className="h-16 mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const {
    summary,
    epoch,
    truncated,
    entries,
    coins,
    prices,
    livePricesConnected,
    totalFiltered,
    totalFetched,
    filters,
    bucket,
    hasMore,
    sentinel,
    isLoading,
    error,
    setFilters,
    setBucket,
    openAnalysis,
  } = useHistoryPage();

  return (
    <div>
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
          <ResultsScoreboard
            summary={summary}
            truncated={truncated}
            activeBucket={bucket}
            onBucketChange={setBucket}
          />

          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            coins={coins}
            totalCount={totalFetched}
            showingCount={totalFiltered}
          />

          {entries.length === 0 ? (
            <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-10 text-center">
              <p className="text-text-secondary text-sm">
                No analyses match these filters.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {entries.map((entry) => (
                <AnalysisCard
                  key={entry.id}
                  entry={entry}
                  livePrice={prices[entry.symbol]}
                  preEpoch={isPreEpoch(entry, epoch)}
                  onOpen={() => openAnalysis(entry)}
                />
              ))}
            </div>
          )}

          {/* Sits below the grid; crossing it reveals the next slice. */}
          <div ref={sentinel} className="h-8" />
          {hasMore && (
            <p className="text-center text-[12px] text-text-tertiary py-2">
              Loading more…
            </p>
          )}
        </>
      )}

      <Disclaimer
        text={`Paper outcomes replayed from 1h candles — nothing here was traded. R is net of a 0.14% round trip, the §14h cost model. ${
          livePricesConnected ? 'Prices are live.' : 'Live prices unavailable; showing the price each analysis was scored against.'
        }`}
      />
    </div>
  );
}
