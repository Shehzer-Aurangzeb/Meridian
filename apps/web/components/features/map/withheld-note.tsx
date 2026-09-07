import type { Probability } from '@/types/map';
import { isPublished } from '@/types/map';

/**
 * How a missing probability is shown.
 *
 * ─── Why an absence gets this much room ──────────────────────────────────
 * Three of the four probabilities this system tried to produce failed their
 * pre-registered bars. Rendering those as "—" would read as a loading state or
 * a gap in the data, and the reader would supply their own guess in place of
 * the number.
 *
 * They are results. A zone whose bounce rate is unpublished is telling the
 * reader something specific: this was measured, twice, and the features
 * carried no information. Saying so is more useful than any number that could
 * have gone there, and it is the difference between a system that is honest
 * and one that merely looks tidy.
 */
export function WithheldNote({
  label,
  probability,
}: {
  label: string;
  probability: Probability;
}) {
  if (isPublished(probability)) {
    return (
      <div className="text-xs">
        <span className="text-neutral-400">{label}: </span>
        <span className="font-mono text-neutral-100">
          {(probability.value * 100).toFixed(0)}%
        </span>
        {/* The count rides with the number, always. A probability whose
            sample size is invisible cannot be judged by the person reading it. */}
        <span className="ml-1 text-neutral-600">
          n={probability.n.toLocaleString()}
          {probability.ci95
            ? ` · 95% ${(probability.ci95[0] * 100).toFixed(0)}–${(probability.ci95[1] * 100).toFixed(0)}%`
            : ''}
        </span>
      </div>
    );
  }

  return (
    <details className="group text-xs">
      <summary className="cursor-pointer list-none text-neutral-500 hover:text-neutral-300">
        <span className="text-neutral-400">{label}: </span>
        <span className="font-medium text-amber-600/80">not published</span>
        <span className="ml-1 text-neutral-700 group-open:hidden">why?</span>
      </summary>
      <p className="mt-2 border-l-2 border-neutral-800 pl-3 leading-relaxed text-neutral-500">
        {probability.reason}
      </p>
      <p className="mt-1 pl-3 font-mono text-[10px] text-neutral-700">
        {probability.evidence}
      </p>
    </details>
  );
}
