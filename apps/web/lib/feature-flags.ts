/**
 * Feature flags configuration
 * 
 * These flags control which features are enabled in the application.
 * Set via environment variables (NEXT_PUBLIC_FEATURE_*) for flexibility
 * across different environments.
 * 
 * Default values:
 * - ANALYSIS, HISTORY, DASHBOARD: enabled (core features)
 * - ALERTS, STRATEGIES, SETTINGS: disabled (backend not ready)
 */

function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export const FEATURES = {
  // Core features - enabled by default
  DASHBOARD: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_DASHBOARD, true),
  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, true),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, true),
  
  // Features pending backend support - disabled by default
  ALERTS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ALERTS, false),
  STRATEGIES: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_STRATEGIES, false),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
} as const;

/**
 * Map of routes to their feature flags
 */
export const ROUTE_FEATURE_MAP: Record<string, keyof typeof FEATURES> = {
  '/dashboard': 'DASHBOARD',
  '/analysis': 'ANALYSIS',
  '/history': 'HISTORY',
  '/alerts': 'ALERTS',
  '/strategies': 'STRATEGIES',
  '/settings': 'SETTINGS',
};

/**
 * Check if a route is enabled based on feature flags
 */
export function isRouteEnabled(route: string): boolean {
  const feature = ROUTE_FEATURE_MAP[route];
  if (!feature) return true; // Unknown routes are allowed
  return FEATURES[feature];
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
