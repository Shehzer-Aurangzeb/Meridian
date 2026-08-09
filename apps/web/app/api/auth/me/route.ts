import { backendFetch, proxy } from '@/lib/api/server';

// Reads a cookie, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the only thing that tells "has a cookie" from "signed in". */
export async function GET() {
  return proxy(() => backendFetch<{ authenticated: true }>('/auth/me'));
}
