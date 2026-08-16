'use client';

import { cn } from '@/lib/utils';
import { useNarrate } from '@/lib/hooks/use-analyses';
import type { Freshness, SavedNarration, Verdict } from '@/types/analyses';

/**
 * What the analysis amounts to, before the numbers. Two layers:
 *
 *   verdict    plain code, always there, just restates what was computed
 *   narration  the AI's explanation, only on request, and it can decline
 */

const TONE: Record<Freshness, string> = {
  LIVE: 'border-gold/30',
  INVALIDATED: 'border-rust/30',
  SUPERSEDED: 'border-border/10 dark:border-border',
};

/**
 * The AI writes in Markdown, so it needs formatting rather than printing raw.
 *
 * TODO: no Markdown library — only headings, bold, italic and paragraphs are
 * handled, which is all the prompt asks for. Add one if that changes.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|\$\s?[\d,]+(?:\.\d+)?)/g;

function inline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    // Every price is $-prefixed by prompt rule — the same shape assertProvenance
    // checks. Monospace makes a number-dense paragraph scannable.
    if (part.startsWith('$')) {
      return (
        <span key={i} className="font-mono text-[0.92em] text-text-primary">
          {part}
        </span>
      );
    }
    return part;
  });
}

function NarrationProse({ text }: { text: string }) {
  return (
    // ~70 characters is the readable line length; the card is far wider than
    // that on a desktop, and unconstrained prose at 1440px is a wall.
    <div className="max-w-[70ch] flex flex-col gap-3">
      {text.split(/\n{2,}/).map((block, i) => {
        const heading = /^#{1,4}\s+(.+)$/.exec(block.trim());
        return heading ? (
          <h3
            key={i}
            className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink mt-4 first:mt-0"
          >
            {heading[1]}
          </h3>
        ) : (
          <p key={i} className="text-[15px] text-text-secondary leading-relaxed">
            {inline(block.trim())}
          </p>
        );
      })}
    </div>
  );
}

interface VerdictCardProps {
  id: string;
  verdict: Verdict | null;
  narration: SavedNarration | null;
  freshness: Freshness;
}

export function VerdictCard({ id, verdict, narration, freshness }: VerdictCardProps) {
  const narrate = useNarrate(id);
  const read = narration ?? narrate.data;

  // An API deployed before the verdict shipped. The evidence below is the
  // whole analysis and renders fine without this card, so drop it rather than
  // take the page down with it.
  if (!verdict) return null;

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
            <NarrationProse text={read.text} />
          </div>
        )}
      </div>
    </section>
  );
}
