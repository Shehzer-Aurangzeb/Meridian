'use client';

import type { AnalysesSummary } from '@/lib/summarise-analyses';

/**
 * Counts only — every value here is derivable from the list response.
 *
 * Hit rate and average R used to sit in this strip. They are gone on purpose:
 * both are measurement-harness numbers, and a live-looking win rate on a
 * dashboard is exactly how a research result gets mistaken for a track record.
 */

interface SumCellProps {
  eyebrow: string;
  value: string | number;
  unit?: string;
  subtext: string;
  isLast?: boolean;
}

function SumCell({ eyebrow, value, unit, subtext, isLast }: SumCellProps) {
  return (
    <div
      className={`px-5 py-5 md:px-6 md:py-[22px] border-b md:border-b-0 md:border-r border-border/10 dark:border-border last:border-0 ${
        isLast ? 'border-b-0' : ''
      }`}
    >
      <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
        {eyebrow}
      </div>
      <div className="font-display text-[28px] md:text-[32px] font-semibold tracking-[0.02em] leading-none text-text-primary mt-2.5">
        {value}
        {unit && (
          <span className="text-[16px] md:text-[18px] text-text-secondary ml-0.5">{unit}</span>
        )}
      </div>
      <div className="font-mono text-[11px] tracking-[0.04em] text-text-tertiary mt-1.5 truncate">
        {subtext}
      </div>
    </div>
  );
}

export function SummaryStats({ data }: { data: AnalysesSummary }) {
  return (
    <section className="mb-8">
      <div className="bg-surface border border-border/10 dark:border-border rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <SumCell
          eyebrow="Analyses"
          value={data.totalAnalyses}
          subtext={data.sinceDateLabel}
        />
        <SumCell
          eyebrow="Coins covered"
          value={data.coinsCovered}
          subtext={data.coinList}
        />
        <SumCell
          eyebrow="Most recent"
          value={data.latestCoin}
          subtext={data.latestLabel}
        />
        <SumCell
          eyebrow="Failed runs"
          value={data.failedCount}
          subtext={data.failedCount === 0 ? 'All runs completed' : 'See the rows marked failed'}
          isLast
        />
      </div>
    </section>
  );
}
