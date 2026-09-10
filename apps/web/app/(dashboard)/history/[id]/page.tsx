'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchApi } from '@/lib/api/client';
import { normaliseSnapshot } from '@/lib/snapshot';
import {
  OUTCOME_LABEL,
  bucketOf,
  hoursRemaining,
  progressOf,
  BUCKET_TONE,
} from '@/lib/sim-buckets';
import { MapView } from '@/components/features/map/map-view';
import { PriceChart, type ChartLevel } from '@/components/features/map/price-chart';
import type { SimTrade } from '@/types/sim';

const asMoney = (x: number): string =>
  x.toLocaleString('en-US', { maximumFractionDigits: x > 100 ? 2 : 4 });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">{label}</dt>
      <dd className="mt-0.5 font-mono text-[14px] text-text-primary">{children}</dd>
    </div>
  );
}

export default function TradeDetailPage() {
  // `useParams`, not `use(params)`: this is a client component on Next 14, where
  // the params prop is a plain object and `use()` throws on one.
  const id = String(useParams().id ?? '');

  const { data: row, isPending, error } = useQuery({
    queryKey: ['sim', 'one', id],
    queryFn: () => fetchApi<SimTrade>(`/api/sim/${id}`),
  });

  // The archived reading, made safe to render without inventing anything it
  // did not hold. See lib/snapshot.ts.
  const snapshot = useMemo(
    () => (row ? normaliseSnapshot(row.mapSnapshot) : null),
    [row],
  );

  // `?? []` inline handed the chart a new array on every render, which redrew
  // every price line each time.
  const zones = useMemo(() => snapshot?.zones ?? [], [snapshot]);

  const levels: ChartLevel[] = useMemo(() => {
    if (!row) return [];
    return [
      { price: row.entry, label: 'entry', tone: 'entry' },
      { price: row.stop, label: 'stop', tone: 'stop' },
      ...row.targets.map((t, i) => ({
        price: t.price,
        label: row.targets.length > 1 ? `target ${i + 1}` : 'target',
        tone: 'target' as const,
      })),
    ];
  }, [row]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded border border-amber/40 bg-surface p-6">
          <p className="text-[14px] text-text-primary">This record could not load.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{error.message}</p>
          <Link href="/history" className="mt-4 inline-block text-[13px] text-gold-ink underline">
            Back to the journal
          </Link>
        </div>
      </div>
    );
  }

  if (isPending || !row) {
    return <p className="text-[14px] text-text-tertiary">Loading the record…</p>;
  }

  const bucket = bucketOf(row);
  const left = hoursRemaining(row);
  const risk = Math.abs(row.entry - row.stop);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/history" className="text-[13px] text-text-secondary hover:text-text-primary">
        ← Journal
      </Link>

      <header className="mt-4 border-b border-border/40 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-antonio text-display-sm font-semibold uppercase tracking-headline text-text-primary">
            {row.symbol}
            <span
              className={cn(
                'ml-4 rounded px-2 py-1 align-middle text-[11px] font-semibold uppercase tracking-[0.12em]',
                row.verdict === 'TAKE'
                  ? 'bg-gold/20 text-gold-ink'
                  : 'bg-text-tertiary/10 text-text-tertiary',
              )}
            >
              {row.verdict === 'TAKE' ? 'took it' : 'passed on it'}
            </span>
          </h1>
          <span
            className={cn(
              'font-mono text-[26px] tabular-nums',
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

        <p className={cn('mt-2 text-[14px]', BUCKET_TONE[bucket])}>
          {row.netR === null
            ? `${progressOf(row)}${
                left === null
                  ? '. Due to be scored on the next visit.'
                  : `. ${left} hours before it can be scored.`
              }`
            : (OUTCOME_LABEL[row.outcome ?? ''] ?? row.outcome)}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="font-antonio text-[20px] font-semibold uppercase tracking-headline text-text-primary">
          The call, drawn
        </h2>
        <p className="mb-4 mt-1.5 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          The chart is anchored at the moment the reading was taken, not at today, so the
          bars to the left of the marker are the ones the analyst could see.
        </p>
        <PriceChart
          symbol={row.symbol}
          spot={row.spotAtDecision}
          zones={zones}
          anchorAt={row.decidedAt}
          levels={levels}
        />
      </section>

      <section className="mt-8 rounded border border-border/40 bg-surface p-6">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="Direction">{row.direction}</Fact>
          <Fact label="Price when read">{asMoney(row.spotAtDecision)}</Fact>
          <Fact label="Entry">{asMoney(row.entry)}</Fact>
          <Fact label="Stop">
            {asMoney(row.stop)}
            <span className="ml-1.5 text-[12px] text-text-tertiary">
              {((risk / row.entry) * 100).toFixed(2)}% away
            </span>
          </Fact>
          <Fact label={row.targets.length > 1 ? 'Targets' : 'Target'}>
            {row.targets.length === 0
              ? 'none given'
              : row.targets.map((t) => asMoney(t.price)).join(', ')}
          </Fact>
          {row.filledAt ? (
            <Fact label="Filled">
              {new Date(row.filledAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Fact>
          ) : null}
          {row.barsHeld !== null ? <Fact label="Held">{row.barsHeld} hours</Fact> : null}
          {row.targetsHit !== null ? (
            <Fact label="Targets reached">
              {row.targetsHit} of {row.targets.length}
            </Fact>
          ) : null}
          {row.grossR !== null ? (
            <Fact label="Before costs">
              {row.grossR >= 0 ? '+' : ''}
              {row.grossR.toFixed(2)}
            </Fact>
          ) : null}
        </dl>

        {row.grossR !== null && row.netR !== null ? (
          <p className="mt-5 border-t border-border/40 pt-4 text-[13px] leading-relaxed text-text-secondary">
            The gap between {row.grossR.toFixed(2)} and {row.netR.toFixed(2)} is the cost of
            trading, charged against the stop distance rather than as a flat fee: a tighter
            stop pays proportionally more, because the same 0.25% round trip is a larger
            share of a smaller risk.
          </p>
        ) : null}
      </section>

      {row.rationale ? (
        <section className="mt-8">
          <h2 className="font-antonio text-[20px] font-semibold uppercase tracking-headline text-text-primary">
            What the analyst said
          </h2>
          <p className="mt-3 whitespace-pre-wrap rounded border border-border/40 bg-surface p-6 text-[14px] leading-relaxed text-text-secondary">
            {row.rationale}
          </p>
          {row.usedOutsideData ? (
            <p className="mt-2 text-[13px] text-text-tertiary">
              The analyst also looked things up beyond this reading, so the snapshot below
              is what our system showed — not everything it saw.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-12 border-t border-border/40 pt-8">
        <h2 className="font-antonio text-[20px] font-semibold uppercase tracking-headline text-text-primary">
          The reading it was given
        </h2>
        <p className="mb-6 mt-1.5 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Frozen as it stood on{' '}
          {new Date(row.decidedAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          . This is stored with the record rather than rebuilt, so it still shows what was
          on screen even after the map itself changes.
        </p>

        {snapshot ? (
          <MapView map={snapshot} />
        ) : (
          <p className="rounded border border-amber/40 bg-surface p-6 text-[14px] text-text-secondary">
            The stored reading for this record is unreadable, so nothing is shown rather
            than a reconstruction.
          </p>
        )}
      </section>
    </div>
  );
}
