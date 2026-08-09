import { backendFetch, proxy } from '@/lib/api/server';
import type { HealthResponse } from '@/types/analyses';

// Reads no cookie, so Next would otherwise try to prerender this at build
// time against a backend that is not running.
export const dynamic = 'force-dynamic';

/** GET /api/health — public on the backend, so this works signed out. */
export async function GET() {
  return proxy(() => backendFetch<HealthResponse>('/health', { auth: false }));
}
