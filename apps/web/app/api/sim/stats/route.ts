import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** GET /api/sim/stats — take versus pass, paired within batches. */
export async function GET() {
  return proxy(() => backendFetch('/sim/stats'));
}
