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
  MAP: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_MAP, true),
  CALIBRATION: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_CALIBRATION, true),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
} as const;

/**
 * Keep in sync with ROUTE_FEATURE_MAP in middleware.ts, which cannot import this.
 *
 * DASHBOARD, ANALYSIS, HISTORY, ALERTS and STRATEGIES were removed on
 * 7 September 2026 with the pages they gated. A flag for a route that no longer
 * exists is worse than no flag: it redirected anyone who typed the address to
 * another address that also no longer existed.
 */
export const ROUTE_FEATURE_MAP: Record<string, keyof typeof FEATURES> = {
  '/map': 'MAP',
  '/calibration': 'CALIBRATION',
  '/settings': 'SETTINGS',
};

/** Matches on the first segment, so /map/<symbol> follows /map. */
export function isRouteEnabled(route: string): boolean {
  const feature = ROUTE_FEATURE_MAP[`/${route.split('/')[1]}`];
  if (!feature) return true;
  return FEATURES[feature];
}

export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
