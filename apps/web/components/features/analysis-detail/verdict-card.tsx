'use client';

import { cn } from '@/lib/utils';
import { useNarrate } from '@/lib/hooks/use-analyses';
import type { Freshness, SavedNarration, Verdict } from '@/types/analyses';

/**
 * What this analysis amounts to, before any of the numbers.
 *
 * Two layers, and the difference matters:
 *   verdict    computed in TypeScript, always present, restates the struct
 *   narration  Claude's read, on request, may decline — and cannot change a
 *              number, because a cited price with no computed source throws
 *              the whole text away
 */

const TONE: Record<Freshness, string> = {
  LIVE: 'border-gold/30',
  INVALIDATED: 'border-rust/30',
  SUPERSEDED: 'border-border/10 dark:border-border',
};

interface VerdictCardProps {
  id: string;
  verdict: Verdict;
  narration: SavedNarration | null;
  freshness: Freshness;
}

export function VerdictCard({ id, verdict, narration, freshness }: VerdictCardProps) {
  const narrate = useNarrate(id);
  const read = narration ?? narrate.data;

  return (
    <section className={cn('bg-surface border rounded-xl overflow-hidden', TONE[freshness])}>
      <div className="px-6 py-5">
        <h2 className="font-display text-[22px] md:text-[26px] font-semibold tracking-[0.01em] text-text-primary leading-snug">
          {verdict.headline}
        </h2>

        <div className="mt-3 flex flex-col gap-2">
          {verdict.body.map((sentence) => (
            <p key={sentence} className="text-[15px] text-text-secondary leading-relaxed">
              {sentence}
            </p>
          ))}
        </div>

        {verdict.status && (
          <p className="mt-4 pt-4 border-t border-border/10 dark:border-border text-[15px] text-text-primary">
            <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink block mb-1">
              Since then
            </span>
            {verdict.status}
          </p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-border/10 dark:border-border bg-primary/[0.02]">
        {!read && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-text-tertiary">
              Everything above is computed. Claude can add what it means in
              context — it cannot change a number.
            </p>
            <button
              type="button"
              onClick={() => narrate.mutate()}
              disabled={narrate.isPending}
              className={cn(
                'shrink-0 border border-border/10 dark:border-border rounded-full',
                'px-4 py-2 text-[13px] font-medium text-text-primary',
                'transition-colors hover:border-primary/30 hover:bg-surface-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {narrate.isPending ? 'Reading…' : "Ask Claude to read this"}
            </button>
          </div>
        )}

        {narrate.error && !read && (
          <p className="text-[13px] text-rust mt-3">
            {narrate.error.message}
            <span className="block text-text-tertiary mt-0.5">
              The computed analysis is unaffected.
            </span>
          </p>
        )}

        {read && (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink">
                The analyst&rsquo;s read
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">
                {read.model} · {read.citedPrices.length} price
                {read.citedPrices.length === 1 ? '' : 's'} cited, all traced
              </span>
            </div>
            {read.text.split(/\n{2,}/).map((paragraph) => (
              <p
                key={paragraph}
                className="text-[15px] text-text-secondary leading-relaxed mb-3 last:mb-0 whitespace-pre-line"
              >
                {paragraph}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
