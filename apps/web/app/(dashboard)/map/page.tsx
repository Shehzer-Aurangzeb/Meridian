'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MapView } from '@/components/features/map/map-view';
import { PriceChart } from '@/components/features/map/price-chart';
import { CopyButton } from '@/components/features/log/copy-button';
import { promptFor } from '@/lib/sim-prompt';
import { fetchApi } from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { MarketMap } from '@/types/map';

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;
/** The ten the model was fitted on. Anything else is not calibrated for. */
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC'];

function MapContent() {
  const params = useSearchParams();
  const initial = params.get('coin')?.toUpperCase();
  const [coin, setCoin] = useState(initial && SYMBOL_PATTERN.test(initial) ? initial : 'BTC');

  // The same key /log reads under, so a coin already priced in a batch is
  // shown from cache and a reading is never fetched twice. `staleTime:
  // Infinity` because a reading is a moment in time — refetching it behind
  // the reader would change the numbers they are about to copy out.
  const universe = COINS.join(',');
  const {
    data: map,
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.map(coin, universe),
    queryFn: () => fetchApi<MarketMap>(`/api/map/${coin}?universe=${universe}`),
    staleTime: Infinity,
  });

  return (
    <div className="mx-auto max-w-5xl">
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
                ? 'rounded-sm bg-gold px-3 py-1.5 font-mono text-[13px] text-gold-contrast'
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
          <p className="mt-1.5 font-mono text-[12px] text-text-tertiary">
            {(error as Error).message}
          </p>
        </div>
      ) : null}

      {map && !loading && !error ? (
        <>
          <PriceChart symbol={map.symbol} spot={map.spot} zones={map.zones} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <CopyButton
              variant="primary"
              label="Copy this reading for the analyst"
              text={() => promptFor(map)}
            />
            <Link
              href="/log"
              className="rounded-sm border border-border/60 px-3 py-1.5 font-mono text-[13px] text-text-secondary hover:border-gold/60 hover:text-text-primary"
            >
              Log a batch of ten
            </Link>
          </div>
          <div className="mt-10">
            <MapView map={map} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={<p className="text-[14px] text-text-tertiary">Loading…</p>}
    >
      <MapContent />
    </Suspense>
  );
}
