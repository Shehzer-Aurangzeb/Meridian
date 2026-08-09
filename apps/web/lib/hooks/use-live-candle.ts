'use client';

import { useEffect, useRef, useState } from 'react';

export interface LiveCandle {
  /** Seconds — the open time of the candle still forming. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * The candle currently forming, straight from Binance's WebSocket.
 *
 * Browser-side, unlike /api/candles: a socket cannot be proxied through a Next
 * route handler without holding a server connection open per viewer, which is
 * a lot of machinery for a price tick. The cost is that this is the one piece
 * of Meridian a blocked region loses — so every consumer must treat `connected`
 * as false being normal, and fall back to the price the API returned.
 *
 * `close` is the live price: Binance updates the forming candle on every trade.
 */
export function useLiveCandle(symbol: string | undefined, interval: string) {
  const [candle, setCandle] = useState<LiveCandle | null>(null);
  const [connected, setConnected] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (!symbol) return;

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      const pair = `${symbol.toLowerCase()}usdt`;
      socket = new WebSocket(
        `wss://stream.binance.com:9443/ws/${pair}@kline_${interval}`,
      );

      socket.onopen = () => {
        attempts.current = 0;
        setConnected(true);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        const k = (JSON.parse(event.data) as { k?: Record<string, string> }).k;
        if (!k) return;
        setCandle({
          time: Math.floor(Number(k.t) / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
        });
      };

      socket.onerror = () => socket?.close();

      socket.onclose = () => {
        setConnected(false);
        if (unmounted) return;
        // Exponential, capped: a region that blocks Binance outright would
        // otherwise reconnect forever at full speed.
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts.current);
        attempts.current += 1;
        retry = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [symbol, interval]);

  // Reset between symbols so a stale price never shows under a new coin.
  useEffect(() => {
    setCandle(null);
  }, [symbol, interval]);

  return { candle, price: candle?.close ?? null, connected };
}
