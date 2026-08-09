'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './panel';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePerformance } from '@/lib/hooks/use-performance';
import type { PerformanceAnalysis, AnalysisStatus } from '@/types';

interface HistoryItem {
  id: string;
  coin: string;
  date: string;
  status: AnalysisStatus;
  suggestion: string;
  priceChangePercent: number | null;
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const getBadgeContent = () => {
    if (item.status === 'pending') return 'Open';
    if (item.status === 'neutral') return 'Wait';
    if (item.status === 'correct') {
      return item.priceChangePercent ? `+${item.priceChangePercent.toFixed(1)}%` : 'Win';
    }
    if (item.status === 'failed') {
      return item.priceChangePercent ? `${item.priceChangePercent.toFixed(1)}%` : 'Loss';
    }
    return '';
  };

  const getBadgeType = (): 'open' | 'win' | 'loss' | 'neutral' => {
    if (item.status === 'pending') return 'open';
    if (item.status === 'correct') return 'win';
    if (item.status === 'failed') return 'loss';
    return 'neutral';
  };

  return (
    <Link
      href={`/history?coin=${item.coin}`}
      className={cn(
        'grid grid-cols-[56px_1fr_auto_auto] items-center gap-4',
        'px-6 py-4 border-b border-border/10 dark:border-border',
        'no-underline text-inherit',
        'transition-colors duration-[160ms]',
        'hover:bg-primary/[0.025]',
        'last:border-b-0'
      )}
    >
      <span className="font-antonio text-lg font-semibold tracking-[0.04em] uppercase">
        {item.coin}
      </span>
      
      <span className="text-text-secondary text-[13px] truncate">
        {item.suggestion}
      </span>
      
      <span className="font-mono text-xs text-text-tertiary tracking-[0.04em]">
        {item.date}
      </span>
      
      <Badge type={getBadgeType()}>{getBadgeContent()}</Badge>
    </Link>
  );
}

function RecentHistorySkeleton() {
  return (
    <Panel>
      <PanelHead title="Recent history" linkText="VIEW ALL →" linkHref="/history" />
      <div className="flex flex-col">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              'grid grid-cols-[56px_1fr_auto_auto] items-center gap-4',
              'px-6 py-4 border-b border-border/10 dark:border-border',
              'last:border-b-0'
            )}
          >
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel>
      <PanelHead title="Recent history" linkText="RUN ANALYSIS →" linkHref="/analysis" />
      <div className="p-6 text-center text-text-secondary">
        <p>No history yet. Run some analyses to see your history here.</p>
      </div>
    </Panel>
  );
}

function formatHistoryDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
  });
}

function mapToHistoryItem(analysis: PerformanceAnalysis): HistoryItem {
  return {
    id: analysis.id,
    coin: analysis.coin,
    date: formatHistoryDate(analysis.createdAt),
    status: analysis.status,
    suggestion: analysis.suggestion,
    priceChangePercent: analysis.priceChangePercent,
  };
}

export function RecentHistory() {
  const { data, isLoading, error } = usePerformance({ limit: 5 });

  if (isLoading) {
    return <RecentHistorySkeleton />;
  }

  if (error || !data?.data?.recentAnalyses?.length) {
    return <EmptyState />;
  }

  const historyItems = data.data.recentAnalyses.slice(0, 5).map(mapToHistoryItem);

  return (
    <Panel>
      <PanelHead title="Recent history" linkText="VIEW ALL →" linkHref="/history" />
      
      <div className="flex flex-col">
        {historyItems.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))}
      </div>
    </Panel>
  );
}
