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
 * Counts derived from a list response. Shared by the history strip and the
 * dashboard so the two cannot disagree about the same numbers.
 *
 * No hit rate and no average R on purpose: both are measurement-harness
 * numbers, and a live-looking win rate is how a research result gets mistaken
 * for a track record.
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
