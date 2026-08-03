import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Feature flags for middleware
 * Note: We can't import from lib/feature-flags.ts in middleware,
 * so we duplicate the logic here with the same env vars.
 */
function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

const FEATURES = {
  DASHBOARD: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_DASHBOARD, true),
  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, true),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, true),
  ALERTS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ALERTS, false),
  STRATEGIES: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_STRATEGIES, false),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
};

const ROUTE_FEATURE_MAP: Record<string, keyof typeof FEATURES> = {
  '/alerts': 'ALERTS',
  '/strategies': 'STRATEGIES',
  '/settings': 'SETTINGS',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if route is feature-flagged and disabled
  const feature = ROUTE_FEATURE_MAP[pathname];
  if (feature && !FEATURES[feature]) {
    // Redirect to dashboard if feature is disabled
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  
  return NextResponse.next();
}

// Only run middleware on specific paths
export const config = {
  matcher: ['/alerts', '/strategies', '/settings'],
};
