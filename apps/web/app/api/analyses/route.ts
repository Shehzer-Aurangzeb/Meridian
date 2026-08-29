import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, proxy } from '@/lib/api/server';
import type { AnalysisListResponse, RunAnalysisResponse } from '@/types/analyses';

// Reads a cookie, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/** Matches the backend's guard, so a bad symbol costs no round trip. */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

/**
 * GET /api/analyses?symbol=BTC&limit=20&days=30&status=true&cursor=…&bucket=…
 *
 * One page. No payloads; the detail route has those. `status=true` costs the
 * backend a price per coin, so it is opt-in.
 */
export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const query_ = request.nextUrl.searchParams;
  const symbol = query_.get('symbol');

  if (symbol) params.set('symbol', symbol.toUpperCase());
  for (const key of ['limit', 'days', 'cursor', 'bucket'] as const) {
    const value = query_.get(key);
    if (value) params.set(key, value);
  }
  if (query_.get('status') === 'true') params.set('status', 'true');

  const query = params.toString();
  return proxy(() =>
    backendFetch<AnalysisListResponse>(`/analyses${query ? `?${query}` : ''}`),
  );
}

/** POST /api/analyses?symbol=BTC — runs and saves one. Backend allows 20/min. */
export async function POST(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') ?? '')
    .trim()
    .toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  return proxy(() =>
    backendFetch<RunAnalysisResponse>(`/analyses?symbol=${symbol}`, {
      method: 'POST',
    }),
  );
}
