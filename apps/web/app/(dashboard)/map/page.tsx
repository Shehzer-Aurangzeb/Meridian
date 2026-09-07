'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapView } from '@/components/features/map/map-view';
import { fetchApi } from '@/lib/api/client';
import type { MarketMap } from '@/types/map';

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;
/** The ten the model was fitted on. Anything else is not calibrated for. */
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC'];

function MapContent() {
  const params = useSearchParams();
  const initial = params.get('coin')?.toUpperCase();
  const [coin, setCoin] = useState(initial && SYMBOL_PATTERN.test(initial) ? initial : 'BTC');
  const [map, setMap] = useState<MarketMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    <div className="mx-auto max-w-5xl px-8 py-10">
      {/* A fixed list, not a free-text box: the model was fitted on these ten
          coins and is not calibrated for anything else, so offering a text
          field would invite a question the product cannot answer honestly. */}
      <div className="mb-8 flex flex-wrap gap-2">
        {COINS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCoin(c)}
            aria-current={c === coin ? 'true' : undefined}
            className={
              c === coin
                ? 'rounded-sm bg-gold px-3 py-1.5 font-mono text-[13px] text-gold-ink'
                : 'rounded-sm border border-border/60 px-3 py-1.5 font-mono text-[13px] text-text-secondary hover:border-gold/60 hover:text-text-primary'
            }
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[14px] text-text-tertiary">Reading the market…</p>
      ) : null}

      {error ? (
        <div className="rounded border border-amber/40 bg-surface p-6">
          <p className="text-[14px] text-text-primary">This page could not load its data.</p>
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">{error}</p>
        </div>
      ) : null}

      {map && !loading && !error ? <MapView map={map} /> : null}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={<p className="px-8 py-10 text-[14px] text-text-tertiary">Loading…</p>}
    >
      <MapContent />
    </Suspense>
  );
}
