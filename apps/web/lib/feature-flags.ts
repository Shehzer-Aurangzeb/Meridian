function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Which screens are actually connected to real data. Off means the screen
 * exists but its data does not. Turning one on early gives a page that fails,
 * which is worse than one that says it is not ready.
 */
export const FEATURES = {
  DASHBOARD: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_DASHBOARD, true),

  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, true),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, true),

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

/** Matches on the first segment, so /history/<id> follows /history. */
export function isRouteEnabled(route: string): boolean {
  const feature = ROUTE_FEATURE_MAP[`/${route.split('/')[1]}`];
  if (!feature) return true;
  return FEATURES[feature];
}

export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
