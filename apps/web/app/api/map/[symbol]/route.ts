import { NextRequest } from 'next/server';
import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** Matches the backend's guard, so a bad symbol costs no round trip. */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

/**
 * GET /api/map/BTC
 *
 * One request for the whole screen. The backend assembles regime, cone, zones
 * and depth together because the Lambda has a 120-second ceiling and six round
 * trips to build one page is how a cold start becomes a failed load.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const coin = symbol.toUpperCase();
  if (!SYMBOL_PATTERN.test(coin)) {
    return Response.json({ error: `Invalid symbol "${symbol}"` }, { status: 400 });
  }
  const universe = request.nextUrl.searchParams.get('universe');
  const query = universe ? `?universe=${encodeURIComponent(universe)}` : '';
  return proxy(() => backendFetch(`/map/${coin}${query}`));
}
