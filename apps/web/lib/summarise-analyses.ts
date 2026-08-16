import { formatRelative } from '@/lib/format';
import type { AnalysisListItem } from '@/types/analyses';

export interface AnalysesSummary {
  totalAnalyses: number;
  sinceDateLabel: string;
  coinsCovered: number;
  coinList: string;
  latestCoin: string;
  latestLabel: string;
  failedCount: number;
}

/**
 * Counts taken from a list of analyses, shared by the dashboard and the
 * history page so the two cannot disagree.
 *
 * No success rate or average result on purpose — on a dashboard those read as
 * a track record rather than as research numbers.
 */
export function summariseAnalyses(rows: AnalysisListItem[]): AnalysesSummary | null {
  if (rows.length === 0) return null;

  // The API returns newest first, so the oldest row is the last one.
  const oldest = rows[rows.length - 1];
  const latest = rows[0];
  const coins = Array.from(new Set(rows.map((r) => r.symbol)));

  return {
    totalAnalyses: rows.length,
    sinceDateLabel: `Since ${new Date(oldest.createdAt).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    })}`,
    coinsCovered: coins.length,
    coinList: coins.slice(0, 6).join(', ') + (coins.length > 6 ? '…' : ''),
    latestCoin: latest.symbol,
    latestLabel: formatRelative(latest.createdAt),
    failedCount: rows.filter((r) => r.errorMessage).length,
  };
}
