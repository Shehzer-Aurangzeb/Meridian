'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useCandles } from '@/lib/hooks/use-candles';
import type { LiveCandle } from '@/lib/hooks/use-live-candle';
import type { AnalysisRecord, Direction, TradePlan } from '@/types/analyses';

/**
 * The analysis, drawn.
 *
 * Every line here is a number the pipeline already computed — zone boundaries
 * from the level map, the ladder and stop and targets from the plan. Nothing
 * is derived in this component, so the chart cannot disagree with the cards
 * below it.
 *
 * ponytail: zones are their two boundary lines, not filled bands. A band needs
 * a custom series primitive; two lines carry the same information.
 */

export const INTERVALS = ['15m', '1h', '4h', '12h', '1d', '1w'] as const;
export type Interval = (typeof INTERVALS)[number];

/** Read a theme colour from CSS rather than duplicating the palette here. */
function cssColor(name: string, alpha = 1): string {
  if (typeof window === 'undefined') return '#888';
  const triplet = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return triplet ? `rgb(${triplet} / ${alpha})` : '#888';
}

function leadPlan(plans: TradePlan[]): TradePlan | undefined {
  return (
    plans.find((p) => p.state === 'ACTIONABLE') ??
    plans.find((p) => p.state === 'APPROACHING') ??
    plans[0]
  );
}

/** Enough decimals for the coin: LINK needs two, DOGE needs six. */
function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 8;
}

interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface AnalysisChartProps {
  analysis: AnalysisRecord;
  analysedAt: string;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  /** The candle still forming, or null when the socket is not connected. */
  live: LiveCandle | null;
  isLive: boolean;
}

export function AnalysisChart({
  analysis,
  analysedAt,
  interval,
  onIntervalChange,
  live,
  isLive,
}: AnalysisChartProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [hover, setHover] = useState<OHLC | null>(null);
  const [direction, setDirection] = useState<Direction | null>(
    () => leadPlan(analysis.plans)?.direction ?? null,
  );

  const { data: candles, isLoading, error } = useCandles(analysis.symbol, interval);

  const plan = useMemo(
    () => analysis.plans.find((p) => p.direction === direction),
    [analysis.plans, direction],
  );

  const decimals = decimalsFor(analysis.map.spot);

  // ── the chart, rebuilt on theme change ───────────────────────────────
  // The container is always mounted and never `hidden`: created inside a
  // display:none parent the chart measures zero width, and fitContent against
  // a zero-width scale is what crushed every candle into the right edge.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssColor('--text-tertiary'),
        fontFamily: 'var(--font-inter), sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssColor('--border', 0.28) },
        horzLines: { color: cssColor('--border', 0.28) },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: interval !== '1d' && interval !== '1w',
        rightOffset: 6,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: cssColor('--text-tertiary', 0.5), labelBackgroundColor: cssColor('--primary') },
        horzLine: { color: cssColor('--text-tertiary', 0.5), labelBackgroundColor: cssColor('--primary') },
      },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssColor('--green'),
      downColor: cssColor('--red'),
      borderVisible: false,
      wickUpColor: cssColor('--green', 0.55),
      wickDownColor: cssColor('--red', 0.55),
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
    });

    // The OHLC readout in the header — the thing that makes a chart feel like
    // a chart rather than a picture.
    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(series) as CandlestickData | undefined;
      setHover(point ? { open: point.open, high: point.high, low: point.low, close: point.close } : null);
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [resolvedTheme, interval, decimals]);

  // ── history ──────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();

    // Where the analysis was taken. Without it the levels read as arbitrary
    // rather than as something computed from the candles to its left.
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
  }, [candles, analysedAt, resolvedTheme, interval]);

  // ── the forming candle ───────────────────────────────────────────────
  // `update` only accepts a time at or after the last bar, so a socket message
  // that arrives before the history it belongs to is dropped rather than
  // throwing.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !live || !candles?.length) return;
    if (live.time < candles[candles.length - 1].time) return;
    series.update({ ...live, time: live.time as UTCTimestamp });
  }, [live, candles]);

  // ── the analysis, as price lines ─────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    const lines = [
      ...analysis.map.zones.flatMap((zone) => {
        const color = cssColor(zone.type === 'support' ? '--green' : '--red', 0.3);
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
  }, [analysis.map.zones, plan, candles, resolvedTheme, interval]);

  const readout = hover ?? (live ? { open: live.open, high: live.high, low: live.low, close: live.close } : null);

  return (
    <section className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 border-b border-border/10 dark:border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-display text-[15px] font-semibold tracking-[0.06em] uppercase text-text-primary">
            {analysis.symbol}
          </span>

          {readout && (
            <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-tertiary">
              {(['open', 'high', 'low', 'close'] as const).map((key) => (
                <span key={key}>
                  {key[0].toUpperCase()}
                  <span className="text-text-primary ml-1">
                    {readout[key].toFixed(decimals)}
                  </span>
                </span>
              ))}
            </div>
          )}

          <span
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase',
              isLive ? 'text-green' : 'text-text-tertiary',
            )}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isLive ? 'bg-green animate-pulse' : 'bg-text-tertiary',
              )}
            />
            {isLive ? 'Live' : 'Delayed'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5 rounded-full border border-border/10 dark:border-border p-0.5">
            {INTERVALS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onIntervalChange(value)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  value === interval
                    ? 'bg-primary text-primary-foreground'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                {value}
              </button>
            ))}
          </div>

          {analysis.plans.length > 1 && (
            <div className="flex gap-0.5 rounded-full border border-border/10 dark:border-border p-0.5">
              {analysis.plans.map((p) => (
                <button
                  key={p.direction}
                  type="button"
                  onClick={() => setDirection(p.direction)}
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors',
                    p.direction === direction
                      ? 'bg-primary text-primary-foreground'
                      : 'text-text-secondary hover:bg-surface-hover',
                  )}
                >
                  {p.direction}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="relative h-[460px]">
        <div ref={containerRef} className="absolute inset-0" />

        {(isLoading || error) && (
          <div className="absolute inset-0 grid place-items-center bg-surface px-6 text-center">
            {isLoading ? (
              <p className="text-text-tertiary text-sm">Loading candles…</p>
            ) : (
              <div>
                <p className="text-text-secondary text-sm">Could not load candles</p>
                <p className="text-text-tertiary text-[13px] mt-1">
                  Every level below is unaffected — the chart is a view of them,
                  not their source.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="px-4 py-2.5 border-t border-border/10 dark:border-border text-[11px] text-text-tertiary">
        Scroll to zoom, drag to pan. Dotted lines are confluence zones; gold is
        the entry ladder, solid red the stop, green the targets.
      </p>
    </section>
  );
}
