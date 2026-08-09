'use client';

import { cn } from '@/lib/utils';
import { formatEnumLabel, formatListDate } from '@/lib/format';
import type { AnalysisListItem, Regime } from '@/types/analyses';

/**
 * Columns are exactly what `GET /analyses` returns.
 *
 * Signal, confidence, outcome and R are deliberately absent: scoring a plan
 * needs its payload and the candles since, which is what the detail route
 * does per analysis. Showing them here would mean a request per row.
 */

const REGIME_STYLES: Record<Regime, string> = {
  COMPRESSION: 'bg-gold/20 text-gold-ink',
  TRENDING: 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
  MEAN_REVERSION: 'bg-primary/[0.08] text-text-secondary',
};

function RegimeBadge({ regime }: { regime: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded whitespace-nowrap',
        REGIME_STYLES[regime as Regime] ?? 'bg-primary/[0.08] text-text-secondary'
      )}
    >
      {formatEnumLabel(regime)}
    </span>
  );
}

function FailedBadge() {
  return (
    <span className="inline-flex items-center text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded bg-rust/15 text-rust">
      Failed
    </span>
  );
}

interface HistoryTableProps {
  entries: AnalysisListItem[];
  onRowClick?: (entry: AnalysisListItem) => void;
}

const HEAD =
  'text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border';

export function HistoryTable({ entries, onRowClick }: HistoryTableProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-surface border border-border/10 dark:border-border rounded-lg p-10 text-center">
        <p className="text-text-secondary text-sm">No analyses match these filters.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border/10 dark:border-border rounded-lg overflow-hidden">
      {/* Desktop table */}
      <table className="w-full border-collapse hidden md:table">
        <thead>
          <tr>
            <th className={cn(HEAD, 'pl-5 w-[140px]')}>When</th>
            <th className={cn(HEAD, 'w-[80px]')}>Coin</th>
            <th className={cn(HEAD, 'w-[150px]')}>Regime</th>
            <th className={HEAD}>Strategy</th>
            <th className={cn(HEAD, 'text-right pr-5 w-[90px]')}>Took</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <tr
              key={entry.id}
              onClick={() => onRowClick?.(entry)}
              className={cn(
                'cursor-pointer transition-colors hover:bg-primary/[0.025]',
                idx < entries.length - 1 &&
                  '[&>td]:border-b [&>td]:border-border/10 dark:[&>td]:border-border'
              )}
            >
              <td className="p-4 pl-5 font-mono text-xs tracking-[0.04em] text-text-tertiary whitespace-nowrap">
                {formatListDate(entry.createdAt)}
              </td>
              <td className="p-4">
                <span className="font-display text-[17px] font-semibold tracking-[0.04em] uppercase text-text-primary">
                  {entry.symbol}
                </span>
              </td>
              <td className="p-4">
                {entry.errorMessage ? <FailedBadge /> : <RegimeBadge regime={entry.regime} />}
              </td>
              <td className="p-4 text-sm text-text-secondary">
                {formatEnumLabel(entry.strategyRoute)}
                <span className="font-mono text-[11px] text-text-tertiary ml-1.5 tracking-[0.04em]">
                  {entry.timeframe}
                </span>
              </td>
              <td className="p-4 pr-5 text-right font-mono text-[13px] text-text-tertiary">
                {(entry.durationMs / 1000).toFixed(1)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <div className="md:hidden">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            onClick={() => onRowClick?.(entry)}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 p-4 cursor-pointer transition-colors hover:bg-primary/[0.025]',
              idx < entries.length - 1 && 'border-b border-border/10 dark:border-border'
            )}
          >
            <div className="font-mono text-xs tracking-[0.04em] text-text-tertiary">
              {formatListDate(entry.createdAt)}
            </div>
            <div className="font-display text-[17px] font-semibold tracking-[0.04em] uppercase text-text-primary">
              {entry.symbol}
            </div>
            <div className="text-right">
              {entry.errorMessage ? <FailedBadge /> : <RegimeBadge regime={entry.regime} />}
            </div>

            <div className="col-span-3 text-sm text-text-secondary">
              {formatEnumLabel(entry.strategyRoute)}
              <span className="font-mono text-[11px] text-text-tertiary ml-1.5 tracking-[0.04em]">
                {entry.timeframe}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
