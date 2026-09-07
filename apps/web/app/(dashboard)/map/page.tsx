'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapView } from '@/components/features/map/map-view';
import { fetchApi } from '@/lib/api/client';
import type { MarketMap } from '@/types/map';

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

function MapContent() {
  const params = useSearchParams();
  const [coin, setCoin] = useState(params.get('coin')?.toUpperCase() ?? 'BTC');
  const [map, setMap] = useState<MarketMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!SYMBOL_PATTERN.test(coin)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchApi<MarketMap>(`/api/map/${coin}`)
      .then((got) => {
        if (!cancelled) setMap(got);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coin]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <input
          value={coin}
          onChange={(e) => setCoin(e.target.value.toUpperCase())}
          placeholder="BTC"
          aria-label="Coin"
          className="w-32 rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-sm text-neutral-100"
        />
      </div>

      {loading ? <p className="text-sm text-neutral-500">Reading the market…</p> : null}
      {error ? <p className="text-sm text-amber-600">{error}</p> : null}
      {map && !loading ? <MapView map={map} /> : null}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-neutral-500">Loading…</p>}>
      <MapContent />
    </Suspense>
  );
}
