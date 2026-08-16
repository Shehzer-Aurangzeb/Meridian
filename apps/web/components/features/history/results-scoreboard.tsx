'use client';

import { cn } from '@/lib/utils';
import { BUCKET_LABEL, type Bucket, type ResultsSummary } from '@/lib/history-buckets';

/**
 * How the analyses turned out, in counts.
 *
 * Counts, never percentages. Three closed trades make any win rate noise, and
 * the funnel line above the buckets is the reason: "2 won, 1 lost" reads as
 * 67%, while "2 won, 1 lost, 44 never started" is the honest sentence and a
 * different claim about the tool.
 */

const TONE: Partial<Record<Bucket, string>> = {
  openUp: 'text-green',
  wonClosed: 'text-green',
  openDown: 'text-rust',
  lostClosed: 'text-rust',
};

const ORDER: Bucket[] = [
  'openUp',
  'openDown',
  'wonClosed',
  'lostClosed',
  'expired',
  'neverStarted',
  'tooEarly',
];

interface ResultsScoreboardProps {
  summary: ResultsSummary;
  /** True when the window hit the row ceiling — the counts are a subset. */
  truncated: boolean;
  activeBucket: Bucket | 'all';
  onBucketChange: (bucket: Bucket | 'all') => void;
}

export function ResultsScoreboard({
  summary,
  truncated,
  activeBucket,
  onBucketChange,
}: ResultsScoreboardProps) {
  const { counts, netR, total, filled, closed } = summary;

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-3">
        <p className="text-[13px] text-text-secondary">
          <span className="font-mono tabular-nums text-text-primary">{total}</span>{' '}
          analyses →{' '}
          <span className="font-mono tabular-nums text-text-primary">{filled}</span>{' '}
          filled →{' '}
          <span className="font-mono tabular-nums text-text-primary">{closed}</span>{' '}
          closed
        </p>
        <p className="text-[13px] text-text-secondary">
          net{' '}
          <span
            className={cn(
              'font-mono tabular-nums font-medium',
              netR >= 0 ? 'text-green' : 'text-rust',
            )}
          >
            {netR >= 0 ? '+' : ''}
            {netR.toFixed(2)}R
          </span>{' '}
          <span className="text-text-tertiary">after costs</span>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {ORDER.map((bucket) => {
          const active = activeBucket === bucket;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => onBucketChange(active ? 'all' : bucket)}
              aria-pressed={active}
              className={cn(
                'text-left bg-surface border rounded-lg px-3 py-2.5 transition-colors',
                active
                  ? 'border-primary/40 bg-surface-hover'
                  : 'border-border/10 dark:border-border hover:border-primary/25',
              )}
            >
              <div
                className={cn(
                  'font-mono text-[22px] tabular-nums leading-none',
                  counts[bucket] === 0
                    ? 'text-text-tertiary'
                    : (TONE[bucket] ?? 'text-text-primary'),
                )}
              >
                {counts[bucket]}
              </div>
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-text-tertiary mt-1.5 leading-tight">
                {BUCKET_LABEL[bucket]}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-text-tertiary mt-2.5 leading-relaxed">
        Paper outcomes, one per analysis — the same zone re-analysed three times
        a day counts three times, so these are higher than{' '}
        <span className="font-mono">pnpm forward-test</span>, which deduplicates.
        {truncated && ' Showing the newest rows only — older ones are outside this window.'}
      </p>
    </section>
  );
}
