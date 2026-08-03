/**
 * History Page Mappers
 *
 * Maps API responses to UI component data shapes.
 * Keeps transformation logic isolated from components.
 */

import type {
  PerformanceData,
  PerformanceAnalysis,
  AnalysisStatus,
} from '@/types';
import type { SummaryStatsData } from '@/components/features/history/summary-stats';
import type { HistoryEntry } from '@/components/features/history/history-table';
import type { Action } from '@/types/analysis';

// ============ Type Mappings ============

/**
 * Maps API Action to UI signal type
 */
function mapActionToSignal(action: Action | null): HistoryEntry['signal'] {
  if (!action) return 'skip';

  switch (action) {
    case 'LONG':
      return 'long';
    case 'SHORT':
      return 'short';
    case 'WAIT':
    default:
      return 'skip';
  }
}

/**
 * Maps API AnalysisStatus to UI outcome type
 */
function mapStatusToOutcome(status: AnalysisStatus): HistoryEntry['outcome'] {
  switch (status) {
    case 'correct':
      return 'win';
    case 'failed':
      return 'loss';
    case 'pending':
      return 'open';
    case 'neutral':
    default:
      return 'no-trade';
  }
}

/**
 * Formats date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

/**
 * Calculates R-value from price change
 * R = (price change) / (risk per trade)
 * Simplified: uses percentage change as approximation
 */
function calculateRValue(
  status: AnalysisStatus,
  priceChangePercent: number | null
): number | undefined {
  if (status === 'pending' || status === 'neutral' || priceChangePercent === null) {
    return undefined;
  }

  // Approximate R-value: assume 1% risk = 1R
  const rValue = Math.abs(priceChangePercent);

  if (status === 'correct') {
    return Math.round(rValue * 10) / 10; // Positive R
  }

  return -Math.round(rValue * 10) / 10; // Negative R for losses (capped at -1R typically)
}

// ============ Main Mappers ============

/**
 * Maps PerformanceData to SummaryStatsData
 */
export function mapToSummaryStats(data: PerformanceData): SummaryStatsData {
  const totalClosed = data.correct + data.failed;
  const hitRate = totalClosed > 0 ? Math.round((data.correct / totalClosed) * 100) : 0;

  // Calculate average R from recent analyses
  const closedAnalyses = data.recentAnalyses.filter(
    (a) => a.status === 'correct' || a.status === 'failed'
  );

  let averageR = 0;
  if (closedAnalyses.length > 0) {
    const totalR = closedAnalyses.reduce((sum, a) => {
      const r = calculateRValue(a.status, a.priceChangePercent);
      return sum + (r ?? 0);
    }, 0);
    averageR = totalR / closedAnalyses.length;
  }

  // Get open trades
  const openAnalyses = data.recentAnalyses.filter((a) => a.status === 'pending');
  const uniqueCoins = new Set(openAnalyses.map((a) => a.coin));
  const openCoins = Array.from(uniqueCoins).slice(0, 5);

  // Find earliest analysis date
  const dates = data.recentAnalyses.map((a) => new Date(a.createdAt));
  const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
  const sinceDateLabel = `Since ${earliestDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return {
    totalAnalyses: data.totalAnalyzed,
    sinceDateLabel,
    hitRatePercent: hitRate,
    wins: data.correct,
    losses: data.failed,
    averageR: Math.round(averageR * 100) / 100,
    currentlyOpenCount: data.pending,
    openCoins,
  };
}

/**
 * Maps PerformanceAnalysis array to HistoryEntry array
 */
export function mapToHistoryEntries(analyses: PerformanceAnalysis[]): HistoryEntry[] {
  return analyses.map((analysis) => ({
    id: analysis.id,
    date: formatDate(analysis.createdAt),
    coin: analysis.coin,
    signal: mapActionToSignal(analysis.suggestion),
    strategy: 'Analysis', // API doesn't provide strategy name
    timeframe: '1D', // API doesn't provide timeframe
    confidence: 70, // API doesn't provide confidence for performance analyses
    outcome: mapStatusToOutcome(analysis.status),
    rValue: calculateRValue(analysis.status, analysis.priceChangePercent),
    hasNotes: false, // Not tracked in API
  }));
}

/**
 * Filters history entries based on filter criteria
 */
export function filterHistoryEntries(
  entries: HistoryEntry[],
  filters: {
    search: string;
    signal: 'all' | 'long' | 'short' | 'skipped';
    outcome: 'all' | 'win' | 'loss' | 'open';
  }
): HistoryEntry[] {
  return entries.filter((entry) => {
    // Search filter
    if (filters.search) {
      const search = filters.search.toLowerCase();
      const matchesCoin = entry.coin.toLowerCase().includes(search);
      const matchesStrategy = entry.strategy.toLowerCase().includes(search);
      if (!matchesCoin && !matchesStrategy) return false;
    }

    // Signal filter
    if (filters.signal !== 'all') {
      if (filters.signal === 'skipped' && entry.signal !== 'skip') return false;
      if (filters.signal === 'long' && entry.signal !== 'long') return false;
      if (filters.signal === 'short' && entry.signal !== 'short') return false;
    }

    // Outcome filter
    if (filters.outcome !== 'all') {
      if (filters.outcome === 'win' && entry.outcome !== 'win') return false;
      if (filters.outcome === 'loss' && entry.outcome !== 'loss') return false;
      if (filters.outcome === 'open' && entry.outcome !== 'open') return false;
    }

    return true;
  });
}

/**
 * Sorts history entries based on sort option
 */
export function sortHistoryEntries(
  entries: HistoryEntry[],
  sort: 'newest' | 'oldest' | 'conf-desc' | 'conf-asc'
): HistoryEntry[] {
  const sorted = [...entries];

  switch (sort) {
    case 'conf-desc':
      return sorted.sort((a, b) => b.confidence - a.confidence);
    case 'conf-asc':
      return sorted.sort((a, b) => a.confidence - b.confidence);
    case 'oldest':
      // Entries are already sorted by date desc from API, reverse for oldest first
      return sorted.reverse();
    case 'newest':
    default:
      return sorted;
  }
}
