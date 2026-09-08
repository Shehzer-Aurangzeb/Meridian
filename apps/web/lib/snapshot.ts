import type { MarketMap, Probability, Withheld } from '@/types/map';

/**
 * Make an archived map safe to render, without inventing anything.
 *
 * A snapshot is frozen JSON from whenever it was taken. `MapView` is today's
 * code, and it calls `.map()` on zones and disclaimers and reads a
 * `Probability` off every zone — so a snapshot written before any of those
 * existed crashes the page rather than showing what it does have.
 *
 * The rule here is narrow on purpose: fill in the SHAPE the renderer needs,
 * never the CONTENT. A snapshot with no disclaimers renders with none, not with
 * today's — the page has to show what was actually shown, and quietly pasting
 * in current copy would make the record useless as evidence.
 */

const MISSING = (field: string): Withheld => ({
  value: null,
  reason: `This reading predates the field "${field}", so nothing was recorded for it.`,
  evidence: 'docs/SIM_JOURNAL_PLAN.md',
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

function probability(v: unknown, field: string): Probability {
  if (!isObject(v)) return MISSING(field);
  if (typeof v.value === 'number' && Number.isFinite(v.value)) {
    return {
      value: v.value,
      n: num(v.n),
      fittedAt: typeof v.fittedAt === 'string' ? v.fittedAt : 'unknown',
      ...(Array.isArray(v.ci95) && v.ci95.length === 2
        ? { ci95: [num(v.ci95[0]), num(v.ci95[1])] as [number, number] }
        : {}),
    };
  }
  return {
    value: null,
    reason: typeof v.reason === 'string' ? v.reason : MISSING(field).reason,
    evidence: typeof v.evidence === 'string' ? v.evidence : '',
  };
}

/** Null when the snapshot is too damaged to show anything honest. */
export function normaliseSnapshot(raw: unknown): MarketMap | null {
  if (!isObject(raw)) return null;
  if (typeof raw.symbol !== 'string' || raw.symbol === '') return null;

  const regime = isObject(raw.regime)
    ? {
        state: raw.regime.state as MarketMap['regime'] extends null
          ? never
          : 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION',
        ageHours: num(raw.regime.ageHours),
        ageTruncated: raw.regime.ageTruncated === true,
        reason: typeof raw.regime.reason === 'string' ? raw.regime.reason : '',
        exitWithin24h: probability(raw.regime.exitWithin24h, 'regime.exitWithin24h'),
      }
    : null;

  const zones = (Array.isArray(raw.zones) ? raw.zones : []).filter(isObject).map((z) => ({
    low: num(z.low),
    high: num(z.high),
    center: num(z.center),
    type: z.type === 'resistance' ? ('resistance' as const) : ('support' as const),
    sources: strings(z.sources),
    distancePercent: num(z.distancePercent),
    spanPercent: num(z.spanPercent),
    bounceWithin4h: probability(z.bounceWithin4h, 'zone.bounceWithin4h'),
    shell: typeof z.shell === 'number' ? z.shell : null,
  }));

  const liquidity = isObject(raw.liquidity)
    ? {
        shells: (Array.isArray(raw.liquidity.shells) ? raw.liquidity.shells : [])
          .filter(isObject)
          .map((s) => ({
            shell: num(s.shell),
            bidNotional: num(s.bidNotional),
            askNotional: num(s.askNotional),
            bidPercentile: num(s.bidPercentile),
            askPercentile: num(s.askPercentile),
          })),
        imbalance: typeof raw.liquidity.imbalance === 'number' ? raw.liquidity.imbalance : null,
        coverage: typeof raw.liquidity.coverage === 'string' ? raw.liquidity.coverage : '',
        asOf: typeof raw.liquidity.asOf === 'string' ? raw.liquidity.asOf : null,
      }
    : null;

  const expectedMove = isObject(raw.expectedMove)
    ? {
        horizons: (isObject(raw.expectedMove.horizons)
          ? raw.expectedMove.horizons
          : {}) as MarketMap['expectedMove'] extends null
          ? never
          : NonNullable<MarketMap['expectedMove']>['horizons'],
        calibrated: true as const,
        fittedAt:
          typeof raw.expectedMove.fittedAt === 'string' ? raw.expectedMove.fittedAt : 'unknown',
        note: typeof raw.expectedMove.note === 'string' ? raw.expectedMove.note : '',
      }
    : null;

  return {
    symbol: raw.symbol,
    asOf: typeof raw.asOf === 'string' ? raw.asOf : '',
    spot: num(raw.spot),
    expectedMove,
    regime,
    zones,
    liquidity,
    crowding: isObject(raw.crowding) ? (raw.crowding as MarketMap['crowding']) : null,
    // Never today's list. An archived reading showed whatever it showed.
    disclaimers: strings(raw.disclaimers),
  };
}
