'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useCandles } from '@/lib/hooks/use-candles';
import { Skeleton } from '@/components/ui/skeleton';
import type { AnalysisRecord, Direction, TradePlan } from '@/types/analyses';

/**
 * The analysis, drawn.
 *
 * Every line here is a number the pipeline already computed — zones from the
 * level map, entries/stop/targets from the plan. Nothing is derived in this
 * component, so the chart cannot disagree with the cards below it.
 *
 * ponytail: zones are drawn as their two boundary price lines rather than as
 * filled bands. A band needs a custom series primitive (~150 lines of plugin);
 * two labelled lines carry the same information. Upgrade if reading the chart
 * at a glance turns out to need the fill.
 */

/** Read a theme colour out of CSS rather than duplicating the palette here. */
function cssColor(name: string, alpha = 1): string {
  if (typeof window === 'undefined') return '#888';
  const triplet = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return triplet ? `rgb(${triplet.split(/\s+/).join(' ')} / ${alpha})` : '#888';
}

function leadPlan(plans: TradePlan[]): TradePlan | undefined {
  return (
    plans.find((p) => p.state === 'ACTIONABLE') ??
    plans.find((p) => p.state === 'APPROACHING') ??
    plans[0]
  );
}

interface AnalysisChartProps {
  analysis: AnalysisRecord;
  analysedAt: string;
}

export function AnalysisChart({ analysis, analysedAt }: AnalysisChartProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [direction, setDirection] = useState<Direction | null>(
    () => leadPlan(analysis.plans)?.direction ?? null,
  );

  const { data: candles, isLoading, error } = useCandles(analysis.symbol, '1h', 300);

  const plan = useMemo(
    () => analysis.plans.find((p) => p.direction === direction),
    [analysis.plans, direction],
  );

  // ── the chart itself, rebuilt on theme change ────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssColor('--text-secondary'),
        fontFamily: 'var(--font-inter), sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssColor('--border', 0.35) },
        horzLines: { color: cssColor('--border', 0.35) },
      },
      rightPriceScale: { borderColor: cssColor('--border', 0.5) },
      timeScale: {
        borderColor: cssColor('--border', 0.5),
        timeVisible: true,
      },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssColor('--green'),
      downColor: cssColor('--red'),
      borderVisible: false,
      wickUpColor: cssColor('--green', 0.6),
      wickDownColor: cssColor('--red', 0.6),
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [resolvedTheme]);

  // ── data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    // `time` is a branded UTCTimestamp; the route already emits seconds.
    series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();

    // Where the analysis was taken. Without it the levels look arbitrary —
    // they were computed from the candles to the LEFT of this mark.
    const at = Math.floor(new Date(analysedAt).getTime() / 1000);
    const nearest = candles.reduce((best, c) =>
      Math.abs(c.time - at) < Math.abs(best.time - at) ? c : best,
    );
    createSeriesMarkers(series, [
      {
        time: nearest.time as UTCTimestamp,
        position: 'aboveBar',
        color: cssColor('--gold-ink'),
        shape: 'arrowDown',
        text: 'analysed',
      },
    ]);
  }, [candles, analysedAt, resolvedTheme]);

  // ── the analysis, as price lines ─────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    const lines = [
      ...analysis.map.zones.flatMap((zone) => {
        const color = cssColor(
          zone.type === 'support' ? '--green' : '--red',
          0.28,
        );
        return [zone.low, zone.high].map((price) => ({
          price,
          color,
          lineWidth: 1 as const,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        }));
      }),
      ...(plan
        ? [
            ...plan.entries.map((entry, i) => ({
              price: entry.price,
              color: cssColor('--gold-ink'),
              lineWidth: 1 as const,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `entry ${i + 1} · ${entry.weightPercent}%`,
            })),
            {
              price: plan.stop,
              color: cssColor('--red'),
              lineWidth: 2 as const,
              lineStyle: LineStyle.Solid,
              axisLabelVisible: true,
              title: 'stop',
            },
            ...plan.targets.map((target, i) => ({
              price: target.price,
              color: cssColor('--green'),
              lineWidth: 1 as const,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `TP${i + 1} · ${target.rMultiple.toFixed(2)}R`,
            })),
          ]
        : []),
    ];

    const drawn = lines.map((line) => series.createPriceLine(line));
    return () => drawn.forEach((line) => series.removePriceLine(line));
  }, [analysis.map.zones, plan, candles, resolvedTheme]);

  return (
    <section className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border/10 dark:border-border">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
            {analysis.symbol} · 1h
          </div>
          <p className="text-[13px] text-text-secondary mt-0.5">
            Dotted bands are confluence zones. Solid red is the stop.
          </p>
        </div>

        {analysis.plans.length > 1 && (
          <div className="flex gap-1.5">
            {analysis.plans.map((p) => (
              <button
                key={p.direction}
                type="button"
                onClick={() => setDirection(p.direction)}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[12px] font-medium capitalize transition-colors',
                  'border border-border/10 dark:border-border',
                  p.direction === direction
                    ? 'bg-primary text-primary-foreground border-transparent'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                {p.direction}
              </button>
            ))}
          </div>
        )}
      </header>

      {isLoading && <Skeleton className="h-[420px] rounded-none" />}

      {error && (
        <div className="h-[420px] grid place-items-center px-6 text-center">
          <div>
            <p className="text-text-secondary text-sm">Could not load candles</p>
            <p className="text-text-tertiary text-[13px] mt-1">
              Every level below is unaffected — the chart is a view of them, not
              their source.
            </p>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn('h-[420px]', (isLoading || error) && 'hidden')}
      />
    </section>
  );
}
