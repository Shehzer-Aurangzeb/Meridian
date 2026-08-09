function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * What is actually wired to the backend.
 *
 * A flag is true only when the screen behind it reads a live endpoint. Off
 * means the UI exists but its data does not — mock arrays, or a hook pointing
 * at a route that was deleted. Turning one on before its rewire gives you a
 * screen that 404s, which is worse than one that says it is not ready.
 */
export const FEATURES = {
  DASHBOARD: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_DASHBOARD, true),

  // Off until their pages stop calling deleted routes: the analysis page still
  // goes through useCoordinateAnalysis, the history page through
  // usePerformance. Both replaced by use-analyses.ts, neither rewired yet.
  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, false),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, false),

  // Aggregate performance has no endpoint, deliberately: those numbers belong
  // to the measurement harness, and showing them in the app would make a
  // research result look like a live one. Per-plan outcomes come from
  // GET /analyses/:id instead.
  PERFORMANCE: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_PERFORMANCE, false),

  // Mock array in the component. Needs somewhere to persist a per-user list,
  // and this is a single-password app with no user table.
  WATCHLIST: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_WATCHLIST, false),

  // No backend at all.
  ALERTS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ALERTS, false),
  STRATEGIES: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_STRATEGIES, false),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
} as const;

/** Keep in sync with ROUTE_FEATURE_MAP in middleware.ts, which cannot import this. */
export const ROUTE_FEATURE_MAP: Record<string, keyof typeof FEATURES> = {
  '/dashboard': 'DASHBOARD',
  '/analysis': 'ANALYSIS',
  '/history': 'HISTORY',
  '/alerts': 'ALERTS',
  '/strategies': 'STRATEGIES',
  '/settings': 'SETTINGS',
};

export function isRouteEnabled(route: string): boolean {
  const feature = ROUTE_FEATURE_MAP[route];
  if (!feature) return true;
  return FEATURES[feature];
}

export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
