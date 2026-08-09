import type { Timeframe } from '@/types';

/**
 * React Query cache keys
 * Centralized key definitions for consistent cache invalidation
 */
export const queryKeys = {
  analysis: {
    all: ['analysis'] as const,
    coordinate: (coin: string, timeframe: Timeframe) => 
      [...queryKeys.analysis.all, 'coordinate', coin, timeframe] as const,
  },
  
  performance: {
    all: ['performance'] as const,
    global: () => [...queryKeys.performance.all, 'global'] as const,
    byCoin: (coin: string) => [...queryKeys.performance.all, 'coin', coin] as const,
  },
  
  history: {
    all: ['history'] as const,
    byCoin: (coin: string) => [...queryKeys.history.all, 'coin', coin] as const,
  },
  
  health: ['health'] as const,
} as const;
