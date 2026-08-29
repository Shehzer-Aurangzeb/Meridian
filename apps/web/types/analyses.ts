/**
 * The shapes the API returns, copied by hand because the website does not
 * import from the backend.
 *
 * Dates are text, not Date objects: JSON has no dates, so calling a date
 * method on one would compile fine and then fail when it runs.
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
  /** Average reward across the targets, weighted by how much is sold at each. */
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
  /** One per plan direction: a checklist only makes sense for one side. */
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
  /** Result in R before fees. Null until the trade opens. */
  r: number | null;
  /** After fees. Anything shown to a person uses this one. */
  netR: number | null;
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
 * What became of one analysis. Worked out when read, by the same code the
 * detail page uses. Only present when the list was asked for it.
 */
export interface AnalysisStatus {
  direction: Direction | null;
  outcome: PlanOutcome | null;
  /** Result in R before fees. Null until the trade opens. */
  r: number | null;
  /** After fees. This is the number the scoreboard adds up. */
  netR: number | null;
  freshness: Freshness;
  filledAt: string | null;
  /** How many targets price reached, in order. */
  targetsHit: number;
  currentPrice: number;
  /**
   * When the outcome was scored. Only meaningful for OPEN trades: their netR
   * is a mark at the last close the scorer saw, so it is as old as this.
   */
  scoredAt: string | null;
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
  /** ISO. The window actually applied, whether or not it was asked for. */
  from: string;
  /**
   * Analyses older than this were built by an earlier version of the planner.
   * They are still listed and still open normally — they are only left OUT of
   * the scoreboard totals, because averaging two planners describes neither.
   */
  epoch: string;
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
   * Null if the API is older than the website. The two deploy at different
   * speeds, so every release has a window where this is missing.
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
