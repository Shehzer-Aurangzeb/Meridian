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

} as const;
