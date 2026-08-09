'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyses } from '@/lib/hooks/use-analyses';
import { formatEnumLabel, formatRelative } from '@/lib/format';

const RECENT_COUNT = 5;

export function RecentHistory() {
  const { data, isLoading, error } = useAnalyses({ limit: RECENT_COUNT });
  const rows = data?.analyses ?? [];

  return (
    <Panel>
      <PanelHead title="Recent history" linkText="VIEW ALL →" linkHref="/history" />

      {isLoading && (
        <div className="p-6 flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {!isLoading && (error || rows.length === 0) && (
        <div className="p-6 text-center text-text-tertiary text-sm">
          {error ? 'Could not load recent analyses.' : 'Nothing analysed yet.'}
        </div>
      )}

      {!isLoading &&
        rows.map((row, idx) => (
          <Link
            key={row.id}
            href={`/history/${row.id}`}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] gap-3.5 items-center px-6 py-3.5',
              'no-underline text-inherit transition-colors hover:bg-primary/[0.025]',
              idx < rows.length - 1 && 'border-b border-border/10 dark:border-border'
            )}
          >
            <span className="font-antonio text-[17px] font-semibold tracking-[0.04em] uppercase text-text-primary">
              {row.symbol}
            </span>
            <span className="text-[13px] text-text-secondary truncate">
              {formatEnumLabel(row.regime)}
              <span className="text-text-tertiary"> · {formatEnumLabel(row.strategyRoute)}</span>
            </span>
            <span className="font-mono text-[11px] text-text-tertiary whitespace-nowrap">
              {formatRelative(row.createdAt)}
            </span>
          </Link>
        ))}
    </Panel>
  );
}
