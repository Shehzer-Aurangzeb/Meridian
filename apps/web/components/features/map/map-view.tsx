'use client';

import { Explain, EXPLAIN } from '@/components/ui/explain';
import type { MarketMap } from '@/types/map';
import { ExpectedMoveCone } from './expected-move-cone';
import { WithheldNote } from './withheld-note';

/**
 * Market states in the reader's words, not the model's.
 *
 * The backend labels are COMPRESSION / TRENDING / MEAN_REVERSION. None of those
 * is a phrase a non-trader can act on, and "mean reversion" in particular reads
 * as a prediction that price will return somewhere. The headline says what is
 * happening; the sentence says what it means; the tooltip carries the rest.
 */
const STATE_COPY = {
  COMPRESSION: {
    title: 'Quiet',
    line: 'The price has been unusually still. Quiet stretches often end in a big move — this does not say which way.',
    explain: EXPLAIN.quiet,
  },
  TRENDING: {
    title: 'Moving one way',
    line: 'The price has been travelling persistently in one direction rather than drifting.',
    explain: EXPLAIN.trending,
  },
  MEAN_REVERSION: {
    title: 'Drifting sideways',
    line: 'The price has been wandering up and down without going anywhere in particular.',
    explain: EXPLAIN.bouncing,
  },
} as const;

const asMoney = (x: number): string =>
  x.toLocaleString('en-US', { maximumFractionDigits: x > 100 ? 0 : 2 });

/** A section: plain title, one line saying what it shows, then the data. */
function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="font-antonio text-[22px] font-semibold uppercase tracking-headline text-text-primary">
        {title}
      </h2>
      <p className="mb-5 mt-1.5 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
        {blurb}
      </p>
      {children}
    </section>
  );
}

/**
 * The map screen.
 *
 * ─── It answers three questions, in this order ───────────────────────────
 *   1. Is the market calm or stormy?      the expected move — largest, first
 *   2. What is it doing right now?        state and key levels — secondary
 *   3. Where are the traps?               waiting orders — tertiary
 *
 * ─── And it must never look like a trade idea ────────────────────────────
 * No arrows, no entry markers, no target lines. The move bands are one colour
 * and symmetric. Levels above and below the price share a colour, because
 * green-for-up and red-for-down quietly encodes a call — the label says which
 * is which instead. Gold is the only accent; amber marks an absence.
 */
