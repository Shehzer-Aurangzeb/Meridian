import Link from 'next/link';
import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/ui/section-head';

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
 * Mock stats data
 */
const MOCK_STATS: StatData[] = [
  {
    label: 'Hit rate',
    value: '68',
    unit: '%',
    subtext: '▲ 4 pts vs. prior 90d',
    trend: 'up',
  },
  {
    label: 'Average R',
    value: '1.84',
    unit: '×',
    subtext: '▲ 0.12 vs. prior 90d',
    trend: 'up',
  },
  {
    label: 'Closed analyses',
    value: '47',
    subtext: '32 win · 15 loss · 2 open',
    trend: 'neutral',
  },
];

/**
 * Stats strip section for dashboard
 */
export function StatsStrip() {
  return (
    <section className="mt-14">
      <SectionHead
        eyebrow="Performance"
        title="Last 90 days"
        linkText="VIEW ALL ANALYSES →"
        linkHref="/history"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
        {MOCK_STATS.map((stat, idx) => (
          <Stat
            key={stat.label}
            stat={stat}
            isLast={idx === MOCK_STATS.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
