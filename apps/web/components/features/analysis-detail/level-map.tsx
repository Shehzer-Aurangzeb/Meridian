'use client';

import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import type { LevelMap } from '@/types/analyses';

/**
 * The zones, and where they came from.
 *
 * `sources` is the whole point of a confluence zone — a lone level is not a
 * zone — so it is shown in full rather than counted.
 */
export function LevelMapCard({ map, currentPrice }: { map: LevelMap; currentPrice: number }) {
  const zones = [...map.zones].sort((a, b) => b.center - a.center);

  return (
    <section className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
      <header className="px-6 py-4 border-b border-border/10 dark:border-border flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink">
            Confluence zones
          </div>
          <h2 className="font-display text-xl font-semibold text-text-primary mt-1">
            {zones.length} zone{zones.length === 1 ? '' : 's'} across{' '}
            {map.perTimeframe.map((t) => t.timeframe).join(' · ')}
          </h2>
        </div>
        <div className="font-mono text-[11px] text-text-tertiary text-right">
          <div>spot at analysis {formatCurrency(map.spot)}</div>
          <div>ATR({map.atrTimeframe}) {formatCurrency(map.atr)}</div>
        </div>
      </header>

      <ul>
        {zones.map((zone) => {
          const above = zone.center > currentPrice;
          return (
            <li
              key={zone.center}
              className="px-6 py-3.5 border-b border-border/10 dark:border-border last:border-0"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex items-baseline gap-2.5 min-w-0">
                  <span
                    className={cn(
                      'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                      zone.type === 'support' ? 'bg-sage dark:bg-green' : 'bg-rust'
                    )}
                  />
                  <span className="font-mono text-[13px] text-text-primary">
                    {formatCurrency(zone.low)} – {formatCurrency(zone.high)}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-text-tertiary shrink-0">
                  {above ? '▲' : '▼'} {Math.abs(zone.distancePercent).toFixed(2)}%
                </span>
              </div>
              <div className="text-[12px] text-text-tertiary mt-1 pl-4">
                {zone.sources.join(' + ')}
              </div>
            </li>
          );
        })}
      </ul>

      {map.anchor && (
        <footer className="px-6 py-3.5 border-t border-border/10 dark:border-border font-mono text-[11px] text-text-tertiary">
          Fib anchor ({map.anchor.timeframe}) {formatCurrency(map.anchor.low)} –{' '}
          {formatCurrency(map.anchor.high)}
        </footer>
      )}
    </section>
  );
}
