'use client';

import { cn } from '@/lib/utils';
import { BUCKET_LABEL, BUCKET_TONE, FILTERABLE, type Bucket } from '@/lib/sim-buckets';
import type { SimStats } from '@/types/sim';

const signed = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

function Arm({ name, arm }: { name: string; arm: SimStats['take'] }) {
  return (
    <div className="rounded border border-border/40 bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{name}</div>
      <div
        className={cn(
          'mt-1.5 font-mono text-[26px] leading-none tabular-nums',
          arm.netR === null
            ? 'text-text-tertiary'
            : arm.netR >= 0
              ? 'text-green'
              : 'text-rust',
        )}
      >
        {arm.netR === null ? '—' : signed(arm.netR)}
      </div>
      <div className="mt-2 text-[12px] text-text-tertiary">
        {arm.n === 0
          ? 'nothing finished yet'
          : `${arm.wins} of ${arm.n} finished ahead`}
      </div>
    </div>
  );
}

interface ScoreboardProps {
  stats: SimStats;
  counts: Record<Bucket, number>;
  active: Bucket | 'all';
  onFilter: (bucket: Bucket | 'all') => void;
}

/**
 * What the record supports, and nothing beyond it.
 *
 * The headline is the DIFFERENCE between the calls taken and the calls passed
 * on, paired inside a batch — that pairing removes market drift, which runs
 * +0.32 / +0.12 / -0.02 / -0.18 by year and would otherwise be re-measured
 * instead of the analyst. Below four time blocks no interval is drawn at all:
 * plenty of rows across few blocks is the shape of a fake finding, not a small
 * one.
 */
export function Scoreboard({ stats, counts, active, onFilter }: ScoreboardProps) {
  return (
    <section className="mt-8">
      <p className="text-[13px] text-text-secondary">
        <span className="font-mono tabular-nums text-text-primary">{stats.batches}</span>{' '}
        {stats.batches === 1 ? 'batch' : 'batches'} ·{' '}
        <span className="font-mono tabular-nums text-text-primary">{stats.trades}</span>{' '}
        calls ·{' '}
        <span className="font-mono tabular-nums text-text-primary">{stats.resolved}</span>{' '}
        finished,{' '}
        <span className="font-mono tabular-nums text-text-primary">{stats.pending}</span>{' '}
        still running
      </p>

      {/* The difference leads, and is the only figure given room. The two arms
          are inputs to it — shown so the reader can see where it came from, not
          as results in their own right. */}
      <div className="mt-3 rounded border border-border/40 bg-surface p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          How much better the calls it took did
        </div>

        {stats.delta ? (
          <>
            <div
              className={cn(
                'mt-2 font-mono text-[40px] leading-none tabular-nums',
                stats.delta.point >= 0 ? 'text-green' : 'text-rust',
              )}
            >
              {signed(stats.delta.point)}
            </div>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-text-secondary">
              Allowing for chance, the true figure could be anywhere from{' '}
              <span className="font-mono text-text-primary">{signed(stats.delta.lo)}</span> to{' '}
              <span className="font-mono text-text-primary">{signed(stats.delta.hi)}</span>,
              measured across {stats.delta.blocks} separate stretches of time.
              {stats.delta.lo <= 0 && stats.delta.hi >= 0
                ? ' That range includes zero, so this is not yet evidence of anything.'
                : ' That range does not include zero.'}
            </p>
          </>
        ) : (
          <>
            <div className="mt-2 font-mono text-[40px] leading-none text-text-tertiary">—</div>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-text-secondary">
              Not enough evidence yet to put a figure on it.
            </p>
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Arm name="Calls it took" arm={stats.take} />
        <Arm name="Calls it passed on" arm={stats.skip} />
      </div>

      {stats.warning ? (
        <p className="mt-3 rounded border border-amber/40 bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-secondary">
          {stats.warning}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FILTERABLE.map((bucket) => {
          const on = active === bucket;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => onFilter(on ? 'all' : bucket)}
              aria-pressed={on}
              className={cn(
                'rounded border bg-surface px-3 py-2.5 text-left transition-colors',
                on ? 'border-gold/60' : 'border-border/40 hover:border-gold/40',
              )}
            >
              <div
                className={cn(
                  'font-mono text-[22px] leading-none tabular-nums',
                  counts[bucket] === 0 ? 'text-text-tertiary' : BUCKET_TONE[bucket],
                )}
              >
                {counts[bucket]}
              </div>
              <div className="mt-1.5 text-[10px] uppercase leading-tight tracking-[0.1em] text-text-tertiary">
                {BUCKET_LABEL[bucket]}
              </div>
            </button>
          );
        })}
      </div>

      <section className="mt-6 rounded border border-border/40 bg-surface-hover/40 p-6">
        <h2 className="font-antonio text-[16px] font-semibold uppercase tracking-headline text-text-primary">
          What this can and cannot show
        </h2>
        <div className="mt-3 max-w-2xl space-y-3 text-[13px] leading-relaxed text-text-secondary">
          <p>
            <span className="text-text-primary">It can show</span> whether the calls the
            analyst chose to take did better than the ones it passed on — asked at the same
            moment, about the same market. Comparing them against each other cancels
            whatever the market did that week, which would otherwise be measured instead of
            the analyst.
          </p>
          <p>
            <span className="text-text-primary">It cannot show</span> whether an analyst can
            trade profitably. When this was measured properly on a similar record, the
            margin of error alone came to <span className="font-mono">0.318</span> — and{' '}
            <span className="font-mono">0.301</span> of that was the random comparison by
            itself. Any figure a person can build by hand sits inside that range. A positive
            number here after a few months is not a finding, and nothing on this page
            presents it as one.
          </p>
          <p>
            The range above is worked out by resampling whole stretches of time rather than
            individual calls. Ten coins asked in one sitting are close to one observation,
            not ten — so a page full of rows across a handful of weeks earns a wide range,
            or none at all.
          </p>
        </div>
      </section>

    </section>
  );
}
