import type { Timeframe } from '@/types';
import type { AnalysesFilter } from './use-analyses';

export const queryKeys = {
  auth: {
    session: ['auth', 'session'] as const,
  },

  // `all` is the prefix of every analyses key, so invalidating it after a run
  // refreshes the lists and any open detail view.
  analyses: {
    all: ['analyses'] as const,
    list: (filter: AnalysesFilter) =>
      [...queryKeys.analyses.all, 'list', filter.symbol ?? null, filter.limit ?? null] as const,
    detail: (id: string) => [...queryKeys.analyses.all, 'detail', id] as const,
  },

  health: ['health'] as const,

  /** @deprecated The backend routes behind these no longer exist. */
  analysis: {
    all: ['analysis'] as const,
    coordinate: (coin: string, timeframe: Timeframe) =>
      [...queryKeys.analysis.all, 'coordinate', coin, timeframe] as const,
  },

  /** @deprecated The backend routes behind these no longer exist. */
  performance: {
    all: ['performance'] as const,
    global: () => [...queryKeys.performance.all, 'global'] as const,
    byCoin: (coin: string) => [...queryKeys.performance.all, 'coin', coin] as const,
  },

  /** @deprecated The backend routes behind these no longer exist. */
  history: {
    all: ['history'] as const,
    byCoin: (coin: string) => [...queryKeys.history.all, 'coin', coin] as const,
  },
} as const;
