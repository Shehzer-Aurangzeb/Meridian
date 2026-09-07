'use client';

import { useState } from 'react';
import { Explain, EXPLAIN } from '@/components/ui/explain';
import type { Probability } from '@/types/map';
import { isPublished } from '@/types/map';

/**
 * A number we can stand behind, or a plain statement that we cannot.
 *
 * ─── Why an absence gets this much room ──────────────────────────────────
 * Three of the four probabilities this system tried to produce failed their
 * tests. Rendering those as "—" would read as a loading state or a gap in the
 * data, and the reader would quietly fill it with their own guess.
 *
 * They are results. Saying "we tried, it failed, here is why" is more useful
 * than any number that could have gone there, and it is the difference between
 * a product that is honest and one that merely looks finished.
 */
export function WithheldNote({
  label,
  probability,
}: {
  label: string;
  probability: Probability;
}) {
  const [open, setOpen] = useState(false);

  if (isPublished(probability)) {
    return (
      <div className="text-[13px]">
        <span className="text-text-secondary">{label}: </span>
        <span className="font-mono text-text-primary">
          {(probability.value * 100).toFixed(0)}%
        </span>
        {/* The count rides with the number, always. A probability whose sample
            size is invisible cannot be judged by the person reading it. */}
        <Explain term={EXPLAIN.sampleSize} className="ml-2 text-[12px] text-text-tertiary">
          based on {probability.n.toLocaleString()} real cases
        </Explain>
      </div>
    );
  }

  return (
    <div className="text-[13px]">
      <span className="text-text-secondary">{label}: </span>
      <Explain term={EXPLAIN.notPublished} className="text-[13px] text-amber">
        we don&rsquo;t publish this
      </Explain>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ml-2 text-[12px] text-gold-ink underline underline-offset-2 hover:text-text-primary"
      >
        {open ? 'hide' : 'why not?'}
      </button>

      {open && (
        <p className="mt-2 border-l-2 border-border pl-3 text-[12px] leading-relaxed text-text-tertiary">
          {probability.reason}
        </p>
      )}
    </div>
  );
}
