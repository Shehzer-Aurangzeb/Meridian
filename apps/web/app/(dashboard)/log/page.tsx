'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fetchApi } from '@/lib/api/client';
import { promptFor } from '@/lib/sim-prompt';
import { useBatch, isBlank, type Draft } from '@/lib/hooks/use-batch';
import { CopyButton } from '@/components/features/log/copy-button';
import { DraftRow } from '@/components/features/log/draft-row';
import { ReplyBox } from '@/components/features/log/reply-box';
import type { MarketMap } from '@/types/map';

/**
 * Record one batch of analyst calls.
 *
 * All ten coins on one screen because they are asked in one conversation: the
 * comparison this journal can actually make is between the coins taken and the
 * coins passed on WITHIN a batch, and a batch assembled over ten page loads is
 * ten separate moments of a moving market.
 */
export default function LogPage() {
  const { maps, drafts, update, reset, reload, fillFromReply, parsing, loading, error } =
    useBatch();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ batchId: string; count: number } | null>(null);

  const filled = drafts.filter((d) => !isBlank(d));
  const takes = filled.filter((d) => d.verdict === 'TAKE').length;

  const handleSubmit = async () => {
    if (maps === null || filled.length === 0) return;
    setSubmitting(true);
    setFailure(null);
    setSaved(null);
    try {
      const got = await fetchApi<{ batchId: string; trades: number }>('/api/sim', {
        method: 'POST',
        body: JSON.stringify({ trades: filled.map((d) => toTrade(d, maps[d.symbol])) }),
      });
      setSaved({ batchId: got.batchId, count: got.trades });
      reset();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="border-b border-border/40 pb-6">
        <h1 className="font-antonio text-display-sm font-semibold uppercase tracking-headline text-text-primary">
          Log a batch
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Copy all ten readings, paste them into one conversation with the analyst, then
          record what comes back. Passing on a coin is a result too — record the plan it
          would have placed, or the two arms cannot be compared.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <CopyButton
            variant="primary"
            label="Copy all ten"
            copiedLabel="Copied all ten"
            text={() =>
              maps === null
                ? ''
                : drafts
                    .map((d) => maps[d.symbol])
                    .filter((m): m is MarketMap => m !== undefined)
                    .map(promptFor)
                    .join('\n\n' + '='.repeat(72) + '\n\n')
            }
          />
          <button
            type="button"
            onClick={reload}
            className="rounded-sm border border-border/60 px-3 py-1.5 font-mono text-[13px] text-text-secondary hover:border-gold/60 hover:text-text-primary"
          >
            Refresh readings
          </button>
          <span className="font-mono text-[12px] text-text-tertiary">
            {loading
              ? 'reading the market…'
              : `${filled.length} of 10 recorded · ${takes} taken, ${filled.length - takes} passed`}
          </span>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded border border-amber/40 bg-surface p-6">
          <p className="text-[14px] text-text-primary">The readings could not load.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{error}</p>
        </div>
      ) : null}

      <ReplyBox onFill={fillFromReply} parsing={parsing} disabled={maps === null} />

      <div className="mt-6 space-y-4">
        {drafts.map((draft) => (
          <DraftRow
            key={draft.symbol}
            draft={draft}
            map={maps?.[draft.symbol]}
            onChange={(patch) => update(draft.symbol, patch)}
          />
        ))}
      </div>

      {saved ? (
        <div className="mt-6 rounded border border-green/40 bg-surface p-5">
          <p className="text-[14px] text-text-primary">
            Saved {saved.count} call{saved.count === 1 ? '' : 's'} as one batch.
          </p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">
            batch {saved.batchId} — scored once 96 hours have passed.
          </p>
          <Link
            href="/history"
            className="mt-3 inline-block rounded-sm border border-border/60 px-3 py-1.5 font-mono text-[13px] text-text-secondary hover:border-gold/60 hover:text-text-primary"
          >
            See it in the journal
          </Link>
        </div>
      ) : null}

      {failure ? (
        <div className="mt-6 rounded border border-amber/40 bg-surface p-5">
          <p className="text-[14px] text-text-primary">This batch was not saved.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{failure}</p>
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-4 border-t border-border/40 bg-background py-5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || filled.length === 0 || maps === null}
          className="rounded-sm bg-gold px-5 py-2 font-mono text-[14px] text-gold-contrast disabled:opacity-40"
        >
          {submitting ? 'Saving…' : `Save ${filled.length} call${filled.length === 1 ? '' : 's'}`}
        </button>
        <p className="text-[13px] text-text-tertiary">
          Saved as one batch. Nothing is scored until 96 hours have passed.
        </p>
      </div>
    </div>
  );
}

/**
 * The snapshot is taken from what is on screen, never retyped.
 *
 * `decidedAt` is the moment the reading was taken, not the moment Save was
 * pressed: the scoring window has to start where the analyst's information
 * ended, or the first bars are ones they could not have seen.
 */
function toTrade(draft: Draft, map: MarketMap | undefined) {
  return {
    symbol: draft.symbol,
    verdict: draft.verdict,
    direction: draft.direction,
    entry: Number(draft.entry),
    stop: Number(draft.stop),
    targets: draft.targets
      .filter((t) => t.price.trim() !== '')
      .map((t) => ({ price: Number(t.price), weightPercent: Number(t.weightPercent) })),
    rationale: draft.rationale.trim() === '' ? undefined : draft.rationale.trim(),
    mapSnapshot: map,
    spotAtDecision: map?.spot ?? 0,
    usedOutsideData: draft.usedOutsideData,
    decidedAt: map?.asOf,
  };
}
