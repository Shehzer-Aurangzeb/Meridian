'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A term with a plain-English explanation attached.
 *
 * ─── Why every technical word on this product gets one ───────────────────
 * The person reading this screen built the tool and is not a trader. Words
 * like compression, percentile and resting depth are not shorthand to them —
 * they are opaque. A number nobody can read is worse than no number, because
 * it still looks authoritative.
 *
 * So the rule is: if a term needs a glossary, it carries its own.
 *
 * ─── Interaction ─────────────────────────────────────────────────────────
 * Hover on a pointer device, tap on touch, Escape or an outside click to
 * dismiss. It is a `<button>` rather than a `<span>` with handlers so it is
 * reachable by keyboard and announced as interactive, and the panel is
 * `role="tooltip"` tied by `aria-describedby`.
 *
 * The panel opens ABOVE by default and flips below when there is no room, so
 * it never covers the number it is explaining — the reader is looking at that
 * number, and hiding it to explain it is self-defeating.
 */
export function Explain({
  term,
  children,
  className,
  align = 'left',
}: {
  /** The plain-English sentence. One sentence, no jargon of its own. */
  term: string;
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };

    // Flip below only when the panel would be clipped by the top of the
    // viewport. Measured on open rather than guessed from position in the page.
    const box = ref.current?.getBoundingClientRect();
    setBelow((box?.top ?? 0) < 140);

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'cursor-help border-b border-dotted border-text-tertiary/60 bg-transparent p-0',
          'text-left font-[inherit] text-[inherit] leading-[inherit] text-[inherit]',
          'hover:border-gold-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40',
        )}
      >
        {children}
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute z-50 w-64 rounded-sm border border-border bg-surface p-3 shadow-lg',
            'text-[13px] font-normal normal-case leading-relaxed tracking-normal text-text-secondary',
            align === 'right' ? 'right-0' : 'left-0',
            below ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          {term}
        </span>
      )}
    </span>
  );
}

/**
 * The glossary, in one place.
 *
 * Keeping the sentences here rather than inline at each call site means a term
 * is explained the same way everywhere it appears. Two slightly different
 * explanations of "percentile" on two screens is how a reader learns that the
 * words are not to be trusted.
 */
export const EXPLAIN = {
  expectedMove:
    'How far the price is likely to move, up or down. It says nothing about which direction — only how big the move is likely to be.',
  mostLikely:
    'Half the time the move is smaller than this, half the time bigger. The typical case.',
  likelyBound:
    '8 times out of 10, the move stays smaller than this. Bigger moves happen, but not often.',
  extremeBound:
    '9 times out of 10, the move stays smaller than this. Anything past it is a rare, sharp move.',
  measured:
    'How often this actually came true when we checked it against real history. If we say 80% and it happened 80% of the time, the number is honest.',
  marketState:
    'What kind of market this is right now: moving one way, drifting sideways, or unusually quiet.',
  quiet:
    'The price has been unusually still compared with its own past. Quiet periods often end in a big move — but nothing here says which way.',
  trending:
    'The price has been moving persistently in one direction rather than drifting.',
  bouncing:
    'The price has been drifting sideways, wandering up and down without going anywhere.',
  stateAge:
    'How long the market has been in this state without changing. Longer is more unusual.',
  keyLevels:
    'Prices where the market has repeatedly turned around before. They are drawn from past highs and lows, not from a prediction.',
  multipleSignals:
    'This level was found by more than one method at once. That makes it a clearer line on the chart — it does NOT make it more likely to hold.',
  bigOrders:
    'The buy and sell orders already sitting on the exchange, waiting. A lot of orders at one price can slow the price down when it arrives there.',
  comparedToPast:
    'Compared with this same coin over the last 90 days. "Low" means low for this coin, not low in dollars.',
  distanceBand:
    'How far from the current price these waiting orders sit, as a percentage.',
  notPublished:
    'We tried to work this number out, tested it, and it failed. Showing a number we cannot stand behind would be worse than showing none.',
  calibrationError:
    'How far the promises drift from reality. When we say 70%, does it happen 70% of the time? Lower is better.',
  accuracyScore:
    'Whether the numbers actually tell you anything, or just repeat the long-run average. A forecast can be honest and still be useless.',
  doTheyMatch:
    'Each row compares what we promised against what actually happened. If the two columns match, the number can be trusted.',
  sampleSize:
    'How many real cases this number is based on. Fewer cases means a shakier number, and below 200 we refuse to show one at all.',
} as const;