export function MapView({ map }: { map: MarketMap }) {
  const state = map.regime ? STATE_COPY[map.regime.state] : null;

  return (
    <div>
      <header className="border-b border-border/40 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-antonio text-display-sm font-semibold uppercase tracking-headline text-text-primary">
            {map.symbol}
            <span className="ml-4 font-mono text-[22px] font-normal tracking-normal text-text-secondary">
              {asMoney(map.spot)}
            </span>
          </h1>
          <time className="font-mono text-[12px] text-text-tertiary">
            {new Date(map.asOf).toISOString().replace('T', ' ').slice(0, 16)} UTC
          </time>
        </div>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          This page describes what the market is doing. It never says which way the
          price will go — that was tested twenty times and it could not be done.
        </p>
      </header>

      {/* ── 1. Is the market calm or stormy? ── */}
      {map.expectedMove ? (
        <Section
          title="How big a move to expect"
          blurb={
            <>
              How far the price is likely to travel from here, up{' '}
              <em className="not-italic text-text-primary">or</em> down. The bands are
              deliberately even on both sides:{' '}
              <Explain term={EXPLAIN.expectedMove}>this is about size, not direction</Explain>.
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(map.expectedMove.horizons).map(([hours, band]) => (
              <ExpectedMoveCone key={hours} spot={map.spot} hours={hours} band={band} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── 2. What is the market doing right now? ── */}
      {map.regime && state ? (
        <Section
          title="Market state"
          blurb={
            <>
              What kind of market this is at the moment, and{' '}
              <Explain term={EXPLAIN.stateAge}>how long it has been that way</Explain>.
            </>
          }
        >
          <div className="rounded border border-border/40 bg-surface p-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Explain term={state.explain}>
                <span className="font-antonio text-[26px] font-semibold uppercase tracking-headline text-text-primary">
                  {state.title}
                </span>
              </Explain>
              <span className="font-mono text-[15px] text-text-secondary">
                for {map.regime.ageHours} hours
                {map.regime.ageTruncated ? ' or more' : ''}
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
              {state.line}
            </p>
            <div className="mt-5 border-t border-border/40 pt-4">
              <WithheldNote
                label="Chance this ends in the next 24 hours"
                probability={map.regime.exitWithin24h}
              />
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="Key price levels"
        blurb={
          <>
            Prices where the market has turned around before. Drawn from past highs and
            lows —{' '}
            <Explain term={EXPLAIN.keyLevels}>not from a prediction</Explain>.
          </>
        }
      >
        {map.zones.length === 0 ? (
          <p className="text-[14px] text-text-tertiary">
            No clear levels on the charts right now.
          </p>
        ) : (
          <div className="space-y-3">
            {map.zones.map((z, i) => (
              <div
                key={`${z.center}-${i}`}
                className="rounded border border-border/40 bg-surface p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-mono text-[16px] text-text-primary">
                    {asMoney(z.low)} – {asMoney(z.high)}
                  </span>
                  <span className="text-[13px] text-text-secondary">
                    {z.type === 'support' ? 'below' : 'above'} today&rsquo;s price, by{' '}
                    {Math.abs(z.distancePercent).toFixed(2)}%
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] text-text-tertiary">
                  {z.sources.length === 0 ? (
                    'How this level was found was not recorded.'
                  ) : (
                    <>
                      <Explain term={EXPLAIN.multipleSignals}>
                        found by {z.sources.length} {z.sources.length === 1 ? 'method' : 'methods'}
                      </Explain>
                      <span className="ml-1">— {z.sources.join(', ')}</span>
                    </>
                  )}
                </p>
                <div className="mt-4 border-t border-border/40 pt-3">
                  <WithheldNote label="Chance the price turns here" probability={z.bounceWithin4h} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 3. Where are the traps? ── */}
      {map.liquidity ? (
        <Section
          title="Where big orders are waiting"
          blurb={
            <>
              Buy and sell orders already sitting on the exchange.{' '}
              <Explain term={EXPLAIN.bigOrders}>
                A lot of them at one price can slow the price down when it arrives
              </Explain>
              . Every figure is{' '}
              <Explain term={EXPLAIN.comparedToPast}>compared with this coin&rsquo;s own last 90 days</Explain>.
            </>
          }
        >
          <div className="overflow-x-auto rounded border border-border/40 bg-surface p-6">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-text-tertiary">
                  <th className="pb-2 font-normal">
                    <Explain term={EXPLAIN.distanceBand}>Distance from price</Explain>
                  </th>
                  <th className="pb-2 text-right font-normal">Buy orders</th>
                  <th className="pb-2 text-right font-normal">vs its own past</th>
                  <th className="pb-2 text-right font-normal">Sell orders</th>
                  <th className="pb-2 text-right font-normal">vs its own past</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {map.liquidity.shells.map((s) => (
                  <tr key={s.shell} className="border-t border-border/40">
                    <td className="py-2 font-mono">
                      {s.shell - 1}–{s.shell}%
                    </td>
                    <td className="py-2 text-right font-mono">
                      ${(s.bidNotional / 1e6).toFixed(1)}M
                    </td>
                    <td className="py-2 text-right text-text-secondary">
                      {describePercentile(s.bidPercentile)}
                    </td>
                    <td className="py-2 text-right font-mono">
                      ${(s.askNotional / 1e6).toFixed(1)}M
                    </td>
                    <td className="py-2 text-right text-text-secondary">
                      {describePercentile(s.askPercentile)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-[12px] leading-relaxed text-text-tertiary">
              We can only see orders within 5% of today&rsquo;s price. Past that, this
              system has no information at all — which is not the same as there being
              nothing there.
            </p>
          </div>
        </Section>
      ) : null}

      <section className="mt-12 rounded border border-border/40 bg-surface-hover/40 p-6">
        <h2 className="font-antonio text-[18px] font-semibold uppercase tracking-headline text-text-primary">
          What this page does not tell you
        </h2>
        <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-text-secondary">
          {map.disclaimers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <a
          href="/calibration"
          className="mt-4 inline-block text-[13px] text-gold-ink underline underline-offset-2 hover:text-text-primary"
        >
          See how accurate each number has been
        </a>
      </section>
    </div>
  );
}

/**
 * A percentile as a sentence.
 *
 * "12th percentile" means nothing to someone who does not already know. "Thinner
 * than usual" is the same fact in words they can act on, and the exact figure is
 * still there for anyone who wants it.
 */
function describePercentile(p: number): string {
  if (p <= 15) return `unusually thin (${p.toFixed(0)}%)`;
  if (p <= 35) return `thinner than usual (${p.toFixed(0)}%)`;
  if (p < 65) return `about normal (${p.toFixed(0)}%)`;
  if (p < 85) return `thicker than usual (${p.toFixed(0)}%)`;
  return `unusually thick (${p.toFixed(0)}%)`;
}
