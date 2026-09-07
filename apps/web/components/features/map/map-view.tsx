'use client';

import type { MarketMap } from '@/types/map';
import { ExpectedMoveCone } from './expected-move-cone';
import { WithheldNote } from './withheld-note';

const REGIME_COPY: Record<MarketMap['regime'] extends null ? never : NonNullable<MarketMap['regime']>['state'], string> = {
  COMPRESSION: 'the recent price range is narrow compared with this coin’s own history',
  TRENDING: 'price has been moving persistently in one direction',
  MEAN_REVERSION: 'price has been drifting sideways',
};

/**
 * The map screen.
 *
 * ─── The design standard this is held to ─────────────────────────────────
 * If a screenshot of this page could be mistaken for a trade idea, it has
 * failed. There are therefore no arrows, no entry markers, no target lines and
 * no colour that codes for up or down — the cone is one colour and symmetric,
 * zones are neutral bands, and depth is grey.
 *
 * Green-for-support and red-for-resistance would be conventional and would
 * quietly encode a direction, so both are the same colour and the label says
 * which is which.
 */
export function MapView({ map }: { map: MarketMap }) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">
            {map.symbol}
            <span className="ml-3 font-mono text-lg text-neutral-400">{map.spot}</span>
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            A description of the market. Not a forecast of direction.
          </p>
        </div>
        <time className="font-mono text-xs text-neutral-600">
          {new Date(map.asOf).toISOString().replace('T', ' ').slice(0, 16)}Z
        </time>
      </header>

      {/* ── how big, never which way ── */}
      {map.expectedMove ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Expected move
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {Object.entries(map.expectedMove.horizons).map(([h, band]) => (
              <ExpectedMoveCone key={h} spot={map.spot} horizon={h} band={band} />
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-600">{map.expectedMove.note}</p>
        </section>
      ) : null}

      {/* ── what state, and for how long ── */}
      {map.regime ? (
        <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Regime
          </h2>
          <p className="text-sm text-neutral-200">
            <span className="font-medium">{map.regime.state.replace('_', ' ').toLowerCase()}</span>
            {' — '}
            {REGIME_COPY[map.regime.state]}.
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            Held for {map.regime.ageHours} hours
            {map.regime.ageTruncated ? ' at least — the data starts there' : ''}.
          </p>
          <p className="mt-2 font-mono text-[10px] text-neutral-600">{map.regime.reason}</p>
          <div className="mt-3">
            <WithheldNote label="Chance it ends within 24h" probability={map.regime.exitWithin24h} />
          </div>
        </section>
      ) : null}

      {/* ── zones: geometry, and nothing implied by it ── */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Price zones
        </h2>
        {map.zones.length === 0 ? (
          <p className="text-sm text-neutral-500">None found on the current charts.</p>
        ) : (
          <div className="space-y-2">
            {map.zones.map((z, i) => (
              <div
                key={`${z.center}-${i}`}
                className="rounded-lg border border-neutral-800 bg-neutral-950 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-sm text-neutral-200">
                    {z.low.toFixed(2)} – {z.high.toFixed(2)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {z.type} · {z.distancePercent.toFixed(2)}% from price
                    {z.shell === null ? ' · beyond depth data' : ` · shell ${z.shell}`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-600">
                  built from {z.sources.join(' + ')}
                </p>
                <div className="mt-2">
                  <WithheldNote label="Chance it holds" probability={z.bounceWithin4h} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── resting depth, relative to this coin ── */}
      {map.liquidity ? (
        <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Resting order-book depth
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-600">
                <th className="pb-1 font-normal">from price</th>
                <th className="pb-1 text-right font-normal">bids</th>
                <th className="pb-1 text-right font-normal">vs its own history</th>
                <th className="pb-1 text-right font-normal">asks</th>
                <th className="pb-1 text-right font-normal">vs its own history</th>
              </tr>
            </thead>
            <tbody className="font-mono text-neutral-300">
              {map.liquidity.shells.map((s) => (
                <tr key={s.shell} className="border-t border-neutral-900">
                  <td className="py-1">{s.shell - 1}–{s.shell}%</td>
                  <td className="py-1 text-right">{(s.bidNotional / 1e6).toFixed(1)}M</td>
                  <td className="py-1 text-right text-neutral-500">{s.bidPercentile.toFixed(0)}th</td>
                  <td className="py-1 text-right">{(s.askNotional / 1e6).toFixed(1)}M</td>
                  <td className="py-1 text-right text-neutral-500">{s.askPercentile.toFixed(0)}th</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-600">
            Percentiles are against this coin’s own last 90 days, so “thin” means thin for it.
            Coverage: {map.liquidity.coverage}.
          </p>
        </section>
      ) : null}

      {/* ── what this page refuses to say ── */}
      <section className="rounded-lg border border-neutral-800/60 bg-neutral-900/30 p-4">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          What this does not tell you
        </h2>
        <ul className="space-y-1 text-xs leading-relaxed text-neutral-500">
          {map.disclaimers.map((d) => (
            <li key={d}>· {d}</li>
          ))}
        </ul>
        <a
          href="/calibration"
          className="mt-3 inline-block text-xs text-sky-600 hover:text-sky-400"
        >
          How accurate has each number been? →
        </a>
      </section>
    </div>
  );
}
