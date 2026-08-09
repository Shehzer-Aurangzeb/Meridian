// ============ Common Types ============

export type Action = 'LONG' | 'SHORT' | 'WAIT';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
export type StrategyRoute = 'SQUEEZE_BREAKOUT' | 'CONFLUENCE_CHECKLIST' | 'UNKNOWN';
export type MarketRegime = 'COMPRESSION' | 'TRENDING' | 'MEAN_REVERSION';
export type TradeType = 'swing' | 'day' | 'scalp';

// ============ Legacy Analysis Types ============

export interface AnalysisData {
  id: string;
  coin: string;
  action: Action;
  entryPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  conditionsMet: string[];
  indicators: {
    rsi: number;
    bb: {
      upper: number;
      middle: number;
      lower: number;
    };
    atr: number;
    support: number | null;
    resistance: number | null;
  };
  currentPrice: number;
  timeframe: string;
  timestamp: Date;
}

export interface AnalysisResponse {
  success: boolean;
  data?: AnalysisData;
  error?: string;
}

// ============ Coordinator Analysis Types ============

export interface ClaudeAnalysisResponse {
  action: Action;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  leverage: number;
  reasoning: string;
  keyLevels?: {
    support: number[];
    resistance: number[];
  };
}

export interface ChecklistItem {
  name: string;
  passed: boolean;
  weight: number;
}

export interface ChecklistResult {
  status: string;
  score: number;
  items: ChecklistItem[];
}

export interface SqueezeSetup {
  isActive: boolean;
  direction: 'long' | 'short' | null;
  confidence: number;
}

/**
 * Market regime metrics from backend
 */
export interface MarketRegimeMetrics {
  adx: number;
  pdi: number;
  mdi: number;
  rsi: number;
  atr: number;
  bandWidth: number;
  bandWidthPercentile: number | null;
  bandWidthThreshold: number;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    percentB: number;
  };
}

/**
 * Market regime result from backend
 */
export interface MarketRegimeResult {
  symbol: string;
  timeframe: string;
  regime: MarketRegime;
  reason: string;
  metrics: MarketRegimeMetrics;
}

/**
 * Coordinator analysis result from backend
 * Note: The actual regime enum is at regimeResult.regime
 */
export interface CoordinatorAnalysisResult {
  symbol: string;
  timeframe: string;
  regimeResult: MarketRegimeResult;
  strategyRoute: StrategyRoute;
  squeezeSetup: SqueezeSetup | null;
  checklistResult: ChecklistResult | null;
  shouldInvokeAI: boolean;
  reasoning: string;
}

export interface CoordinateAnalysisData {
  coordinator: CoordinatorAnalysisResult;
  ai: ClaudeAnalysisResponse | null;
  durationMs: number;
}

export interface CoordinateAnalysisResponse {
  success: boolean;
  data?: CoordinateAnalysisData;
  error?: string;
}

// ============ Portfolio Scan Types ============

export interface MacroBias {
  timeframe: '1d';
  regime: MarketRegime | 'UNKNOWN';
  bias: 'long' | 'short' | 'neutral';
}

export interface ExecutionHorizon {
  timeframe: '4h' | '1h';
  strategyRoute: StrategyRoute | 'UNKNOWN';
  status: string;
  score: number | null;
  shouldInvokeAI: boolean;
  squeezeSetup: SqueezeSetup | null;
  checklistResult: ChecklistResult | null;
}

export interface RiskProfile {
  positionSize: number;
  marginRequired: number;
  recommendedLeverage: number;
  liquidationPrice: number;
  stopLossPrice: number;
  warnings: string[];
}

export interface PortfolioScanResult {
  coin: string;
  walletBalance: number;
  macroBias: MacroBias;
  executionHorizon: ExecutionHorizon;
  riskProfile: RiskProfile | null;
  aiInsight: ClaudeAnalysisResponse | null;
  expiresAt: string;
}

// ============ SSE Stream Events ============

export type StreamAnalysisEvent =
  | { status: 'FETCHING_DATA'; message: string }
  | { status: 'REGIME_CLASSIFIED'; message: string; data: { regime: MarketRegime } }
  | { status: 'AI_THINKING'; message: string }
  | { status: 'HEARTBEAT'; ts: number }
  | { status: 'COMPLETE'; payload: { coordinator: CoordinatorAnalysisResult; ai: ClaudeAnalysisResponse | null } }
  | { status: 'ERROR'; error: string };

// ============ Health Types ============

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

export interface BffHealthResponse {
  bff: string;
  backend: HealthResponse | 'unhealthy' | 'unreachable';
  error?: string;
}
