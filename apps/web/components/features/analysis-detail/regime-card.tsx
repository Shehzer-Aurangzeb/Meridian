'use client';

import { cn } from '@/lib/utils';
import { formatEnumLabel } from '@/lib/format';
import type { AnalysisRecord } from '@/types/analyses';

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-border/10 dark:border-border last:border-0">
      <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
        {label}
      </div>
      <div className="font-display text-2xl font-semibold text-text-primary mt-1.5 leading-none">
        {value}
      </div>
      {sub && <div className="font-mono text-[11px] text-text-tertiary mt-1.5">{sub}</div>}
    </div>
  );
}

export function RegimeCard({ analysis }: { analysis: AnalysisRecord }) {
  const { regime, checklists, squeeze, timeframes } = analysis;
  const m = regime.metrics;

  return (
    <section className="flex flex-col gap-4">
      <div className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
        <header className="px-6 py-4 border-b border-border/10 dark:border-border">
          <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink">
            Regime · {timeframes.regime}
          </div>
          <h2 className="font-display text-xl font-semibold text-text-primary mt-1">
            {formatEnumLabel(regime.regime)}
          </h2>
          <p className="text-[13px] text-text-secondary mt-1.5">{regime.reason}</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4">
          <Metric label="ADX" value={m.adx.toFixed(1)} sub={`+DI ${m.pdi.toFixed(1)} / −DI ${m.mdi.toFixed(1)}`} />
          <Metric label="RSI" value={m.rsi.toFixed(1)} />
          <Metric
            label="Band width"
            value={m.bandWidth.toFixed(2)}
            sub={`cutoff ${m.bandWidthThreshold.toFixed(2)}`}
          />
          <Metric
            label="Percentile"
            value={m.bandWidthPercentile === null ? '—' : `${m.bandWidthPercentile.toFixed(0)}%`}
            // The verdict used to move with the candle limit, so the window it
            // was measured over is always stated.
            sub={`${m.bandWidthSamples} of ${m.bandWidthLookback} samples`}
          />
        </div>
      </div>

      <div className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
        <header className="px-6 py-4 border-b border-border/10 dark:border-border flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink">
              Strategy route
            </div>
            <h2 className="font-display text-xl font-semibold text-text-primary mt-1">
              {formatEnumLabel(analysis.route)}
            </h2>
          </div>
          {checklists && (
            <div className="flex gap-4 shrink-0">
              {(['long', 'short'] as const).map((side) =>
                checklists[side] ? (
                  <span key={side} className="text-right">
                    <span className="block text-[11px] uppercase tracking-wide text-text-tertiary">
                      {side}
                    </span>
                    <span
                      className={cn(
                        'font-display text-2xl font-semibold',
                        checklists[side]!.passed
                          ? 'text-sage dark:text-green'
                          : 'text-text-tertiary'
                      )}
                    >
                      {checklists[side]!.conditionsMet}
                      <span className="text-base text-text-secondary">/5</span>
                    </span>
                  </span>
                ) : null
              )}
            </div>
          )}
        </header>

        {(['long', 'short'] as const).map((side) =>
          checklists?.[side] ? (
          <ul key={side} className="px-6 py-2">
            <li className="pt-2 pb-1 text-[11px] uppercase tracking-wide text-text-tertiary">
              {side} conditions
            </li>
            {checklists[side]!.conditions.map((condition) => (
              <li
                key={condition.name}
                className="flex items-start gap-3 py-2.5 border-b border-border/10 dark:border-border last:border-0"
              >
                <span
                  className={cn(
                    'mt-0.5 w-4 h-4 rounded-full shrink-0 grid place-items-center text-[10px] font-bold',
                    condition.passed
                      ? 'bg-sage/25 text-deep-green dark:bg-green/25 dark:text-green'
                      : 'bg-primary/[0.08] text-text-tertiary'
                  )}
                >
                  {condition.passed ? '✓' : '·'}
                </span>
                <span className="min-w-0">
                  <span className="text-[13px] text-text-primary">{condition.name}</span>
                  <span className="block text-[12px] text-text-tertiary mt-0.5">
                    {condition.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          ) : null
        )}

        {squeeze && (
          <dl className="px-6 py-4 grid grid-cols-2 gap-y-3 text-[13px]">
            <dt className="text-text-secondary">Long above</dt>
            <dd className="font-mono text-right text-sage dark:text-green">
              {squeeze.upperTriggerPrice.toLocaleString('en-US')}
            </dd>
            <dt className="text-text-secondary">Short below</dt>
            <dd className="font-mono text-right text-rust">
              {squeeze.lowerTriggerPrice.toLocaleString('en-US')}
            </dd>
            <dt className="text-text-secondary">Volume needed</dt>
            <dd className="font-mono text-right text-text-primary">
              {squeeze.volumeMultiplier}× baseline
            </dd>
            <dd className="col-span-2 text-[12px] text-text-tertiary pt-2 border-t border-border/10 dark:border-border">
              {squeeze.entryConditions}
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}
