import { backendFetch, proxy } from '@/lib/api/server';
import type { AnalysisDetail } from '@/types/analyses';

// Reads a cookie, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/**
 * GET /api/analyses/[id]
 *
 * 422 means the row predates the level map and has no plans to score.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  return proxy(() =>
    backendFetch<AnalysisDetail>(`/analyses/${encodeURIComponent(params.id)}`),
  );
}
