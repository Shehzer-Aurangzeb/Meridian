import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * GET /api/candles?symbol=BTC&interval=1h&limit=300
 *
 * Straight to Binance rather than through the Meridian API: candles are public
 * market data, identical for everyone, and routing them through Lambda would
 * add a cold start and a deploy to a request that needs neither.
 *
 * Server-side rather than from the browser so the chart keeps working where
 * Binance blocks the visitor's region, and so it stays same-origin.
 *
 * That cuts both ways: Binance geo-blocks the US with a 451, and Vercel's
 * default function region is iad1 (Washington DC), so this returned 502 from
 * the deployed app while working everywhere else. vercel.json pins the
 * functions to fra1 — which also sits next to the API in eu-central-1, so
 * every other BFF call got faster too.
 */
const BINANCE = 'https://api.binance.com/api/v3/klines';

const SYMBOL = /^[A-Z0-9]{2,15}$/;
const INTERVALS = ['15m', '1h', '4h', '12h', '1d', '1w'] as const;

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

  if (!SYMBOL.test(symbol)) {
    return NextResponse.json({ message: 'Invalid symbol' }, { status: 400 });
  }
  if (!INTERVALS.includes(interval as (typeof INTERVALS)[number])) {
    return NextResponse.json({ message: 'Invalid interval' }, { status: 400 });
  }

  const url = `${BINANCE}?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;

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
