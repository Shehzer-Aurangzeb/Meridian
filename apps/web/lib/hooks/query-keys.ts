export const queryKeys = {
  auth: {
    session: ['auth', 'session'] as const,
  },

  // `startTime` belongs in the key: two analyses of the same coin at the same
  // interval want different windows, and without it the second one is served
  // the first one's candles.
  candles: (symbol: string, interval: string, startTime?: number) =>
    ['candles', symbol, interval, startTime ?? null] as const,

  health: ['health'] as const,

} as const;
