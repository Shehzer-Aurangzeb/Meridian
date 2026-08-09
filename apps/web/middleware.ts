import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Navigation UX, not security: this checks the cookie EXISTS, never that the
 * token inside is valid — that needs the backend's secret. The real gate is the
 * AuthGuard on every request.
 */

function parseFeatureFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

// Duplicated from lib/feature-flags — middleware runs on the Edge runtime.
// Hiding a nav link is not gating: without these, the gated pages are still
// reachable by typing the URL.
//
// The DEFAULTS must match lib/feature-flags exactly. They did not: ANALYSIS
// and HISTORY defaulted true there and false here, so a deployment without the
// env vars showed both links in the sidebar and then redirected anyone who
// clicked them.
const FEATURES = {
  ANALYSIS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ANALYSIS, true),
  HISTORY: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_HISTORY, true),
  ALERTS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_ALERTS, false),
  STRATEGIES: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_STRATEGIES, false),
  SETTINGS: parseFeatureFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS, false),
};

const ROUTE_FEATURE_MAP: Record<string, keyof typeof FEATURES> = {
  '/analysis': 'ANALYSIS',
  '/history': 'HISTORY',
  '/alerts': 'ALERTS',
  '/strategies': 'STRATEGIES',
  '/settings': 'SETTINGS',
};

const SIGN_IN = '/sign-in';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (!signedIn && pathname !== SIGN_IN) {
    const url = new URL(SIGN_IN, request.url);
    url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === SIGN_IN) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Match the first segment, not the whole path: an exact lookup leaves
  // /history/<id> ungated while /history is gated.
  const feature = ROUTE_FEATURE_MAP[`/${pathname.split('/')[1]}`];
  if (feature && !FEATURES[feature]) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // /api is excluded so a failed call returns 401 JSON, not an HTML redirect.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
