'use client';

import { useEffect, useState } from 'react';
import { Explain, EXPLAIN } from '@/components/ui/explain';
import { fetchApi } from '@/lib/api/client';
import type { CalibrationReport } from '@/types/map';

/**
 * The page that makes the rest of the product worth believing.
 *
 * ─── Why the failures are shown as loudly as the pass ────────────────────
 * Three of the four numbers this system set out to produce failed their tests
 * and are served as blanks. A reader who saw only the one that worked would
 * have been told a flattering half of the story.
 *
 * Every technical term here is translated. "ECE 5.06 against a bar of 5.00" is
 * precise and unreadable; "we were off by 5.1 points where we allowed 5" is the
 * same fact in words the person paying for this can check.
 */
export default function CalibrationPage() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<CalibrationReport>('/api/calibration')
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded border border-amber/40 bg-surface p-6">
          <p className="text-[14px] text-text-primary">This page could not load its data.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{error}</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return <p className="text-[14px] text-text-tertiary">Loading…</p>;
  }

  const published = report.entries.filter((e) => e.status === 'PUBLISHED');

  return (
    <div className="mx-auto max-w-3xl">
      <header className="border-b border-border/40 pb-6">
        <h1 className="font-antonio text-display-sm font-semibold uppercase tracking-headline text-text-primary">
          How accurate is this?
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Every number this product shows was tested against real history before it was
          shown to you. {published.length} of {report.entries.length} passed. The rest are
          listed here too, with what went wrong — a number we cannot stand behind is not
          shown anywhere in the product.
        </p>
      </header>

      <div className="mt-8 space-y-5">
        {report.entries.map((e) => (
          <section key={e.output} className="rounded border border-border/40 bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-antonio text-[20px] font-semibold uppercase tracking-headline text-text-primary">
                {FRIENDLY[e.output]?.title ?? e.output}
              </h2>
              <span
                className={
                  e.status === 'PUBLISHED'
                    ? 'font-mono text-[12px] text-green'
                    : 'font-mono text-[12px] text-amber'
                }
              >
                {e.status === 'PUBLISHED' ? 'we show this' : 'we do not show this'}
              </span>
            </div>

            <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
              {FRIENDLY[e.output]?.what ?? 'One of the numbers this product measured.'}
            </p>

            <dl className="mt-5 space-y-3 text-[13px]">
              <div>
                <dt className="text-text-tertiary">
                  What it had to achieve, decided before we looked
                </dt>
                <dd className="mt-0.5 leading-relaxed text-text-primary">{e.bar}</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">What actually happened</dt>
                <dd className="mt-0.5 leading-relaxed text-text-primary">{e.measured}</dd>
              </div>
            </dl>

            {e.curve ? (
              <div className="mt-5">
                <p className="mb-2 text-[12px] text-text-tertiary">
                  <Explain term={EXPLAIN.doTheyMatch}>
                    Did the promises match reality?
                  </Explain>
                </p>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-text-tertiary">
                      <th className="pb-1.5 font-normal">We said</th>
                      <th className="pb-1.5 text-right font-normal">It happened</th>
                      <th className="pb-1.5 text-right font-normal">Off by</th>
                      <th className="pb-1.5 text-right font-normal">
                        <Explain term={EXPLAIN.sampleSize} align="right">
                          Cases
                        </Explain>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-text-primary">
                    {e.curve.map((c) => (
                      <tr key={c.predicted} className="border-t border-border/40">
                        <td className="py-1.5 font-mono">{(c.predicted * 100).toFixed(0)}%</td>
                        <td className="py-1.5 text-right font-mono">
                          {(c.realised * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right font-mono text-text-secondary">
                          {Math.abs((c.realised - c.predicted) * 100).toFixed(1)} points
                        </td>
                        <td className="py-1.5 text-right font-mono text-text-tertiary">
                          {c.n.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="mt-5 border-t border-border/40 pt-4 text-[13px] leading-relaxed text-text-secondary">
              {e.note}
            </p>
            <p className="mt-2 font-mono text-[11px] text-text-tertiary">
              last checked {e.fittedAt}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-text-tertiary">
        These figures come from a stretch of history the models were never trained on, so
        they are a fair test rather than a rehearsal. They are checked again on a
        schedule, because a number that was accurate in 2023 need not still be accurate
        now.
      </p>
    </div>
  );
}

/**
 * Plain-English names for the four outputs.
 *
 * The API calls them `expected-move-cone` and `regime-exit-24h`. Those are good
 * keys and terrible headings, and translating them here keeps the backend
 * honest about what it measured while the page stays readable.
 */
const FRIENDLY: Record<string, { title: string; what: string }> = {
  'expected-move-cone': {
    title: 'How big a move to expect',
    what:
      'When we say the price will probably stay within a certain range, does it? This is the one number the product publishes.',
  },
  'zone-bounce-4h': {
    title: 'Whether a price level holds',
    what:
      'We wanted to tell you how often the price turns around at a given level. We could work out an honest number, but it was the same number every time — so it told you nothing.',
  },
  'regime-exit-24h': {
    title: 'When the market state changes',
    what:
      'We wanted to tell you the chance that today’s market state ends within a day. It was close, and it missed: the market behaved differently in the test period than in the years we learned from.',
  },
  'unwind-lift-24h': {
    title: 'Whether crowded trades snap back',
    what:
      'We wanted to warn you when a lot of traders are betting the same way. On this data, crowded periods were no more likely to end in a sharp drop than ordinary ones.',
  },
};
