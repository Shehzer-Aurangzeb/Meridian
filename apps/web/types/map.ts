/**
 * The market map, as the API sends it.
 *
 * Mirrors `apps/api/src/map/map.types.ts`. The important property is that a
 * probability is `Calibrated | Withheld` and never a bare number — the
 * frontend cannot render a confident figure the backend did not stand behind,
 * because there is no shape in which one arrives.
 */

export interface Calibrated {
  value: number;
  n: number;
  ci95?: [number, number];
  fittedAt: string;
}

export interface Withheld {
  value: null;
  reason: string;
  evidence: string;
}

export type Probability = Calibrated | Withheld;

export const isPublished = (p: Probability): p is Calibrated => p.value !== null;

export interface ConeBand {
  p50: number;
  p80: number;
  p90: number;
  coverage: { p50: number; p80: number; p90: number };
}

export interface MarketMap {
  symbol: string;
  asOf: string;
  spot: number;
  expectedMove: {
    horizons: Record<string, ConeBand>;
    calibrated: true;
    fittedAt: string;
    note: string;
  } | null;
  regime: {
    state: 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';
    ageHours: number;
    ageTruncated: boolean;
    reason: string;
    exitWithin24h: Probability;
  } | null;
  zones: Array<{
    low: number;
    high: number;
    center: number;
    type: 'support' | 'resistance';
    sources: string[];
    distancePercent: number;
    spanPercent: number;
    bounceWithin4h: Probability;
    shell: number | null;
  }>;
  liquidity: {
    shells: Array<{
      shell: number;
      bidNotional: number;
      askNotional: number;
      bidPercentile: number;
      askPercentile: number;
    }>;
    imbalance: number | null;
    coverage: string;
    asOf: string | null;
  } | null;
  crowding: {
    fundingPercentile: number | null;
    oiChange24h: number | null;
    score: number | null;
    components: string[];
    note: string;
  } | null;
  disclaimers: string[];
}

export interface CalibrationEntry {
  output: string;
  status: 'PUBLISHED' | 'WITHHELD';
  bar: string;
  measured: string;
  curve: Array<{ predicted: number; realised: number; n: number }> | null;
  fittedAt: string;
  evidence: string;
  note: string;
}

export interface CalibrationReport {
  entries: CalibrationEntry[];
  summary: string;
}
