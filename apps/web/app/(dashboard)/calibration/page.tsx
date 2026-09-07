'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api/client';
import type { CalibrationReport } from '@/types/map';

/**
 * The page that makes the rest of the product credible.
 *
 * Every probability on the map links here. Failures are listed with the same
 * prominence as the pass — a reader who sees only a working cone has not been
 * told what this system tried and could not do.
 */
export default function CalibrationPage() {
  const [report, setReport] = useState<CalibrationReport | null>(null);

  useEffect(() => {
    fetchApi<CalibrationReport>('/api/calibration').then(setReport).catch(() => setReport(null));
  }, []);

  if (!report) return <p className="p-8 text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-100">Calibration</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">{report.summary}</p>

      <div className="mt-6 space-y-4">
        {report.entries.map((e) => (
          <section key={e.output} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-mono text-sm text-neutral-200">{e.output}</h2>
              <span
                className={
                  e.status === 'PUBLISHED'
                    ? 'text-xs font-medium text-emerald-600'
                    : 'text-xs font-medium text-amber-600/80'
                }
              >
                {e.status === 'PUBLISHED' ? 'published' : 'withheld'}
              </span>
            </div>

            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-neutral-600">The bar, set before the run</dt>
                <dd className="text-neutral-300">{e.bar}</dd>
              </div>
              <div>
                <dt className="text-neutral-600">What was measured</dt>
                <dd className="text-neutral-300">{e.measured}</dd>
              </div>
            </dl>

            {e.curve ? (
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-600">
                    <th className="pb-1 font-normal">predicted</th>
                    <th className="pb-1 text-right font-normal">realised</th>
                    <th className="pb-1 text-right font-normal">gap</th>
                    <th className="pb-1 text-right font-normal">n</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-neutral-300">
                  {e.curve.map((c) => (
                    <tr key={c.predicted} className="border-t border-neutral-900">
                      <td className="py-1">{(c.predicted * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right">{(c.realised * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right text-neutral-500">
                        {((c.realised - c.predicted) * 100).toFixed(1)} pts
                      </td>
                      <td className="py-1 text-right text-neutral-500">{c.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <p className="mt-3 text-xs leading-relaxed text-neutral-500">{e.note}</p>
            <p className="mt-2 font-mono text-[10px] text-neutral-700">
              fitted {e.fittedAt} · {e.evidence}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
