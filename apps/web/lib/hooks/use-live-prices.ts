'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live price for every coin on the page, over ONE socket.
 *
 * Binance combined streams take many symbols on a single connection, so
 * subscribing per visible card would add an IntersectionObserver and
 * subscribe/unsubscribe churn to optimise a resource that costs the same
 * whether one card is on screen or fifty.
 *
 * ponytail: flushed on an interval rather than per message. Ten coins at
 * ~1 message/sec each would otherwise re-render the whole list ten times a
 * second for prices that move in the fourth decimal.
 */
const FLUSH_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useLivePrices(symbols: string[]): {
  prices: Record<string, number>;
  connected: boolean;
} {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const pending = useRef<Record<string, number>>({});
  const attempts = useRef(0);

  // Sorted and joined so a re-ordered array does not tear down the socket.
  const key = Array.from(new Set(symbols)).sort().join(',');

  useEffect(() => {
    if (!key) return;
    const coins = key.split(',');

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      const streams = coins.map((c) => `${c.toLowerCase()}usdt@miniTicker`).join('/');
      socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

      socket.onopen = () => {
        attempts.current = 0;
        setConnected(true);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        const { data } = JSON.parse(event.data) as {
          data?: { s?: string; c?: string };
        };
        // `s` is the pair (BTCUSDT); the card keys on the coin.
        if (!data?.s || !data.c) return;
        pending.current[data.s.replace(/USDT$/, '')] = Number(data.c);
      };

      socket.onerror = () => socket?.close();

      socket.onclose = () => {
        setConnected(false);
        if (unmounted) return;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts.current);
        attempts.current += 1;
        retry = setTimeout(connect, delay);
      };
    };

    connect();
    const flush = setInterval(() => {
      if (Object.keys(pending.current).length === 0) return;
      setPrices((current) => ({ ...current, ...pending.current }));
      pending.current = {};
    }, FLUSH_MS);

    return () => {
      unmounted = true;
      clearInterval(flush);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [key]);

  return { prices, connected };
}
