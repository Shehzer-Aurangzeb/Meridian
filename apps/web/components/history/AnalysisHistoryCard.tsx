'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatDate, formatPrice, formatPercent } from '@/lib/format';
import { SUGGESTION_STYLES, STATUS_STYLES, STATUS_LABELS } from '@/lib/constants';
import { Eyebrow, Caption } from '@/components/ui/typography';
import { AnimatedCollapse } from '@/components/ui/AnimatedCollapse';
import type { PerformanceAnalysis, AnalysisStatus } from '@/types/history';

// Re-export types for backward compatibility
export type { AnalysisStatus, PerformanceAnalysis } from '@/types/history';

interface AnalysisHistoryCardProps {
  analysis: PerformanceAnalysis;
}

export function AnalysisHistoryCard({ analysis }: AnalysisHistoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const priceChangeColor =
    analysis.priceChange !== null
      ? analysis.priceChange >= 0
        ? 'text-sage'
        : 'text-rust'
      : 'text-text-secondary';

  return (
    <div
      className={cn(
        'bg-surface border border-border/[0.08] dark:border-border rounded-xl p-6',
        'transition-all duration-300 ease-out cursor-pointer',
        'hover:shadow-md hover:shadow-primary/5 hover:border-border-hover/15 dark:hover:border-border-hover'
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="inline-block px-3 py-1 bg-primary text-background font-inter font-semibold text-sm uppercase rounded">
            {analysis.coin}
          </span>
          <Caption>{formatDate(analysis.createdAt)}</Caption>
        </div>
        <span
          className={cn(
            'inline-block px-3 py-1 font-inter font-medium text-sm rounded border',
            STATUS_STYLES[analysis.status]
          )}
        >
          {STATUS_LABELS[analysis.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div>
          <Eyebrow className="mb-1">Signal</Eyebrow>
          <span
            className={cn(
              'inline-block px-4 py-2 rounded-lg font-antonio text-lg uppercase tracking-wide',
              SUGGESTION_STYLES[analysis.suggestion as keyof typeof SUGGESTION_STYLES] ||
                SUGGESTION_STYLES.WAIT
            )}
          >
            {analysis.suggestion}
          </span>
        </div>

        <div>
          <Eyebrow className="mb-1">Entry Price</Eyebrow>
          <span className="block font-inter font-semibold text-xl text-text-primary tabular-nums">
            ${formatPrice(analysis.entryPrice)}
          </span>
        </div>

        <div>
          <Eyebrow className="mb-1">Price Now</Eyebrow>
          <span className={cn('block font-inter font-semibold text-xl tabular-nums', priceChangeColor)}>
            {analysis.currentPrice !== null ? `$${formatPrice(analysis.currentPrice)}` : 'N/A'}
          </span>
        </div>

        <div>
          <Eyebrow className="mb-1">Change</Eyebrow>
          <span className={cn('block font-inter font-semibold text-xl tabular-nums', priceChangeColor)}>
            {formatPercent(analysis.priceChangePercent)}
          </span>
        </div>
      </div>

      <AnimatedCollapse open={expanded}>
        <div className="mt-6 pt-6 border-t border-border/[0.08] dark:border-border">
          <div className="flex flex-wrap gap-6">
            <div>
              <Eyebrow className="mb-1">Stop Loss</Eyebrow>
              <span className="block font-inter font-medium text-text-primary tabular-nums">
                ${formatPrice(analysis.stopLoss)}
              </span>
            </div>
            <div>
              <Eyebrow className="mb-1">Price at Analysis</Eyebrow>
              <span className="block font-inter font-medium text-text-primary tabular-nums">
                ${formatPrice(analysis.priceAtAnalysis)}
              </span>
            </div>
          </div>
        </div>
      </AnimatedCollapse>

      <div className="mt-4 flex items-center justify-end">
        <Caption className="flex items-center gap-1 group">
          {expanded ? 'Hide details' : 'Show details'}
          <svg
            className={cn(
              'w-4 h-4 transition-transform duration-300 ease-out',
              expanded && 'rotate-180'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </Caption>
      </div>
    </div>
  );
}

export function AnalysisHistoryCardSkeleton() {
  return (
    <div className="bg-surface border border-border/[0.08] dark:border-border rounded-xl p-6 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-7 w-12 bg-border/10 dark:bg-border rounded" />
          <div className="h-4 w-32 bg-border/10 dark:bg-border rounded" />
        </div>
        <div className="h-7 w-24 bg-border/10 dark:bg-border rounded" />
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="h-3 w-12 bg-border/10 dark:bg-border rounded mb-2" />
          <div className="h-9 w-20 bg-border/10 dark:bg-border rounded" />
        </div>
        <div>
          <div className="h-3 w-16 bg-border/10 dark:bg-border rounded mb-2" />
          <div className="h-6 w-24 bg-border/10 dark:bg-border rounded" />
        </div>
        <div>
          <div className="h-3 w-14 bg-border/10 dark:bg-border rounded mb-2" />
          <div className="h-6 w-24 bg-border/10 dark:bg-border rounded" />
        </div>
        <div>
          <div className="h-3 w-12 bg-border/10 dark:bg-border rounded mb-2" />
          <div className="h-6 w-16 bg-border/10 dark:bg-border rounded" />
        </div>
      </div>
    </div>
  );
}
