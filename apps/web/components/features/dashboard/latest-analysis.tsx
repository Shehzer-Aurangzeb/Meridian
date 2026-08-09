'use client';

import Link from 'next/link';
import { Panel, PanelHead } from './panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyses } from '@/lib/hooks/use-analyses';
import { formatEnumLabel, formatRelative } from '@/lib/format';

/**
 * The newest saved analysis, whoever produced it — usually the schedule.
 *
 * Headline fields only: outcome and R need the payload plus the candles since,
 * which is a request per analysis. They live on the analysis itself.
 */
export function LatestAnalysis() {
  const { data, isLoading, error } = useAnalyses({ limit: 1 });
  const latest = data?.analyses?.[0];

  return (
    <Panel>
      <PanelHead
        title="Latest analysis"
        linkText={latest ? 'OPEN →' : undefined}
        linkHref={latest ? `/history/${latest.id}` : undefined}
      />

      {isLoading && (
        <div className="p-6">
          <Skeleton className="h-8 w-32 mb-3" />
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}

      {!isLoading && (error || !latest) && (
        <div className="p-6 text-center text-text-tertiary text-sm">
          {error ? 'Could not load the latest analysis.' : 'Nothing analysed yet.'}
        </div>
      )}

      {!isLoading && latest && (
        <Link href={`/history/${latest.id}`} className="block p-6 no-underline text-inherit">
          <div className="flex items-baseline gap-3">
            <span className="font-antonio text-[32px] font-semibold tracking-[0.04em] uppercase leading-none text-text-primary">
              {latest.symbol}
            </span>
            <span className="font-mono text-[11px] text-text-tertiary tracking-[0.04em]">
              {formatRelative(latest.createdAt)}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-y-2.5 text-[13px]">
            <dt className="text-text-secondary">Regime</dt>
            <dd className="text-right text-text-primary">{formatEnumLabel(latest.regime)}</dd>
            <dt className="text-text-secondary">Strategy</dt>
            <dd className="text-right text-text-primary">
              {formatEnumLabel(latest.strategyRoute)}
            </dd>
            <dt className="text-text-secondary">Timeframe</dt>
            <dd className="text-right font-mono text-text-primary">{latest.timeframe}</dd>
          </dl>

          {latest.errorMessage && (
            <p className="mt-4 text-[12px] text-rust">{latest.errorMessage}</p>
          )}
        </Link>
      )}
    </Panel>
  );
}
