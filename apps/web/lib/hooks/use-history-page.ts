'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnalysesPages, useAnalysesStats } from '@/lib/hooks/use-analyses';
import { useLivePrices } from '@/lib/hooks/use-live-prices';
import type { Bucket } from '@/lib/history-buckets';
import type { AnalysisListItem } from '@/types/analyses';
import {
  DEFAULT_FILTERS,
  RANGE_DAYS,
  type HistoryFilters,
} from '@/components/features/history/filter-bar';

/**
 * The history page: rows a page at a time, scoreboard in its own request.
 *
 * EVERY filter and the sort go to the server. Doing any of it here would only
 * ever see the pages already scrolled past, so "worst R first" would mean
 * "worst of the twenty on screen" and quietly read as a result.
 */
export function useHistoryPage() {
  const router = useRouter();
  const [filters, setFiltersState] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [bucket, setBucket] = useState<Bucket | 'all'>('all');

  const days = RANGE_DAYS[filters.dateRange];
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAnalysesPages({
    days,
    status: true,
    bucket,
    sort: filters.sort,
    symbol: filters.coin === 'all' ? undefined : filters.coin,
  });

  // Independent of the rows: the numbers appear without waiting for a page.
  const stats = useAnalysesStats({ days });

  const rows = useMemo(
    () => data?.pages.flatMap((p) => p.analyses) ?? [],
    [data],
  );
  const epoch = data?.pages[0]?.epoch ?? stats.data?.epoch;

  // Coins accumulate and never shrink. The set grows as pages arrive, and
  // rebuilding the socket every time one did was a teardown per scroll.
  const seenCoins = useRef<Set<string>>(new Set());
  const coins = useMemo(() => {
    for (const r of rows) seenCoins.current.add(r.symbol);
    return Array.from(seenCoins.current).sort();
  }, [rows]);

  const { prices, connected } = useLivePrices(coins);

  // Infinite scroll: a sentinel below the last card asks for the next page.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      ([e]) => e.isIntersecting && void fetchNextPage(),
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

  const resetView = useCallback(() => window.scrollTo({ top: 0 }), []);

  return {
    summary: stats.data ?? null,
    summaryLoading: stats.isLoading,
    epoch,
    entries: rows,
    coins,
    prices,
    livePricesConnected: connected,
    /** Rows loaded so far. The scoreboard's `total` is the real count. */
    loadedCount: rows.length,
    filters,
    bucket,
    hasMore: hasNextPage,
    loadingMore: isFetchingNextPage,
    sentinel,
    isLoading,
    error: error?.message ?? null,
    setFilters: (next: HistoryFilters) => {
      setFiltersState(next);
      resetView();
    },
    setBucket: (next: Bucket | 'all') => {
      setBucket(next);
      resetView();
    },
    openAnalysis: (entry: AnalysisListItem) => router.push(`/history/${entry.id}`),
  };
}
