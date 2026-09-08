'use client';

import { useEffect, useRef, useState } from 'react';
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
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useCandles } from '@/lib/hooks/use-candles';
import { useLiveCandle } from '@/lib/hooks/use-live-candle';
import type { MarketMap } from '@/types/map';

export const INTERVALS = ['15m', '1h', '4h', '12h', '1d', '1w'] as const;
export type Interval = (typeof INTERVALS)[number];

const BAR_SECONDS: Record<Interval, number> = {
  '15m': 900,
  '1h': 3600,
  '4h': 14_400,
  '12h': 43_200,
  '1d': 86_400,
  '1w': 604_800,
};

const CANDLE_LIMIT = 500;
/**
 * Bars shown BEFORE the anchor. A chart centred on today does not contain a
 * decision from six weeks ago at all.
 */
const LEAD_BARS = 150;

/** A price to draw across the chart. Phase 5 passes entry, stop and targets. */
export interface ChartLevel {
  price: number;
  label: string;
  tone: 'entry' | 'stop' | 'target';
}

/** Read a theme colour from CSS rather than duplicating the palette here. */
function cssColor(name: string, alpha = 1): string {
  if (typeof window === 'undefined') return '#888';
  const triplet = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return triplet ? `rgb(${triplet} / ${alpha})` : '#888';
}

/** Enough decimals for the coin: LINK needs two, DOGE needs six. */
function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 8;
}

const TONE: Record<ChartLevel['tone'], { colour: string; width: 1 | 2 }> = {
  entry: { colour: '--gold-ink', width: 1 },
  stop: { colour: '--red', width: 2 },
  target: { colour: '--green', width: 1 },
};

interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceChartProps {
  symbol: string;
  /** Where price was when the levels below were worked out. */
  spot: number;
  zones: MarketMap['zones'];
  /** Anchors the window and drops a marker. Defaults to now. */
  anchorAt?: string;
  levels?: ChartLevel[];
}

