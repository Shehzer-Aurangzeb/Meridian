import { Explain, EXPLAIN } from '@/components/ui/explain';
import type { ConeBand } from '@/types/map';

/** A move as a percentage, which is what a person reads. Never basis points. */
const asPercent = (x: number): string => `${(x * 100).toFixed(2)}%`;
const asMoney = (x: number): string =>
  x.toLocaleString('en-US', { maximumFractionDigits: x > 100 ? 0 : 2 });

/**
 * How big a move to expect, over one time window.
 *
 * ─── The symmetry is the message ─────────────────────────────────────────
 * The bands are the size of the move, so they extend equally above and below
 * today's price. Shading one side more heavily, or drawing the bar off-centre,
 * would state a direction — the exact claim twenty pre-registered tests could
 * not support.
 *
 * ─── Why each band shows what actually happened ──────────────────────────
 * "8 times out of 10" is a promise. The measured figure beside it is whether
 * the promise was kept over a 182-day stretch the model never saw. A product
 * that makes the first claim without showing the second is asking to be
 * trusted rather than earning it.
 */
export function ExpectedMoveCone({
  spot,
  hours,
  band,
}: {
  spot: number;
  hours: string;
  band: ConeBand;
}) {
  const rows = [
    {
      label: 'Most likely',
      plain: 'half the time it stays inside',
      width: band.p50,
      covered: band.coverage.p50,
      explain: EXPLAIN.mostLikely,
    },
    {
      label: 'Likely limit',
      plain: '8 times out of 10 it stays inside',
      width: band.p80,
      covered: band.coverage.p80,
      explain: EXPLAIN.likelyBound,
    },
    {
      label: 'Extreme',
      plain: '9 times out of 10 it stays inside',
      width: band.p90,
      covered: band.coverage.p90,
      explain: EXPLAIN.extremeBound,
    },
  ];

  return (
    <div className="rounded border border-border/40 bg-surface p-6">
      <h3 className="font-antonio text-[18px] font-semibold uppercase tracking-headline text-text-primary">
        Next {hours} hours
      </h3>

      <div className="mt-5 space-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Explain term={r.explain} className="text-[13px] text-text-secondary">
                {r.label}
              </Explain>
              <span className="font-mono text-[15px] text-text-primary">
                ±{asPercent(r.width)}
              </span>
            </div>

            <p className="mt-0.5 text-[12px] text-text-tertiary">{r.plain}</p>

            {/* Centred and symmetric by construction. A one-sided bar is a call. */}
            <div className="mt-2 flex items-center">
              <div
                className="h-1.5 rounded-l-sm bg-gold/30"
                style={{ width: `${Math.min(50, (r.width / band.p90) * 50)}%` }}
              />
              <div className="h-3.5 w-px bg-text-tertiary" aria-hidden />
              <div
                className="h-1.5 rounded-r-sm bg-gold/30"
                style={{ width: `${Math.min(50, (r.width / band.p90) * 50)}%` }}
              />
            </div>

            <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] text-text-tertiary">
              <span>{asMoney(spot * (1 - r.width))}</span>
              <Explain term={EXPLAIN.measured} className="font-sans text-[11px]" align="right">
                was right {(r.covered * 100).toFixed(0)}% of the time
              </Explain>
              <span>{asMoney(spot * (1 + r.width))}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
