'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelHead } from './panel';
import { Skeleton } from '@/components/ui/skeleton';
import { usePerformance } from '@/lib/hooks/use-performance';
import { NotWired } from '@/components/ui/not-wired';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { formatCurrency } from '@/lib/format';
import type { PerformanceAnalysis } from '@/types';

interface MetaItem {
  label: string;
  value: string;
  variant?: 'entry' | 'stop' | 'default';
}

function MetaRow({ items }: { items: MetaItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-4 pt-5 border-t border-border/10 dark:border-border">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[11px] tracking-[0.16em] uppercase text-text-tertiary font-medium">
            {item.label}
          </div>
          <div
            className={cn(
              'font-antonio text-[22px] font-semibold tracking-[0.02em] mt-2',
              item.variant === 'entry' && 'text-gold-ink',
              item.variant === 'stop' && 'text-rust',
              (!item.variant || item.variant === 'default') && 'text-text-primary'
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LatestAnalysisSkeleton() {
  return (
    <Panel>
      <PanelHead title="Latest analysis" linkText="VIEW FULL →" linkHref="/analysis" />
      <div className="p-6 md:p-8 flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="h-11 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-5 border-t border-border/10 dark:border-border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-12 mb-2" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel>
      <PanelHead title="Latest analysis" linkText="RUN ANALYSIS →" linkHref="/analysis" />
      <div className="p-6 md:p-8 text-center text-text-secondary">
        <p>No analyses yet. Run your first analysis to see results here.</p>
      </div>
    </Panel>
  );
}

function formatAnalysis(analysis: PerformanceAnalysis) {
  const timeAgo = new Date(analysis.createdAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });

  return {
    asset: analysis.coin,
    time: `${timeAgo} UTC`,
    direction: analysis.suggestion as 'LONG' | 'SHORT' | 'WAIT',
    status: analysis.status,
    meta: [
      { label: 'Entry', value: formatCurrency(analysis.entryPrice), variant: 'entry' as const },
      { label: 'Current', value: analysis.currentPrice ? formatCurrency(analysis.currentPrice) : '—', variant: 'default' as const },
      { label: 'Change', value: analysis.priceChangePercent ? `${analysis.priceChangePercent > 0 ? '+' : ''}${analysis.priceChangePercent.toFixed(2)}%` : '—', variant: 'default' as const },
      { label: 'Stop', value: formatCurrency(analysis.stopLoss), variant: 'stop' as const },
    ],
  };
}

export function LatestAnalysis() {
  if (!isFeatureEnabled('PERFORMANCE')) {
    return (
      <Panel>
        <PanelHead title="Latest analysis" />
        <NotWired
          title="Not wired"
          detail="Reads a deleted endpoint. Rewire to GET /api/analyses."
          className="border-0 rounded-none"
        />
      </Panel>
    );
  }
  return <LatestAnalysisData />;
}

function LatestAnalysisData() {
  const { data, isLoading, error } = usePerformance();

  if (isLoading) {
    return <LatestAnalysisSkeleton />;
  }

  if (error || !data?.data?.recentAnalyses?.length) {
    return <EmptyState />;
  }

  // Get the most recent non-WAIT analysis
  const latestAnalysis = data.data.recentAnalyses.find(
    (a) => a.suggestion !== 'WAIT'
  ) || data.data.recentAnalyses[0];

  const analysis = formatAnalysis(latestAnalysis);
  const badgeType = analysis.direction === 'LONG' ? 'long' : analysis.direction === 'SHORT' ? 'short' : 'neutral';

  return (
    <Panel>
      <PanelHead title="Latest analysis" linkText="VIEW FULL →" linkHref={`/analysis?coin=${analysis.asset}`} />
      
      <div className="p-6 md:p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-antonio text-[44px] font-bold tracking-[0.04em] uppercase leading-none">
              {analysis.asset}
            </div>
            <div className="font-mono text-xs text-text-tertiary mt-1.5 tracking-[0.04em]">
              {analysis.time}
            </div>
          </div>
          <Badge type={badgeType}>
            {analysis.direction}
          </Badge>
        </div>

        {/* Meta values */}
        <MetaRow items={analysis.meta} />
      </div>
    </Panel>
  );
}
