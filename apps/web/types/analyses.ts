/**
 * Wire types for the /analyses API, hand-mirrored from apps/api — `web` does
 * not depend on `api`.
 *
 * Dates are `string`, not `Date`: typing them as `Date` compiles and then
 * throws on `.getTime()`.
 *
 * Not re-exported from `@/types` — the legacy `Timeframe` there is missing
 * `12h`, which the level map uses for its Fibonacci anchor.
 */

export type AnalysisTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '12h' | '1d' | '1w';
export type Regime = 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';
export type Route = 'SQUEEZE_BREAKOUT' | 'CONFLUENCE_CHECKLIST';
export type Direction = 'long' | 'short';
export type LevelType = 'support' | 'resistance';

/** Only ACTIONABLE is takeable now. */
export type ZoneState = 'ACTIONABLE' | 'APPROACHING' | 'FAR';

export type Freshness = 'LIVE' | 'INVALIDATED' | 'SUPERSEDED';

export type PlanOutcome =
  | 'PENDING'
  | 'MISSED'
  | 'OPEN'
  | 'STOPPED'
  | 'PARTIAL'
  | 'ALL_TARGETS'
  /** Filled, never reached a target or the stop, and the 72h hold is spent. */
  | 'EXPIRED'
  /** The candles needed to score it could not be fetched. No badge, no R. */
  | 'UNSCOREABLE';

export interface FibLevel {
  /** 0 | 0.25 | 0.5 | 0.75 | 1 */
  ratio: number;
  price: number;
  type: LevelType;
}

export interface MarkedLevel {
  price: number;
  type: LevelType;
  /** e.g. '0.5 Fib (12h)' or '4h swing x3'. */
  source: string;
  touchCount?: number;
}

/** A band where several independent marks agree. */
export interface ConfluenceZone {
  low: number;
  high: number;
  center: number;
  type: LevelType;
  sources: string[];
  spanPercent: number;
  /** Signed: negative = below spot. */
  distancePercent: number;
}

export interface LevelMap {
  symbol: string;
  spot: number;
  anchor: { timeframe: AnalysisTimeframe; low: number; high: number } | null;
  fib: FibLevel[];
  atr: number;
  atrTimeframe: AnalysisTimeframe;
  marks: MarkedLevel[];
  zones: ConfluenceZone[];
  perTimeframe: Array<{ timeframe: AnalysisTimeframe; levels: number }>;
}

export interface PlanEntry {
  price: number;
  weightPercent: number;
}

export interface PlanTarget {
  price: number;
  weightPercent: number;
  rMultiple: number;
  source: string;
}

export interface TradePlan {
  direction: Direction;
  state: ZoneState;
  zone: ConfluenceZone;
  distanceToZonePercent: number;
  entries: PlanEntry[];
  averageEntry: number;
  stop: number;
  riskPercent: number;
  riskPerUnit: number;
  targets: PlanTarget[];
  /**
   * Not comparable between plans with different target counts — the 33/33/34
   * weights leave 34% unallocated with only two targets. Show per plan; never
   * sum or average across plans.
   */
  blendedR: number;
  comeBackWhen: string;
}

export interface RegimeResult {
  symbol: string;
  timeframe: string;
  regime: Regime;
  reason: string;
  metrics: {
    adx: number;
    pdi: number;
    mdi: number;
    rsi: number;
    atr: number;
    bandWidth: number;
    /** Null until the 200-sample history is available. */
    bandWidthPercentile: number | null;
    bandWidthThreshold: number;
    bandWidthLookback: number;
    bandWidthSamples: number;
    bollingerBands: { upper: number; middle: number; lower: number };
  };
}

export interface ChecklistCondition {
  name: string;
  passed: boolean;
  value?: number | string;
  threshold?: string;
  reason: string;
}

