import { NextRequest } from 'next/server';
import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** POST /api/sim/parse — read an analyst reply back into draft rows. */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  return proxy(() => backendFetch('/sim/parse', { method: 'POST', body }));
}
