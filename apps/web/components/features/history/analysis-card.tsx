'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format';
import { bucketOf } from '@/lib/history-buckets';
import type { AnalysisListItem, AnalysisStatus } from '@/types/analyses';

/**
 * One analysis, readable without opening it: what it said, where price is now
 * relative to every level it set, and which targets were reached.
 *
 * The ladder is the whole idea — prices sorted high to low with a "now" line
 * inserted at its position. That single rule draws a long (stop below, targets
 * above) and a short (the reverse) with no branch, and the live price walks the
 * line up and down the card.
 */

const OUTCOME_TONE: Record<string, string> = {
  OPEN: 'text-text-primary',
  ALL_TARGETS: 'text-green',
  PARTIAL: 'text-green',
  STOPPED: 'text-rust',
  MISSED: 'text-text-tertiary',
  PENDING: 'text-text-tertiary',
  EXPIRED: 'text-text-secondary',
  UNSCOREABLE: 'text-text-tertiary',
};

const OUTCOME_LABEL: Record<string, string> = {
  OPEN: 'Open',
  ALL_TARGETS: 'All targets',
  PARTIAL: 'Partial',
  STOPPED: 'Stopped out',
  MISSED: 'Never filled',
  PENDING: 'Waiting to fill',
  EXPIRED: 'Expired unresolved',
  UNSCOREABLE: 'Not scored',
};

/** Enough decimals for the coin: LINK needs four, BTC needs two. */
function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}

const fmt = (price: number, dp: number) =>
  price.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

type RungKind = 'stop' | 'entry' | 'target' | 'now';

interface Rung {
  kind: RungKind;
  price: number;
  label: string;
  hit: boolean;
}

/**
 * Every level plus the live price, high to low. Targets are ordered TP1..TPn
 * by the planner, so `targetsHit = n` means the first n were reached.
 */
function ladder(status: AnalysisStatus, livePrice: number): Rung[] {
  const { plan } = status;
  if (!plan) return [];

  const rungs: Rung[] = [
    { kind: 'stop', price: plan.stop, label: 'Stop', hit: false },
    ...plan.entries.map((price, i) => ({
      kind: 'entry' as const,
      price,
      label: `Entry ${i + 1}`,
      hit: false,
    })),
    ...plan.targets.map((price, i) => ({
      kind: 'target' as const,
      price,
      label: `TP${i + 1}`,
      hit: i < status.targetsHit,
    })),
    { kind: 'now', price: livePrice, label: 'Now', hit: false },
  ];

  return rungs.sort((a, b) => b.price - a.price);
}

const KIND_TONE: Record<RungKind, string> = {
  stop: 'text-rust',
  entry: 'text-gold-ink',
  target: 'text-green',
  now: 'text-text-primary',
};

function LadderRow({ rung, dp }: { rung: Rung; dp: number }) {
  const isNow = rung.kind === 'now';
  return (
    <div
      className={cn(
        'grid grid-cols-[64px_1fr_20px] items-center gap-3 py-1',
        isNow && 'border-y border-dashed border-text-tertiary/40 my-1 py-1.5',
      )}
    >
      <span
        className={cn(
          'text-[10px] font-semibold tracking-[0.12em] uppercase',
          KIND_TONE[rung.kind],
        )}
      >
        {rung.label}
      </span>
      <span
        className={cn(
          'font-mono text-[13px] tabular-nums text-right',
          isNow ? 'text-text-primary font-medium' : 'text-text-secondary',
        )}
      >
        {fmt(rung.price, dp)}
      </span>
      <span className="text-green text-[13px] leading-none text-center">
        {rung.hit ? '✓' : ''}
      </span>
    </div>
  );
}

interface AnalysisCardProps {
  entry: AnalysisListItem;
  /** From the socket; falls back to the price the API scored against. */
  livePrice?: number;
  onOpen: () => void;
}

export function AnalysisCard({ entry, livePrice, onOpen }: AnalysisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const status = entry.status;

  if (!status) {
    return (
      <article className="bg-surface border border-border/10 dark:border-border rounded-xl p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-lg font-semibold tracking-[0.04em] uppercase">
            {entry.symbol}
          </span>
          <span className="text-[11px] text-text-tertiary">
            {formatRelative(entry.createdAt)}
          </span>
        </div>
        <p className="text-[13px] text-text-tertiary mt-2">
          {entry.errorMessage ? 'This run failed.' : 'No status — score unavailable.'}
        </p>
      </article>
    );
  }

  const price = livePrice ?? status.currentPrice;
  const dp = decimalsFor(price || 1);
  const bucket = bucketOf(status);
  const netR = status.netR;
  const drift = status.plan
    ? ((price - status.plan.averageEntry) / status.plan.averageEntry) * 100
    : null;

  return (
    <article
      className={cn(
        'bg-surface border rounded-xl overflow-hidden transition-colors',
        bucket === 'lostClosed'
          ? 'border-rust/25'
          : bucket === 'wonClosed'
            ? 'border-green/25'
            : 'border-border/10 dark:border-border',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full text-left px-4 pt-3.5 pb-3 hover:bg-surface-hover/40 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-lg font-semibold tracking-[0.04em] uppercase text-text-primary">
            {entry.symbol}
          </span>
          <span className="font-mono text-[11px] text-text-tertiary tabular-nums">
            {formatRelative(entry.createdAt)}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3 mt-1.5">
          <span className="font-mono text-[19px] tabular-nums text-text-primary">
            {fmt(price, dp)}
          </span>
          {drift !== null && (
            <span
              className={cn(
                'font-mono text-[12px] tabular-nums',
                drift >= 0 ? 'text-green' : 'text-rust',
              )}
            >
              {drift >= 0 ? '+' : ''}
              {drift.toFixed(2)}% vs entry
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border/10 dark:border-border">
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'text-[10px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 rounded',
                status.direction === 'long'
                  ? 'bg-green/15 text-green'
                  : 'bg-rust/15 text-rust',
              )}
            >
              {status.direction ?? '—'}
            </span>
            <span
              className={cn(
                'text-[12px] truncate',
                OUTCOME_TONE[status.outcome ?? ''] ?? 'text-text-secondary',
              )}
            >
              {OUTCOME_LABEL[status.outcome ?? ''] ?? 'No plan'}
            </span>
          </span>

          <span
            className={cn(
              'font-mono text-[15px] tabular-nums font-medium shrink-0',
              netR === null
                ? 'text-text-tertiary'
                : netR >= 0
                  ? 'text-green'
                  : 'text-rust',
            )}
          >
            {netR === null ? '—' : `${netR >= 0 ? '+' : ''}${netR.toFixed(2)}R`}
          </span>
        </div>
      </button>

      {expanded && status.plan && (
        <div className="px-4 pb-3.5 pt-1">
          <div className="border-t border-border/10 dark:border-border pt-2.5">
            {ladder(status, price).map((rung, i) => (
              <LadderRow key={`${rung.kind}-${i}`} rung={rung} dp={dp} />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border/10 dark:border-border">
            <span className="font-mono text-[11px] text-text-tertiary">
              risk {status.plan.riskPercent.toFixed(2)}% · planned{' '}
              {status.plan.blendedR.toFixed(2)}R
              {status.r !== null && ` · gross ${status.r.toFixed(2)}R`}
            </span>
            <button
              type="button"
              onClick={onOpen}
              className="shrink-0 text-[12px] font-medium text-text-primary border border-border/10 dark:border-border rounded-full px-3 py-1 hover:border-primary/30 hover:bg-surface-hover transition-colors"
            >
              Open →
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
