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
 * Coin and bucket filters go to the SERVER. Filtering here would only ever see
 * the pages already loaded, so "no losing trades" would mean "none on page one".
 * Search stays local — it is a substring match on rows already on screen.
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
    symbol: filters.coin === 'all' ? undefined : filters.coin,
  });

  // Independent of the rows: the numbers appear without waiting for a page.
  const stats = useAnalysesStats({ days });

  const rows = useMemo(
    () => data?.pages.flatMap((p) => p.analyses) ?? [],
    [data],
  );
  const epoch = data?.pages[0]?.epoch ?? stats.data?.epoch;

  const coins = useMemo(
    () => Array.from(new Set(rows.map((r) => r.symbol))).sort(),
    [rows],
  );

  // One socket for every coin on screen, regardless of filter — reconnecting
  // on every filter change would cost more than the idle stream.
  const { prices, connected } = useLivePrices(coins);

  const entries = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    const matched = search ? rows.filter((r) => r.symbol.includes(search)) : rows;

    // Unscored rows sort last under an R sort — they have no R to rank on.
    const byR = (a: AnalysisListItem, b: AnalysisListItem, dir: 1 | -1) => {
      const ra = a.status?.netR;
      const rb = b.status?.netR;
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return (rb - ra) * dir;
    };

    switch (filters.sort) {
      case 'oldest':
        return [...matched].reverse();
      case 'best':
        return [...matched].sort((a, b) => byR(a, b, 1));
      case 'worst':
        return [...matched].sort((a, b) => byR(a, b, -1));
      default:
        return matched; // already newest-first from the API
    }
  }, [rows, filters.search, filters.sort]);

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
    entries,
    coins,
    prices,
    livePricesConnected: connected,
    /** Rows loaded so far. The scoreboard's `total` is the real count. */
    totalFetched: rows.length,
    totalFiltered: entries.length,
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