export function PriceChart({ symbol, spot, zones, anchorAt, levels }: PriceChartProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const fittedRef = useRef<string | null>(null);
  // Cleared before the chart is disposed, so effects that tear down objects
  // belonging to it skip the call rather than throwing "Object is disposed".
  const aliveRef = useRef(false);

  const [interval, setInterval] = useState<Interval>('1h');
  const [hover, setHover] = useState<OHLC | null>(null);

  const barSeconds = BAR_SECONDS[interval];
  // Only a historical reading gets an anchored window. A live chart asks for
  // the most recent bars instead: anchoring it on `Date.now()` put a value
  // that changes every second into the query key, so React Query saw a new
  // query on every render and refetched roughly once a second — and the
  // window it asked for ended at now, which capped the chart at LEAD_BARS.
  const windowStart = anchorAt
    ? (Math.floor(new Date(anchorAt).getTime() / 1000) - LEAD_BARS * barSeconds) * 1000
    : undefined;

  const { data: candles, isLoading, error } = useCandles(
    symbol,
    interval,
    CANDLE_LIMIT,
    windowStart,
  );
  const { candle: live, connected } = useLiveCandle(symbol, interval);

  /**
   * Does the chart reach up to now? For an older anchor it ends weeks ago, so
   * everything live is switched off — today's price over a chart of June would
   * simply be wrong.
   */
  const reachesNow =
    !!candles?.length &&
    Date.now() / 1000 - candles[candles.length - 1].time < 2 * barSeconds;

  const decimals = decimalsFor(spot);

  // The container is always mounted and never `hidden`: created inside a
  // display:none parent the chart measures zero width, and fitContent against a
  // zero-width scale crushes every candle into the right edge.
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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderVisible: false,
        timeVisible: interval !== '1d' && interval !== '1w',
        rightOffset: 6,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: cssColor('--text-tertiary', 0.5),
          labelBackgroundColor: cssColor('--gold'),
        },
        horzLine: {
          color: cssColor('--text-tertiary', 0.5),
          labelBackgroundColor: cssColor('--gold'),
        },
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

    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(series) as CandlestickData | undefined;
      setHover(
        point
          ? { open: point.open, high: point.high, low: point.low, close: point.close }
          : null,
      );
    });

    chartRef.current = chart;
    seriesRef.current = series;
    // One markers plugin for the life of the chart. Calling createSeriesMarkers
    // again attaches a second plugin rather than replacing the first, so the
    // old call site stacked one up per candle refetch.
    markersRef.current = createSeriesMarkers(series, []);
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
      markersRef.current?.detach();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [resolvedTheme]);

  // Applied rather than rebuilt: interval and precision are options, and
  // tearing the chart down for them threw away the fetched series and the
  // reader's zoom on every click of the interval buttons.
  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { timeVisible: interval !== '1d' && interval !== '1w' },
    });
  }, [interval, resolvedTheme]);

  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
    });
  }, [decimals, resolvedTheme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));

    // Fit once per symbol and interval, never on a background refetch. React
    // Query refetches on focus, and fitting there yanked the view back to the
    // full range every time you tabbed away and returned, mid-zoom.
    const key = `${symbol}:${interval}`;
    if (fittedRef.current !== key) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = key;
    }

    // The marker goes on the bar whose period CONTAINS the anchor, never the
    // nearest one: "nearest" has no limit, so an anchor off the chart snaps to
    // the edge and lands on an unrelated bar. Off the chart means no marker.
    if (!anchorAt) {
      markersRef.current?.setMarkers([]);
      return;
    }
    const at = Math.floor(new Date(anchorAt).getTime() / 1000);
    const onBar = candles.find((c) => at >= c.time && at < c.time + barSeconds);
    markersRef.current?.setMarkers(
      onBar
        ? [
            {
              time: onBar.time as UTCTimestamp,
              position: 'aboveBar',
              color: cssColor('--gold-ink'),
              shape: 'arrowDown',
              text: 'decided',
            },
          ]
        : [],
    );
  }, [candles, anchorAt, resolvedTheme, interval, symbol, barSeconds]);

  // `update` only accepts a time at or after the last bar, so a socket message
  // arriving before the history it belongs to is dropped rather than throwing.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !live || !reachesNow || !candles?.length) return;
    if (live.time < candles[candles.length - 1].time) return;
    series.update({ ...live, time: live.time as UTCTimestamp });
  }, [live, candles, reachesNow]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;

    const drawn = [
      series.createPriceLine({
        price: spot,
        color: cssColor('--text-tertiary'),
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: 'price when read',
      }),
      ...zones.flatMap((zone) => {
        const colour = cssColor(zone.type === 'support' ? '--green' : '--red', 0.3);
        return [zone.low, zone.high].map((price) =>
          series.createPriceLine({
            price,
            color: colour,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: '',
          }),
        );
      }),
      ...(levels ?? []).map((level) =>
        series.createPriceLine({
          price: level.price,
          color: cssColor(TONE[level.tone].colour),
          lineWidth: TONE[level.tone].width,
          lineStyle: level.tone === 'stop' ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: level.label,
        }),
      ),
    ];
    // Skipped once the chart is gone: React runs this cleanup AFTER the chart
    // effect's, so on a theme change the series it names is already disposed
    // and every call threw. The lines die with the chart anyway.
    return () => {
      if (aliveRef.current) drawn.forEach((line) => series.removePriceLine(line));
    };
  }, [spot, zones, levels, candles, resolvedTheme, interval]);

  const liveBar = reachesNow ? live : null;
  const readout = hover ?? liveBar;

  return (
    <section className="overflow-hidden rounded border border-border/40 bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-antonio text-[15px] font-semibold uppercase tracking-headline text-text-primary">
            {symbol}
          </span>

          {readout ? (
            <div className="flex flex-wrap items-center gap-x-2.5 font-mono text-[11px] text-text-tertiary">
              {(['open', 'high', 'low', 'close'] as const).map((key) => (
                <span key={key}>
                  {key[0].toUpperCase()}
                  <span className="ml-1 text-text-primary">{readout[key].toFixed(decimals)}</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* The socket can be connected while this chart is a window into
              June. "Live" would then name the connection, not what you are
              looking at, so an old anchor says Historical instead. */}
          <span
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
              connected && reachesNow ? 'text-green' : 'text-text-tertiary',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connected && reachesNow ? 'animate-pulse bg-green' : 'bg-text-tertiary',
              )}
            />
            {!reachesNow ? 'Historical' : connected ? 'Live' : 'Delayed'}
          </span>
        </div>

        <div className="flex gap-0.5 rounded-sm border border-border/60 p-0.5">
          {INTERVALS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              aria-current={value === interval ? 'true' : undefined}
              className={cn(
                'rounded-sm px-2.5 py-1 font-mono text-[11px] transition-colors',
                value === interval
                  ? 'bg-gold text-gold-contrast'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </header>

      <div className="relative h-[420px]">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading || error ? (
          <div className="absolute inset-0 grid place-items-center bg-surface px-6 text-center">
            {isLoading ? (
              <p className="text-[14px] text-text-tertiary">Loading the chart…</p>
            ) : (
              <div>
                <p className="text-[14px] text-text-secondary">Could not load the chart.</p>
                <p className="mt-1 text-[13px] text-text-tertiary">
                  Everything below is unaffected — the chart is a view of those numbers,
                  not their source.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <p className="border-t border-border/40 px-4 py-2.5 text-[11px] text-text-tertiary">
        Scroll to zoom, drag to pan. Dotted lines are the price levels listed below.
        {levels?.length ? ' Gold is the entry, solid red the stop, green the targets.' : ''}
      </p>
    </section>
  );
}
