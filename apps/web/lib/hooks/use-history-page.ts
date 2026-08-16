'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnalyses } from '@/lib/hooks/use-analyses';
import { useLivePrices } from '@/lib/hooks/use-live-prices';
import { bucketOf, summariseResults, type Bucket } from '@/lib/history-buckets';
import type { AnalysisListItem } from '@/types/analyses';
import {
  DEFAULT_FILTERS,
  RANGE_DAYS,
  type HistoryFilters,
} from '@/components/features/history/filter-bar';

/**
 * One scored fetch per window, then filter, sort and reveal in memory.
 *
 * The fetch is bounded by DATE, not by an arbitrary row count — `days=30`
 * returns thirty days or says it was truncated, where the old cap of 200
 * silently dropped the oldest rows and made every total on the page wrong.
 *
 * Outcome filtering is deliberately client-side: outcome comes from replaying
 * candles rather than from a column, so the server cannot filter it in SQL and
 * doing it after scoring would re-score the whole set on every reveal.
 */
const FETCH_LIMIT = 1000;
const PAGE_SIZE = 20;

export function useHistoryPage() {
  const router = useRouter();
  const [filters, setFiltersState] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [bucket, setBucket] = useState<Bucket | 'all'>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const { data, isLoading, error } = useAnalyses({
    limit: FETCH_LIMIT,
    days: RANGE_DAYS[filters.dateRange],
    status: true,
  });

  const rows = useMemo(() => data?.analyses ?? [], [data]);
  const coins = useMemo(
    () => Array.from(new Set(rows.map((r) => r.symbol))).sort(),
    [rows],
  );

  // One socket for every coin on the page, regardless of what is filtered —
  // reconnecting on every filter change would cost more than the idle stream.
  const { prices, connected } = useLivePrices(coins);

  const matched = useMemo(() => {
    const search = filters.search.trim().toUpperCase();

    const result = rows.filter((row) => {
      if (search && !row.symbol.includes(search)) return false;
      if (filters.coin !== 'all' && row.symbol !== filters.coin) return false;
      if (bucket !== 'all' && bucketOf(row.status) !== bucket) return false;
      return true;
    });

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
        return [...result].reverse();
      case 'best':
        return [...result].sort((a, b) => byR(a, b, 1));
      case 'worst':
        return [...result].sort((a, b) => byR(a, b, -1));
      default:
        return result; // already newest-first from the API
    }
  }, [rows, filters, bucket]);

  // The scoreboard describes the FETCHED window, not the current filter — the
  // funnel is only honest if it counts the analyses that never started too.
  const summary = useMemo(() => summariseResults(rows, data?.epoch), [rows, data?.epoch]);

  const entries = useMemo(() => matched.slice(0, visible), [matched, visible]);
  const hasMore = visible < matched.length;

  // Infinite scroll: a sentinel below the last card asks for the next slice.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      ([e]) => e.isIntersecting && setVisible((v) => v + PAGE_SIZE),
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, matched.length]);

  const resetView = useCallback(() => setVisible(PAGE_SIZE), []);

  return {
    summary,
    epoch: data?.epoch,
    truncated: data?.truncated ?? false,
    entries,
    coins,
    prices,
    livePricesConnected: connected,
    totalFiltered: matched.length,
    totalFetched: rows.length,
    filters,
    bucket,
    hasMore,
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
