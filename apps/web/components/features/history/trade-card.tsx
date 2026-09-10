'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  BUCKET_TONE,
  OUTCOME_LABEL,
  bucketOf,
  hoursRemaining,
  progressOf,
  type Bucket,
} from '@/lib/sim-buckets';
import type { SimTrade } from '@/types/sim';

function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}

const fmt = (price: number, dp: number) =>
  price.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

type RungKind = 'stop' | 'entry' | 'target' | 'decided';

interface Rung {
  kind: RungKind;
  price: number;
  label: string;
  hit: boolean;
}

/**
 * Every level plus the price when the call was made, high to low.
 *
 * One rule draws both a long and a short with no special cases: sort by price.
 * Targets are in the order the analyst gave them, so `targetsHit = n` means the
 * first n were reached.
 */
function ladder(row: SimTrade): Rung[] {
  const rungs: Rung[] = [
    { kind: 'stop', price: row.stop, label: 'Stop', hit: false },
    { kind: 'entry', price: row.entry, label: 'Entry', hit: row.filledAt !== null },
    ...row.targets.map((t, i) => ({
      kind: 'target' as const,
      price: t.price,
      label: row.targets.length > 1 ? `Target ${i + 1}` : 'Target',
      hit: i < (row.targetsHit ?? 0),
    })),
    { kind: 'decided', price: row.spotAtDecision, label: 'When read', hit: false },
  ];
  return rungs.sort((a, b) => b.price - a.price);
}

const KIND_TONE: Record<RungKind, string> = {
  stop: 'text-rust',
  entry: 'text-gold-ink',
  target: 'text-green',
  decided: 'text-text-primary',
};

function LadderRow({ rung, dp }: { rung: Rung; dp: number }) {
  const isNow = rung.kind === 'decided';
  return (
    <div
      className={cn(
        'grid grid-cols-[86px_1fr_20px] items-center gap-3 py-1',
        isNow && 'my-1 border-y border-dashed border-text-tertiary/40 py-1.5',
      )}
    >
      <span
        className={cn(
          'text-[10px] font-semibold uppercase tracking-[0.12em]',
          KIND_TONE[rung.kind],
        )}
      >
        {rung.label}
      </span>
      <span
        className={cn(
          'text-right font-mono text-[13px] tabular-nums',
          isNow ? 'font-medium text-text-primary' : 'text-text-secondary',
        )}
      >
        {fmt(rung.price, dp)}
      </span>
      <span className="text-center text-[13px] leading-none text-green">
        {rung.hit ? '✓' : ''}
      </span>
    </div>
  );
}

const BORDER: Record<Bucket, string> = {
  won: 'border-green/25',
  lost: 'border-rust/25',
  noVerdict: 'border-border/40',
  neverFilled: 'border-border/40',
  waiting: 'border-border/40',
};

export function TradeCard({ row }: { row: SimTrade }) {
  const [expanded, setExpanded] = useState(false);
  const bucket = bucketOf(row);
  const dp = decimalsFor(row.spotAtDecision || 1);
  const left = hoursRemaining(row);

  return (
    <article className={cn('overflow-hidden rounded border bg-surface', BORDER[bucket])}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full px-4 pb-3 pt-3.5 text-left transition-colors hover:bg-surface-hover/40"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-antonio text-[18px] font-semibold uppercase tracking-headline text-text-primary">
              {row.symbol}
            </span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]',
                row.verdict === 'TAKE'
                  ? 'bg-gold/20 text-gold-ink'
                  : 'bg-text-tertiary/10 text-text-tertiary',
              )}
            >
              {row.verdict === 'TAKE' ? 'took it' : 'passed'}
            </span>
            <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
              {row.direction}
            </span>
          </span>

          <span
            className={cn(
              'shrink-0 font-mono text-[15px] tabular-nums',
              row.netR === null
                ? 'text-text-tertiary'
                : row.netR >= 0
                  ? 'text-green'
                  : 'text-rust',
            )}
          >
            {row.netR === null ? '—' : `${row.netR >= 0 ? '+' : ''}${row.netR.toFixed(2)}`}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className={cn('text-[13px]', BUCKET_TONE[bucket])}>
            {/* An unfinished call says how long it has left, never a number a
                reader could total. */}
            {row.netR === null
              ? `${progressOf(row)}${left === null ? '' : ` · ${left}h before it can be scored`}`
              : (OUTCOME_LABEL[row.outcome ?? ''] ?? row.outcome)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
            {new Date(row.decidedAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border/40 px-4 py-3">
          <div className="divide-y divide-border/20">
            {ladder(row).map((rung, i) => (
              <LadderRow key={`${rung.kind}-${i}`} rung={rung} dp={dp} />
            ))}
          </div>

          {row.rationale ? (
            <p className="mt-3 border-t border-border/40 pt-3 text-[13px] leading-relaxed text-text-secondary">
              {row.rationale}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-tertiary">
            {row.barsHeld !== null ? <span>held {row.barsHeld}h</span> : null}
            {row.usedOutsideData ? <span>used data beyond this map</span> : null}
            <Link href={`/history/${row.id}`} className="text-text-secondary underline">
              open the reading behind it
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  );
}
