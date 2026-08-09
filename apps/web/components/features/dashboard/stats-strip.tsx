'use client';

import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyses } from '@/lib/hooks/use-analyses';
import { summariseAnalyses } from '@/lib/summarise-analyses';

/**
 * Counts, not performance. Hit rate and average R are measurement-harness
 * numbers and deliberately have no endpoint — see lib/summarise-analyses.ts.
 */

interface StatData {
  label: string;
  value: string;
  unit?: string;
  subtext: string;
}

function Stat({ stat, isLast }: { stat: StatData; isLast: boolean }) {
  return (
    <div
      className={cn(
        'p-6 md:px-7',
        !isLast && 'border-b md:border-b-0 md:border-r border-border/10 dark:border-border'
      )}
    >
      <div className="text-[11px] tracking-[0.18em] uppercase text-gold-ink font-semibold">
        {stat.label}
      </div>
      <div className="font-antonio text-[38px] font-semibold tracking-[0.02em] leading-none mt-3 text-text-primary">
        {stat.value}
        {stat.unit && <span className="text-xl text-text-secondary ml-0.5">{stat.unit}</span>}
      </div>
      <div className="font-mono text-[11px] tracking-[0.04em] mt-2 text-text-tertiary truncate">
        {stat.subtext}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <SectionHead
        eyebrow="The record"
        title="What has been analysed"
        linkText="VIEW ALL ANALYSES →"
        linkHref="/history"
      />
      {children}
    </section>
  );
}

export function StatsStrip() {
  const { data, isLoading, error } = useAnalyses({ limit: 200 });
  const summary = summariseAnalyses(data?.analyses ?? []);

  if (isLoading) {
    return (
      <Shell>
        <div className="grid grid-cols-1 md:grid-cols-3 bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className={cn(
                'p-6 md:px-7',
                idx !== 2 && 'border-b md:border-b-0 md:border-r border-border/10 dark:border-border'
              )}
            >
              <Skeleton className="h-3 w-16 mb-3" />
              <Skeleton className="h-10 w-24 mb-2" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (error || !summary) {
    return (
      <Shell>
        <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-6 text-center text-text-secondary text-sm">
          {error ? 'Could not load analyses.' : 'Nothing analysed yet.'}
        </div>
      </Shell>
    );
  }

  const stats: StatData[] = [
    { label: 'Analyses', value: String(summary.totalAnalyses), subtext: summary.sinceDateLabel },
    { label: 'Coins covered', value: String(summary.coinsCovered), subtext: summary.coinList },
    { label: 'Most recent', value: summary.latestCoin, subtext: summary.latestLabel },
  ];

  return (
    <Shell>
      <div className="grid grid-cols-1 md:grid-cols-3 bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
        {stats.map((stat, idx) => (
          <Stat key={stat.label} stat={stat} isLast={idx === stats.length - 1} />
        ))}
      </div>
    </Shell>
  );
}
