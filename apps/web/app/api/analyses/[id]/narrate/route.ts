import { backendFetch, proxy } from '@/lib/api/server';
import type { SavedNarration } from '@/types/analyses';

export const dynamic = 'force-dynamic';

/**
 * POST /api/analyses/[id]/narrate
 *
 * Asks Claude to read the analysis, or returns the read it already wrote.
 * 503 means narration is unavailable — no key, a refusal, or a cited price
 * that traced to nothing. None of those says anything about the analysis.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  return proxy(() =>
    backendFetch<SavedNarration>(
      `/analyses/${encodeURIComponent(params.id)}/narrate`,
      { method: 'POST' },
    ),
  );
}