export interface ChecklistResult {
  rsi: ChecklistCondition;
  qqe: ChecklistCondition;
  bollingerBand: ChecklistCondition;
  marketStructure: ChecklistCondition;
  supportResistance: ChecklistCondition;
  /** 0–5. `passed` is true at 3 or more. */
  conditionsMet: number;
  passed: boolean;
  tradeType: Direction;
  conditions: ChecklistCondition[];
}

export interface SqueezeSetup {
  symbol: string;
  timeframe: string;
  upperTriggerPrice: number;
  lowerTriggerPrice: number;
  volumeBaseline: number;
  lookback: number;
  volumeMultiplier: number;
  entryConditions: string;
}

export interface AnalysisRecord {
  symbol: string;
  timeframes: {
    levels: AnalysisTimeframe[];
    fib: AnalysisTimeframe;
    atr: AnalysisTimeframe;
    regime: AnalysisTimeframe;
  };
  regime: RegimeResult;
  route: Route;
  /**
   * Only on the CONFLUENCE_CHECKLIST route, one entry per plan direction.
   * Was a single result scored for a trend-derived side and shown against
   * both plans.
   */
  checklists: Partial<Record<'long' | 'short', ChecklistResult>> | null;
  /** Only on the SQUEEZE_BREAKOUT route. */
  squeeze: SqueezeSetup | null;
  map: LevelMap;
  plans: TradePlan[];
  durationMs: number;
}

export interface PlanResult {
  direction: Direction;
  outcome: PlanOutcome;
  /** Realised R, or mark-to-market while OPEN. Null before a fill. */
  r: number | null;
  filledAt: string | null;
  targetsHit: number;
}

export interface AnalysisListItem {
  id: string;
  symbol: string;
  timeframe: string;
  regime: string;
  strategyRoute: string;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
  /** Only when the list was fetched with `status: true`. */
  status?: AnalysisStatus | null;
}

/**
 * What became of one analysis — the lead plan's outcome and geometry, computed
 * on read by the same code the detail page uses. Present only when the list was
 * fetched with `status=true`.
 */
export interface AnalysisStatus {
  direction: Direction | null;
  outcome: PlanOutcome | null;
  /** Gross R, marked to market while OPEN. Null until a fill. */
  r: number | null;
  /** After the round-trip cost — the number the scoreboard sums. */
  netR: number | null;
  freshness: Freshness;
  filledAt: string | null;
  /** Targets reached in order; drives the ticks on the ladder. */
  targetsHit: number;
  currentPrice: number;
  plan: {
    entries: number[];
    averageEntry: number;
    stop: number;
    targets: number[];
    riskPercent: number;
    blendedR: number;
  } | null;
}

export interface AnalysisListResponse {
  count: number;
  /** The window returned exactly `limit` rows, so older ones are not in it. */
  truncated: boolean;
  analyses: AnalysisListItem[];
}

/** The analysis in sentences. Computed, not generated — see verdict.ts. */
export interface Verdict {
  headline: string;
  body: string[];
  status: string | null;
}

/** Claude's read, written on demand and kept. Null until someone asks. */
export interface SavedNarration {
  text: string;
  /** Prices Claude cited that trace to a computed number. */
  citedPrices: number[];
  model: string;
  narratedAt: string;
}

export interface AnalysisDetail {
  id: string;
  createdAt: string;
  currentPrice: number;
  freshness: Freshness;
  outcomes: PlanResult[];
  /**
   * Null against an API deployed before the verdict shipped. The frontend and
   * the API deploy on different clocks — Vercel in seconds, CDK in minutes —
   * so every deploy has a window where this field is not there yet.
   */
  verdict: Verdict | null;
  narration: SavedNarration | null;
  analysis: AnalysisRecord;
}

export interface RunAnalysisResponse {
  id: string;
  analysis: AnalysisRecord;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  cache: 'ok' | 'error';
  binance: 'ok' | 'error';
  database: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  responseTime: {
    cache: number | null;
    binance: number | null;
    database: number | null;
  };
}
