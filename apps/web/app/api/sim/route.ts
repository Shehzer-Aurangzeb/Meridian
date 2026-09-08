import { NextRequest } from 'next/server';
import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** POST /api/sim — record one batch of analyst calls. */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  return proxy(() => backendFetch('/sim', { method: 'POST', body }));
}

/** GET /api/sim — the journal. This read is also what scores due rows. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.toString();
  return proxy(() => backendFetch(`/sim${query ? `?${query}` : ''}`));
}
