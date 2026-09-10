'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useJournal } from '@/lib/hooks/use-journal';
import { Scoreboard } from '@/components/features/history/scoreboard';
import { TradeCard } from '@/components/features/history/trade-card';
import { bucketOf, groupByBatch, FILTERABLE, type Bucket } from '@/lib/sim-buckets';

export default function HistoryPage() {
  const { rows, stats, loading, error } = useJournal();
  const [filter, setFilter] = useState<Bucket | 'all'>('all');

  const counts = useMemo(() => {
    const out = Object.fromEntries(FILTERABLE.map((b) => [b, 0])) as Record<Bucket, number>;
    for (const row of rows) out[bucketOf(row)] += 1;
    return out;
  }, [rows]);

  const batches = useMemo(
    () => groupByBatch(filter === 'all' ? rows : rows.filter((r) => bucketOf(r) === filter)),
    [rows, filter],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded border border-amber/40 bg-surface p-6">
          <p className="text-[14px] text-text-primary">The journal could not load.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="border-b border-border/40 pb-6">
        <h1 className="font-antonio text-display-sm font-semibold uppercase tracking-headline text-text-primary">
          Journal
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Every call an outside analyst made on a reading from this system, scored against
          what the price actually did. Nothing here feeds the map.
        </p>
      </header>

      {loading ? (
        <p className="mt-8 text-[14px] text-text-tertiary">Loading the journal…</p>
      ) : rows.length === 0 ? (
        <div className="mt-8 rounded border border-border/40 bg-surface p-8 text-center">
          <p className="text-[14px] text-text-primary">Nothing recorded yet.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-text-tertiary">
            Copy a batch of ten readings, put them to the analyst, and record what comes
            back. Passing on a coin counts too — that is the half this record compares
            against.
          </p>
          <Link
            href="/log"
            className="mt-5 inline-block rounded-sm bg-gold px-4 py-2 font-mono text-[13px] text-gold-contrast"
          >
            Log the first batch
          </Link>
        </div>
      ) : (
        <>
          {stats ? (
            <Scoreboard
              stats={stats}
              counts={counts}
              active={filter}
              onFilter={setFilter}
            />
          ) : null}

          <div className="mt-8 space-y-8">
            {batches.map((batch) => (
              <section key={batch.batchId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/40 pb-2">
                  <h2 className="font-antonio text-[17px] font-semibold uppercase tracking-headline text-text-primary">
                    {new Date(batch.decidedAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </h2>
                  <p className="font-mono text-[12px] text-text-tertiary">
                    {batch.rows.length} coins · {batch.takes} taken, {batch.passes} passed ·{' '}
                    {batch.resolved === 0
                      ? 'none finished yet'
                      : `${batch.resolved} finished`}
                  </p>
                </div>

                <div className="mt-3 grid items-start gap-3 md:grid-cols-2">
                  {batch.rows.map((row) => (
                    <TradeCard key={row.id} row={row} />
                  ))}
                </div>
              </section>
            ))}

            {batches.length === 0 ? (
              <p className="text-[14px] text-text-tertiary">
                Nothing in that group. Tap the same box again to see everything.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
