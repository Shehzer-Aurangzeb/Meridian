import { NextRequest } from 'next/server';
import { backendFetch, proxy } from '@/lib/api/server';
import type { AnalysesStats } from '@/types/analyses';

// Reads a cookie, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/**
 * GET /api/analyses/stats?symbol=BTC&days=30
 *
 * Counts across the WHOLE window. Separate from the list so the scoreboard is
 * not held hostage by a page of rows, and neither request blocks the other.
 */
export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const symbol = request.nextUrl.searchParams.get('symbol');
  const days = request.nextUrl.searchParams.get('days');
  if (symbol) params.set('symbol', symbol.toUpperCase());
  if (days) params.set('days', days);

  const query = params.toString();
  return proxy(() =>
    backendFetch<AnalysesStats>(`/analyses/stats${query ? `?${query}` : ''}`),
  );
}
