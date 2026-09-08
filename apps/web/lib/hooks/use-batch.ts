'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api/client';
import { queryKeys } from './query-keys';
import type { MarketMap } from '@/types/map';

export const FITTED_UNIVERSE = [
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'AVAX',
  'LINK',
  'DOT',
  'LTC',
] as const;

export interface DraftTarget {
  price: string;
  weightPercent: string;
}

export interface Draft {
  symbol: string;
  verdict: 'TAKE' | 'SKIP';
  direction: 'long' | 'short';
  entry: string;
  stop: string;
  targets: DraftTarget[];
  rationale: string;
  usedOutsideData: boolean;
}

export const emptyDraft = (symbol: string): Draft => ({
  symbol,
  verdict: 'TAKE',
  direction: 'long',
  entry: '',
  stop: '',
  targets: [{ price: '', weightPercent: '100' }],
  rationale: '',
  usedOutsideData: false,
});

/** A draft nobody has touched is skipped on submit rather than rejected. */
export const isBlank = (d: Draft): boolean =>
  d.entry.trim() === '' && d.stop.trim() === '' && d.targets.every((t) => t.price.trim() === '');

/**
 * The ten maps, and the drafts recorded against them.
 *
 * Fetched together and in parallel: the analyst is asked about all ten in one
 * conversation, so every snapshot has to come from the same moment. Sequential
 * fetches would spread the batch across minutes of moving price.
 *
 * `universe` is passed so the expected-move cone carries its cross-sectional
 * tilt. Priced alone a coin gets the baseline only, which is a weaker number
 * wearing the same shape.
 */
export function useBatch() {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    FITTED_UNIVERSE.map((s) => emptyDraft(s)),
  );

  const universe = FITTED_UNIVERSE.join(',');
  const results = useQueries({
    queries: FITTED_UNIVERSE.map((symbol) => ({
      queryKey: queryKeys.map(symbol, universe),
      queryFn: () => fetchApi<MarketMap>(`/api/map/${symbol}?universe=${universe}`),
      // The reading is a moment in time and the snapshot must match what was
      // shown, so it is never refetched behind the reader's back.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  const loading = results.some((r) => r.isPending);
  const error = (results.find((r) => r.error)?.error as Error | undefined)?.message ?? null;

  const maps = useMemo(() => {
    const byCoin: Record<string, MarketMap> = {};
    for (const r of results) if (r.data) byCoin[r.data.symbol] = r.data;
    return Object.keys(byCoin).length === 0 ? null : byCoin;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(',')]);

  const update = useCallback((symbol: string, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d) => (d.symbol === symbol ? { ...d, ...patch } : d)));
  }, []);

  const reset = useCallback(() => {
    setDrafts(FITTED_UNIVERSE.map((s) => emptyDraft(s)));
  }, []);

  const client = useQueryClient();
  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['map'] });
  }, [client]);

  return { maps, drafts, update, reset, reload, loading, error };
}
