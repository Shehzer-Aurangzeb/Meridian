import type { ConeBand } from '@/types/map';

const bp = (x: number): string => `${(x * 1e4).toFixed(0)} bp`;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * The expected-move cone: how far, never which way.
 *
 * ─── Why this is drawn symmetrically, and must stay that way ─────────────
 * The bands are |move|, so they extend equally above and below the current
 * price. That symmetry is the whole message. An asymmetric cone — or one
 * shaded more strongly on one side — would state a direction, which is exactly
 * the claim twenty pre-registered tests could not support.
 *
 * Every band carries its measured coverage next to it, because "80%" is a
 * promise and the reader is owed the number that says whether it was kept.
 */
export function ExpectedMoveCone({
  spot,
  horizon,
  band,
}: {
  spot: number;
  horizon: string;
  band: ConeBand;
}) {
  const rows = [
    { label: '50%', width: band.p50, covered: band.coverage.p50 },
    { label: '80%', width: band.p80, covered: band.coverage.p80 },
    { label: '90%', width: band.p90, covered: band.coverage.p90 },
  ];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Next {horizon} hours</h3>
        <span className="text-xs text-neutral-500">size, not direction</span>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-neutral-400">
                {r.label} of the time, within{' '}
                <span className="font-mono text-neutral-200">±{bp(r.width)}</span>
              </span>
              <span className="text-neutral-600">
                measured {pct(r.covered)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              {/* Symmetric by construction. A one-sided bar would be a call. */}
              <div
                className="h-1.5 rounded-l bg-sky-900/70"
                style={{ width: `${Math.min(50, (r.width / band.p90) * 50)}%` }}
              />
              <div className="h-3 w-px bg-neutral-500" title="current price" />
              <div
                className="h-1.5 rounded-r bg-sky-900/70"
                style={{ width: `${Math.min(50, (r.width / band.p90) * 50)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-600">
              <span>{(spot * (1 - r.width)).toFixed(2)}</span>
              <span>{(spot * (1 + r.width)).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
