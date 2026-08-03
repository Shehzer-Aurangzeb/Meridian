'use client';

import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/ui/section-head';
import { usePerformance } from '@/lib/hooks/use-performance';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Stat data type
 */
interface StatData {
  label: string;
  value: string;
  unit?: string;
  subtext: string;
  trend?: 'up' | 'down' | 'neutral';
}

/**
 * Individual stat card
 */
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
        {stat.unit && (
          <span className="text-xl text-text-secondary ml-0.5">{stat.unit}</span>
        )}
      </div>
      <div
        className={cn(
          'font-mono text-[11px] tracking-[0.04em] mt-2',
          stat.trend === 'up' && 'text-sage',
          stat.trend === 'down' && 'text-rust',
          (!stat.trend || stat.trend === 'neutral') && 'text-text-tertiary'
        )}
      >
        {stat.subtext}
      </div>
    </div>
  );
}

/**
 * Loading skeleton for stats
 */
function StatsSkeleton() {
  return (
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
  );
}

/**
 * Stats strip section for dashboard
 */
export function StatsStrip() {
  const { data, isLoading, error } = usePerformance();

  // Build stats from API response
  const stats: StatData[] = data?.data
    ? [
        {
          label: 'Hit rate',
          value: data.data.winRate.toFixed(0),
          unit: '%',
          subtext: `${data.data.correct} correct · ${data.data.failed} failed`,
          trend: data.data.winRate >= 50 ? 'up' : 'down',
        },
        {
          label: 'Win / Loss',
          value: data.data.failed > 0 
            ? (data.data.correct / data.data.failed).toFixed(2)
            : data.data.correct.toString(),
          unit: data.data.failed > 0 ? '×' : '',
          subtext: `${data.data.correct} wins · ${data.data.failed} losses`,
          trend: data.data.correct > data.data.failed ? 'up' : 'down',
        },
        {
          label: 'Total analyses',
          value: data.data.totalAnalyzed.toString(),
          subtext: `${data.data.pending} pending · ${data.data.neutral} neutral`,
          trend: 'neutral',
        },
      ]
    : [];

  return (
    <section className="mt-14">
      <SectionHead
        eyebrow="Performance"
        title="All time stats"
        linkText="VIEW ALL ANALYSES →"
        linkHref="/history"
      />

      {isLoading ? (
        <StatsSkeleton />
      ) : error ? (
        <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-6 text-center text-text-secondary">
          Unable to load performance data
        </div>
      ) : stats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
          {stats.map((stat, idx) => (
            <Stat key={stat.label} stat={stat} isLast={idx === stats.length - 1} />
          ))}
        </div>
      ) : (
        <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-6 text-center text-text-secondary">
          No performance data yet. Run your first analysis!
        </div>
      )}
    </section>
  );
}
