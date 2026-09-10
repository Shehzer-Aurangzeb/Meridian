'use client';

import { useCallback, useState } from 'react';
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
  /** The reply marked this SKIP and gave a plan anyway. Shown, never acted on. */
  planDespiteSkip?: boolean;
}

interface ParsedTarget {
  price: number | null;
  weightPercent: number | null;
}

interface ParsedRow {
  symbol: string;
  verdict: 'TAKE' | 'SKIP' | null;
  direction: 'long' | 'short' | null;
  entry: number | null;
  stop: number | null;
  targets: ParsedTarget[];
  rationale: string | null;
  planDespiteSkip: boolean;
}

export interface ParseOutcome {
  filled: string[];
  missing: string[];
  incomplete: string[];
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
  // `combine` rather than a memo over `results`: useQueries returns a new array
  // identity on every render, so the honest dependency would defeat the memo
  // and the dishonest one needed an eslint-disable. React Query memoises this
  // against the queries themselves.
  const { maps, loading, error } = useQueries({
    queries: FITTED_UNIVERSE.map((symbol) => ({
      queryKey: queryKeys.map(symbol, universe),
      queryFn: () => fetchApi<MarketMap>(`/api/map/${symbol}?universe=${universe}`),
      // The reading is a moment in time and the snapshot must match what was
      // shown, so it is never refetched behind the reader's back.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
    combine: (results) => {
      const byCoin: Record<string, MarketMap> = {};
      for (const r of results) if (r.data) byCoin[r.data.symbol] = r.data;
      return {
        maps: Object.keys(byCoin).length === 0 ? null : byCoin,
        loading: results.some((r) => r.isPending),
        error: (results.find((r) => r.error)?.error as Error | undefined)?.message ?? null,
      };
    },
  });

  /**
   * Apply one extracted row over a draft.
   *
   * A null means the reply did not state that field, so the existing value is
   * kept rather than blanked — the extractor is not allowed to guess, and
   * neither is this. Numbers become strings because the inputs are text: a
   * price the analyst wrote as 0.4150 must not redisplay as 0.415.
   */
  const applyRow = useCallback((draft: Draft, row: ParsedRow): Draft => {
    const targets = row.targets
      .filter((t) => t.price !== null)
      .map((t) => ({
        price: String(t.price),
        weightPercent: t.weightPercent === null ? '' : String(t.weightPercent),
      }));

    // One target closes the whole position, which the form states by hiding
    // the weight. Say 100 so a saved single-target row is not rejected.
    if (targets.length === 1 && targets[0].weightPercent === '') {
      targets[0].weightPercent = '100';
    }

    return {
      ...draft,
      verdict: row.verdict ?? draft.verdict,
      direction: row.direction ?? draft.direction,
      entry: row.entry === null ? draft.entry : String(row.entry),
      stop: row.stop === null ? draft.stop : String(row.stop),
      targets: targets.length > 0 ? targets : draft.targets,
      rationale: row.rationale ?? draft.rationale,
      planDespiteSkip: row.planDespiteSkip,
    };
  }, []);

  const [parsing, setParsing] = useState(false);

  const fillFromReply = useCallback(
    async (text: string): Promise<ParseOutcome> => {
      setParsing(true);
      try {
        const got = await fetchApi<{ rows: ParsedRow[]; missing: string[] }>(
          '/api/sim/parse',
          {
            method: 'POST',
            body: JSON.stringify({ text, symbols: [...FITTED_UNIVERSE] }),
          },
        );

        const byCoin = new Map(got.rows.map((r) => [r.symbol, r]));
        const filled: string[] = [];
        const incomplete: string[] = [];

        setDrafts((prev) =>
          prev.map((d) => {
            const row = byCoin.get(d.symbol);
            if (!row) return d;
            const next = applyRow(d, row);
            filled.push(d.symbol);
            // Says which rows still need a person, so nothing is saved blind.
            if (
              next.entry.trim() === '' ||
              next.stop.trim() === '' ||
              next.targets.every((t) => t.price.trim() === '')
            ) {
              incomplete.push(d.symbol);
            }
            return next;
          }),
        );

        return { filled, missing: got.missing, incomplete };
      } finally {
        setParsing(false);
      }
    },
    [applyRow],
  );

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

  return { maps, drafts, update, reset, reload, fillFromReply, parsing, loading, error };
}
