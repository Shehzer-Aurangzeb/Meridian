function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export const FEATURES = {
  DASHBOARD: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_DASHBOARD, true),
  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, true),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, true),
  
  ALERTS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ALERTS, false),
  STRATEGIES: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_STRATEGIES, false),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
} as const;

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
  if (!feature) return true; // Unknown routes are allowed
  return FEATURES[feature];
}

export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
