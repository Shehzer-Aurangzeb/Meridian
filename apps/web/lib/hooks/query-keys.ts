import type { AnalysesFilter } from './use-analyses';

export const queryKeys = {
  auth: {
    session: ['auth', 'session'] as const,
  },

  // `all` is the prefix of every analyses key, so invalidating it after a run
  // refreshes the lists and any open detail view.
  analyses: {
    all: ['analyses'] as const,
    // Every field that changes the response has to be in the key, or the
    // dashboard's unscored fetch and History's scored one share a cache entry
    // and whichever lands first wins.
    list: (filter: AnalysesFilter) =>
      [
        ...queryKeys.analyses.all,
        'list',
        filter.symbol ?? null,
        filter.limit ?? null,
        filter.days ?? null,
        filter.status ?? false,
      ] as const,
    detail: (id: string) => [...queryKeys.analyses.all, 'detail', id] as const,
  },

  // `startTime` belongs in the key: two analyses of the same coin at the same
  // interval want different windows, and without it the second one is served
  // the first one's candles.
  candles: (symbol: string, interval: string, startTime?: number) =>
    ['candles', symbol, interval, startTime ?? null] as const,

  health: ['health'] as const,

} as const;
