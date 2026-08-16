import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Price bars for the chart, fetched straight from the exchange rather than
 * through our own API — this data is public and identical for everyone.
 *
 * Fetched by the server, not the browser, so the chart still works for
 * visitors in countries the exchange blocks. That means the SERVER's location
 * matters: it must not be somewhere the exchange refuses, which is why the
 * hosting region is pinned in vercel.json.
 */
const BINANCE = 'https://api.binance.com/api/v3/klines';

const SYMBOL = /^[A-Z0-9]{2,15}$/;
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '12h', '1d', '1w'] as const;

export interface Candle {
  /** Seconds, which is what lightweight-charts wants. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Reads a cookie, so it can never be prerendered.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Middleware skips /api, and this route is not otherwise gated. Cookie
  // presence is enough — the data is public, the check is only so a deployed
  // Meridian is not a free Binance proxy someone else can burn rate limit on.
  if (!cookies().get(SESSION_COOKIE)) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();
  const interval = params.get('interval') ?? '1h';
  const limit = Math.min(Number(params.get('limit')) || 500, 1000);
  // Anchors the window at a point in time instead of at now. A chart of an
  // analysis from six weeks ago needs the candles around THAT moment; the most
  // recent 500 do not contain it, and a marker snapped into them lands on an
  // unrelated bar.
  const startTime = Number(params.get('startTime'));

  if (!SYMBOL.test(symbol)) {
    return NextResponse.json({ message: 'Invalid symbol' }, { status: 400 });
  }
  if (!INTERVALS.includes(interval as (typeof INTERVALS)[number])) {
    return NextResponse.json({ message: 'Invalid interval' }, { status: 400 });
  }

  const url =
    `${BINANCE}?symbol=${symbol}USDT&interval=${interval}&limit=${limit}` +
    (Number.isFinite(startTime) && startTime > 0 ? `&startTime=${startTime}` : '');

  try {
    // A minute of caching: the newest candle is still forming, so a fresher
    // copy of it is not more correct, and the chart redraws on every open.
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) {
      return NextResponse.json(
        { message: `Binance returned ${response.status}` },
        { status: 502 },
      );
    }

    // [openTime, open, high, low, close, volume, closeTime, ...]
    const raw = (await response.json()) as unknown[][];
    const candles: Candle[] = raw.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }));

    return NextResponse.json({ symbol, interval, candles });
  } catch {
    return NextResponse.json({ message: 'Binance unreachable' }, { status: 502 });
  }
}
