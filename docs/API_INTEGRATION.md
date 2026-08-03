# Meridian API — Integration Guide

> **Audience:** Frontend (Next.js) + any external integrator.
> **Verified against:** `apps/api/src` on `main` as of 19 May 2026.
> **Live Swagger:** `http://localhost:3001/docs` (JSON: `/docs-json`).

This document is the single source of truth for every HTTP endpoint the Meridian backend exposes. Each section lists method, full path, throttle, request shape, response shape, and any operational notes.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Global Conventions](#2-global-conventions)
3. [Endpoint Index](#3-endpoint-index)
4. [Health](#4-health)
5. [Analysis (legacy single-pass)](#5-analysis-legacy-single-pass)
6. [Analysis Coordinator (modern pipeline + SSE)](#6-analysis-coordinator)
7. [Performance & Smart-TTL Evaluation](#7-performance--smart-ttl-evaluation)
8. [History](#8-history)
9. [Validation](#9-validation)
10. [Support / Resistance Levels](#10-support--resistance-levels)
11. [Risk Management](#11-risk-management)
12. [Shared Type Reference](#12-shared-type-reference)
13. [Error Model & Status Codes](#13-error-model--status-codes)
14. [Throttle Matrix](#14-throttle-matrix)

---

## 1. Prerequisites

### Runtime

| Item | Value |
| --- | --- |
| Node | 20+ (matches `apps/api` `package.json`) |
| Package manager | `pnpm` (workspace) |
| Database | PostgreSQL (Prisma 7.8.0) |
| External APIs | Binance Spot (no key for public data), Anthropic Claude |

### Environment variables (`apps/api/.env.{NODE_ENV}`)

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `local` | Picks `.env.local` / `.env.dev` / `.env.prod` |
| `PORT` | no | `3001` | HTTP listen port |
| `CORS_ORIGINS` | no | `http://localhost:3000` | Comma-separated allow-list (credentials enabled) |
| `DATABASE_URL` | yes | — | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | — | Claude API access |
| `BINANCE_TIMEOUT_MS` | no | `30000` | Kline request timeout |
| `BINANCE_PRICE_TIMEOUT_MS` | no | `10000` | Price-tick request timeout |

### Local startup

```bash
pnpm install
pnpm --filter api prisma migrate deploy
pnpm --filter api dev      # http://localhost:3001
```

`pnpm typecheck` must report `EXIT:0` before integrating.

---

## 2. Global Conventions

### Base URL

```
http://localhost:3001
```

> ⚠️ **There is no global `/api` prefix.** `main.ts` does not call `app.setGlobalPrefix(...)`. Every example below uses the literal mounted path.

### Headers

| Header | When |
| --- | --- |
| `Content-Type: application/json` | All `POST` / `PUT` bodies |
| `Accept: text/event-stream` | SSE endpoint (browsers send this automatically via `EventSource`) |
| `Cache-Control: no-cache` | Recommended for SSE behind CDNs |

CORS allows `GET POST PUT PATCH DELETE OPTIONS`, exposes `Content-Type` and `X-Request-Id`, and runs with `credentials: true`.

### Validation

A global `ValidationPipe` runs on every request with:

```ts
{ whitelist: true, transform: true, forbidNonWhitelisted: true }
```

Unknown body/query keys produce **400 Bad Request**. All query strings are auto-coerced to the DTO types.

### Pagination & date filters

Every list endpoint that takes time bounds uses the shared `HistoryQueryDto`:

```ts
class HistoryQueryDto {
  limit?: number;       // 1..200, default 50 (max enforced via @Max)
  startDate?: string;   // ISO-8601
  endDate?: string;     // ISO-8601
}
```

---

## 3. Endpoint Index

| # | Method | Path | Throttle (per 60s) |
| --- | --- | --- | --- |
| 1 | GET | `/health` | unlimited |
| 2 | GET | `/health/ready` | unlimited |
| 3 | GET | `/health/live` | unlimited |
| 4 | POST | `/analysis/analyze` | 10 |
| 5 | POST | `/analysis/multi-timeframe` | 20 |
| 6 | GET | `/analysis/bias/:coin` | 30 |
| 7 | POST | `/analysis/ai-analyze` | 5 |
| 8 | POST | `/analysis/test-prompt` | unlimited |
| 9 | GET | `/analysis-coordinator/stream` *(SSE)* | 10 |
| 10 | POST | `/analysis-coordinator/coordinate` | 20 |
| 11 | POST | `/analysis-coordinator/portfolio-scan` | 20 |
| 12 | GET | `/analysis/performance` | unlimited |
| 13 | GET | `/analysis/performance/:coin` | unlimited |
| 14 | GET | `/analysis/performance/coordinator-runs/:symbol` | 30 |
| 15 | GET | `/analysis/history/:coin` | 60 |
| 16 | GET | `/analysis/validate/:coin` | 60 |
| 17 | GET | `/analysis/levels/:coin` | 60 |
| 18 | GET | `/analysis/levels/:coin/full` | 30 |
| 19 | GET | `/analysis/levels/:coin/nearest` | 60 |
| 20 | POST | `/analysis/position-size` | unlimited (`@SkipThrottle`) |
| 21 | POST | `/analysis/risk-reward` | unlimited |
| 22 | GET | `/analysis/portfolio-allocation` | unlimited |
| 23 | GET | `/analysis/leverage/:timeframe` | unlimited |
| 24 | POST | `/analysis/leverage-recommendation` | unlimited |
| 25 | GET | `/analysis/leverage-constraints` | unlimited |

---

## 4. Health

`HealthController` — prefix `/health`.

### `GET /health`
Aggregates cache + Binance + database probes.

**Response 200**
```ts
{
  status: 'healthy' | 'degraded' | 'unhealthy';
  cache: 'ok' | 'error';
  binance: 'ok' | 'error';
  database: 'ok' | 'error';
  timestamp: string;       // ISO
  uptime: number;          // seconds
  responseTime: {
    cache: number | null;    // ms
    binance: number | null;
    database: number | null;
  };
}
```

### `GET /health/ready`
Light Binance ping. **Response:** `{ ready: boolean }`.

### `GET /health/live`
No external calls. **Response:** `{ live: boolean; uptime: number }`.

---

## 5. Analysis (legacy single-pass)

`AnalysisController` — prefix `/analysis`. This is the original, single-shot analysis API. New work should prefer the **Coordinator** family (§6).

### 5.1 `POST /analysis/analyze`
Single-timeframe Claude-driven recommendation.

**Body** — `AnalyzeRequestDto`
```ts
{
  coin: string;          // 2+ uppercase alphanumerics; auto-uppercased
  timeframe?: '1h' | '4h' | '12h' | '1d';   // default '4h'
}
```

**Response** — `AnalyzeResponseDto`
```ts
{
  success: boolean;
  data?: {
    id: string;
    coin: string;
    action: 'LONG' | 'SHORT' | 'WAIT';
    entryPrice: number; tp1: number; tp2: number; tp3: number;
    stopLoss: number; leverage: number;
    reasoning: string;
    indicators: {
      rsi: number;
      bb: { upper: number; middle: number; lower: number };
      atr: number;
      support: number | null;
      resistance: number | null;
    };
    currentPrice: number;
    timeframe: string;
    timestamp: string;   // ISO
  };
  error?: string;
}
```

Persists the row to `TradeAnalysis`.

### 5.2 `POST /analysis/multi-timeframe`
**Body** — `MultiTimeframeAnalysisDto`
```ts
{
  coin: string;
  tradeType?: 'swing' | 'day' | 'scalp';    // default 'day'
  includeDetailedChecklist?: boolean;       // default true
}
```
**Response** — `MultiTimeframeResponseDto` wrapping HTF bias, LTF entry, full 5-point checklist, and a textual trade suggestion.

### 5.3 `GET /analysis/bias/:coin`
**Query:** `tradeType?: 'swing' | 'day' | 'scalp'`.
**Response:** `QuickBiasResponseDto` → `{ symbol, htfBias, shouldTrade, reasoning }`.

### 5.4 `POST /analysis/ai-analyze`
Same body as `/multi-timeframe`. Returns the raw Claude response plus checklist, HTF bias, key levels, and a `meta` block (`promptLength`, `processingTime`).

### 5.5 `POST /analysis/test-prompt`
Returns the prompt that **would** be sent to Claude without invoking it. Useful for prompt-engineering inspection.

---

## 6. Analysis Coordinator

`AnalysisCoordinatorController` — prefix `/analysis-coordinator`. The modern pipeline: regime → strategy route → checklist/squeeze → conditional AI.

### 6.1 `GET /analysis-coordinator/stream` *(SSE)*

Server-Sent Events. **`Content-Type: text/event-stream`.**

**Query** — `StreamAnalysisQueryDto`
```ts
{
  coin: string;       // 2..15 uppercase alphanumeric (auto-uppercased)
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
}
```

**Event union** (each line is a complete JSON message):

```ts
type StreamAnalysisEvent =
  | { status: 'FETCHING_DATA'; message: string }
  | { status: 'REGIME_CLASSIFIED'; message: string; data: MarketRegimeResult }
  | { status: 'AI_THINKING'; message: string }
  | { status: 'HEARTBEAT'; ts: number }           // every 15s
  | { status: 'COMPLETE'; payload: {
        coordinator: CoordinatorAnalysisResult;
        ai: ClaudeAnalysisResponse | null;
      } }
  | { status: 'ERROR'; error: string };
```

Connection closes after `COMPLETE` or `ERROR`. Client disconnects are cleaned up server-side.

**Browser snippet**
```ts
const es = new EventSource('/analysis-coordinator/stream?coin=BTC&timeframe=1h');
es.onmessage = (e) => {
  const evt: StreamAnalysisEvent = JSON.parse(e.data);
  // route on evt.status …
};
```

### 6.2 `POST /analysis-coordinator/coordinate`

Non-streaming sibling of `/stream`. Same input shape, single JSON response.

**Body**: `StreamAnalysisQueryDto` (re-used as a body DTO).
**Response**
```ts
{
  success: true;
  data: {
    coordinator: CoordinatorAnalysisResult;
    ai: ClaudeAnalysisResponse | null;
    durationMs: number;
  };
}
```

### 6.3 `POST /analysis-coordinator/portfolio-scan`

Multi-timeframe scanner. Runs **1d + 4h + 1h** coordinator passes in parallel, derives macro bias, picks the active execution horizon (1h preferred, 4h fallback), runs Claude on the chosen horizon, sizes a risk profile against `walletBalance`, persists a `CoordinatorRun` row with a smart-TTL `expiresAt`, and returns the aggregate.

Returns `200 OK` (forced via `@HttpCode(HttpStatus.OK)`).

**Body** — `PortfolioScanDto`
```ts
{
  coin: string;          // 2..15 uppercase alphanumeric (auto-uppercased)
  walletBalance: number; // > 0, up to 8 decimal places
}
```

**Response** — `MultiTimeframeScanResult`
```ts
{
  coin: string;
  walletBalance: number;

  macroBias: {
    timeframe: '1d';
    regime: MarketRegime | 'UNKNOWN';
    bias: 'long' | 'short' | 'neutral';
  };

  executionHorizon: {
    timeframe: '4h' | '1h';
    strategyRoute: StrategyRoute | 'UNKNOWN';
    status: ChecklistStatus | 'PENDING_BREAKOUT' | 'WATCHING';
    score: number | null;
    shouldInvokeAI: boolean;
    squeezeSetup: SqueezeBreakoutSetup | null;
    checklistResult: EntryChecklistResult | null;
  };

  riskProfile: {
    positionSize: number;
    marginRequired: number;
    recommendedLeverage: number;
    liquidationPrice: number;
    stopLossPrice: number;
    warnings: string[];
  } | null;   // null when execution horizon is WATCHING or Claude returns WAIT

  aiInsight: ClaudeAnalysisResponse | null;

  expiresAt: string;   // ISO-8601. Smart TTL based on executionHorizon.timeframe:
                       // 15m→4h, 1h→12h, 4h→48h, 1d→7d.
}
```

**Curl**
```bash
curl -X POST http://localhost:3001/analysis-coordinator/portfolio-scan \
  -H 'Content-Type: application/json' \
  -d '{"coin":"SOL","walletBalance":5000}'
```

---

## 7. Performance & Smart-TTL Evaluation

`PerformanceController` — prefix `/analysis/performance`.

### 7.1 `GET /analysis/performance`
**Query:** `HistoryQueryDto`.
**Response** — `PerformanceResponseDto`
```ts
{
  success: boolean;
  data?: {
    winRate: number;        // 0..100 (rounded to one decimal)
    totalAnalyzed: number;
    correct: number; failed: number; pending: number; neutral: number;
    coin?: string;
    recentAnalyses: PerformanceAnalysis[];
  };
  error?: string;
}

interface PerformanceAnalysis {
  id: string;
  coin: string;
  suggestion: 'LONG' | 'SHORT' | 'WAIT';
  entryPrice: number;
  stopLoss: number;
  priceAtAnalysis: number;
  currentPrice: number | null;
  status: 'correct' | 'failed' | 'pending' | 'neutral';
  priceChange: number | null;
  priceChangePercent: number | null;
  createdAt: string;        // ISO
}
```

### 7.2 `GET /analysis/performance/:coin`
Same response shape; scoped to one symbol; `data.coin` populated.

### 7.3 `GET /analysis/performance/coordinator-runs/:symbol`

**Smart-TTL evaluator.** Walks every `CoordinatorRun` with `aiAction in ('LONG','SHORT')` for the symbol; pulls historical klines on the run's own timeframe; resolves the lifecycle.

**Phase 1 — fill detection** (only when `entryFilledAt` is null): scans candles in `[createdAt, min(now, expiresAt)]`. LONG fills on `low ≤ entryPrice`; SHORT on `high ≥ entryPrice`. First match persists `entryFilledAt`. No match + TTL elapsed → `EXPIRED_UNFILLED`.

**Phase 2 — outcome detection** (when filled): scans candles from `entryFilledAt` forward, **ignoring `expiresAt`**. First wick to touch SL → `STOPPED_OUT`; first to touch TP1 → `TARGET_HIT`; same-candle straddle conservatively resolves to `STOPPED_OUT`. Otherwise `OPEN`.

**Response**
```ts
Array<{
  id: string;
  symbol: string;
  timeframe: string;       // '15m' | '1h' | '4h' | '1d' (others left as PENDING_FILL/OPEN)
  action: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  createdAt: string;       // ISO
  expiresAt: string | null;
  entryFilledAt: string | null;
  status: 'PENDING_FILL' | 'EXPIRED_UNFILLED' | 'OPEN' | 'TARGET_HIT' | 'STOPPED_OUT';
  performanceStatus: 'correct' | 'failed' | 'pending';
}>
```

`performanceStatus` mapping for UI buckets:
- `TARGET_HIT` → `correct`
- `STOPPED_OUT`, `EXPIRED_UNFILLED` → `failed`
- `PENDING_FILL`, `OPEN` → `pending`

---

## 8. History

`HistoryController` — prefix `/analysis/history`.

### `GET /analysis/history/:coin`
**Path:** `coin` matches `/^[A-Z0-9]{2,15}$/`.
**Query:** `HistoryQueryDto`.
**Response**
```ts
{
  success: true;
  data: {
    symbol: string;
    total: number;     // total matching rows after filter
    count: number;     // rows returned in this page
    runs: CoordinatorRunRecord[];
  };
}

interface CoordinatorRunRecord {
  id: string;
  symbol: string;
  timeframe: string;
  regime: string;
  strategyRoute: 'SQUEEZE_BREAKOUT' | 'CONFLUENCE_CHECKLIST' | 'UNKNOWN';
  checklistStatus: string | null;
  totalScore: number | null;
  shouldInvokeAI: boolean;
  aiAction: 'LONG' | 'SHORT' | 'WAIT' | null;
  aiConfidence: number | null;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;     // ISO
}
```

**Errors:** `400` invalid symbol · `404` no rows · `500` DB.

---

## 9. Validation

`ValidationController` — prefix `/analysis/validate`.

### `GET /analysis/validate/:coin`
**Query:** `limit?: number` (1..500, default 100).
**Response**
```ts
{
  success: true;
  data: {
    symbol: string;
    window: number;
    summary: {
      actionCounts: Record<string, number>;
      regimeCounts: Record<string, number>;
      routeCounts: Record<string, number>;
      aiInvocationRate: number;    // 0..1
      errorRate: number;           // 0..1
      avgDurationMs: number;
      avgAiConfidence: number | null;
    };
    recentTriggers: CoordinatorRunRecord[];
  };
  timestamp: string;
}
```

---

## 10. Support / Resistance Levels

`LevelsController` — prefix `/analysis/levels`.

Shared shape:
```ts
interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;     // # of historical touches
}
```

### 10.1 `GET /analysis/levels/:coin`
**Query:** `timeframe?: '15m' | '1h' | '4h' | '1d'` (default `1d`).
**Response**
```ts
{
  success: true;
  data: {
    symbol: string;
    timeframe: string;
    currentPrice: number;
    levels: SupportResistanceLevel[];
    nearestSupport: SupportResistanceLevel | null;
    nearestResistance: SupportResistanceLevel | null;
  };
}
```

### 10.2 `GET /analysis/levels/:coin/full`
Adds Fibonacci, pivots, and zone analysis to the above payload (`SupportResistanceResponseDto`).

### 10.3 `GET /analysis/levels/:coin/nearest`
**Query:** `type?: 'support' | 'resistance'`.
Returns just the closest level above or below current price.

---

## 11. Risk Management

`RiskManagementController` — prefix `/analysis`. Every route is `@SkipThrottle()` (pure calculator endpoints, no upstream pressure).

### 11.1 `POST /analysis/position-size`
**Body** — `CalculatePositionSizeDto`
```ts
{
  accountBalance: number;   // >= 100
  riskPercentage: number;   // 0.5..5
  entryPrice: number;       // > 0
  stopLoss: number;         // > 0
  leverage: number;         // 1..20
}
```
**Response**
```ts
{
  success: true;
  data: {
    riskAmount: number;
    positionSize: number;
    margin: number;
    effectiveLeverage: number;
    liquidationPrice: number;
    liquidationDistance: number;   // %
    isValid: boolean;
    warnings?: string[];
  };
}
```

### 11.2 `POST /analysis/risk-reward`
**Body** — `CalculateRiskRewardDto` `{ entryPrice, stopLoss, tp1, tp2, tp3 }`.
**Response**
```ts
{
  success: true;
  data: {
    riskPerUnit: number;
    tp1: { reward: number; ratio: number; percentage: string };
    tp2: { reward: number; ratio: number; percentage: string };
    tp3: { reward: number; ratio: number; percentage: string };
    overall: number;         // weighted (TP1 20% / TP2 30% / TP3 50%)
    meetsMinimum: boolean;   // >= 1.5:1
    quality: 'poor' | 'fair' | 'good' | 'excellent';
  };
}
```

### 11.3 `GET /analysis/portfolio-allocation`
**Query:** `balance: number` (>= 100). Returns the 60/20/20 split (long / mid / short term) with per-bucket leverage caps and applicable timeframes.

### 11.4 `GET /analysis/leverage/:timeframe`
Returns `{ timeframe, min, max, recommended }` for the default profile.

### 11.5 `POST /analysis/leverage-recommendation`
**Body** — `RecommendLeverageDto`
```ts
{
  timeframe: string;
  checklistScore: number;       // 0..100
  atr: number;                  // >= 0
  currentPrice: number;         // >= 0
  stopLossPercentage: number;   // 0..100
  experienceLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tradeStyle?: 'swing' | 'day' | 'scalp' | 'ultra-scalp';
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  marketCycle?: 'bull' | 'bear' | 'ranging';
}
```
**Response**
```ts
{
  success: true;
  data: {
    recommended: number;
    conservative: number;
    moderate: number;
    aggressive: number;
    reasoning: string;
    adjustments: string[];
  };
}
```

### 11.6 `GET /analysis/leverage-constraints`
**Query:** `experienceLevel`, `timeframe`. Returns `{ experienceLevel, timeframe, min, max }`.

---

## 12. Shared Type Reference

```ts
// Strategy / regime
type StrategyRoute   = 'SQUEEZE_BREAKOUT' | 'CONFLUENCE_CHECKLIST';
type MarketRegime    = 'UPTREND' | 'DOWNTREND' | 'RANGING' | 'COMPRESSION' | string;

// Checklist tiers (totalScore buckets)
type ChecklistStatus = 'WATCHING' | 'TACTICAL_SETUP' | 'STRATEGIC_TRADE' | 'APEX_SETUP';

interface ChecklistCondition {
  name: string;
  passed: boolean;
  score: number;        // 0..20
  value?: number | string;
  threshold?: string;
  reason: string;
}

interface EntryChecklistResult {
  rsi: ChecklistCondition;
  qqe: ChecklistCondition;
  bollingerBand: ChecklistCondition;
  marketStructure: ChecklistCondition;
  supportResistance: ChecklistCondition;
  totalScore: number;   // 0..100
  conditionsMet: number;
  status: ChecklistStatus;
  passed: boolean;
  tradeType: 'long' | 'short';
  conditions: ChecklistCondition[];
}

// Coordinator pipeline output
interface CoordinatorAnalysisResult {
  symbol: string;
  timeframe: string;
  regimeResult: MarketRegimeResult;
  strategyRoute: StrategyRoute;
  squeezeSetup: SqueezeBreakoutSetup | null;
  checklistResult: EntryChecklistResult | null;
  shouldInvokeAI: boolean;
  reasoning: string;
}

// AI verdict (discriminated by `action`)
type ClaudeAnalysisResponse = ClaudeTradeAnalysis | ClaudeWaitAnalysis;

interface ClaudeTradeAnalysis {
  action: 'LONG' | 'SHORT';
  confidence: number;        // 0..1
  entry:     { price: number; reasoning: string };
  stopLoss:  { price: number; distance: string; method: string };
  takeProfit: {
    tp1: { price: number; gain: string };
    tp2: { price: number; gain: string };
    tp3: { price: number; gain: string };
  };
  leverage:  { recommended: number; rationale: string };
  riskReward: number;
  summary: string;
  reasoning: {
    strategyAnalysis: string;
    regimeContext: string;
    keyLevels: string;
    invalidation: string;
    risks: string;
  };
  warnings: string[];
}

interface ClaudeWaitAnalysis {
  action: 'WAIT';
  confidence: number;
  summary: string;
  reasoning: {
    strategyAnalysis: string;
    regimeContext: string;
    keyLevels: string;
  };
  warnings: string[];
}
```

### Prisma models touched

- **`CoordinatorRun`** — every modern pipeline + scanner persists here. Fields incl. `aiPayload Json?`, `expiresAt DateTime?`, `entryFilledAt DateTime?`.
- **`TradeAnalysis`** — legacy `/analysis/analyze` rows; consumed by `/analysis/performance(/:coin)`.

---

## 13. Error Model & Status Codes

| Code | Meaning |
| --- | --- |
| **200** | OK (including the `200` forced on `/portfolio-scan`) |
| **400** | DTO validation failure (Nest ValidationPipe). Body: `{ statusCode, message: string[], error }`. |
| **404** | Resource missing (e.g., no history for symbol). |
| **429** | Throttle exceeded. `Retry-After` header set by `@nestjs/throttler`. |
| **500** | Unhandled / upstream failure (DB, Binance, Claude). |

DTO-style responses (`AnalyzeResponseDto`, `PerformanceResponseDto`, etc.) embed errors as:
```ts
{ success: false, error: string }
```
instead of throwing — check `success` before reading `data`.

---

## 14. Throttle Matrix

`@nestjs/throttler` is enabled globally. Per-route overrides:

| Route | Limit / 60s | Notes |
| --- | --- | --- |
| `/health/*` | unlimited | Liveness / readiness |
| `/analysis/analyze` | 10 | Binance + Claude per call |
| `/analysis/multi-timeframe` | 20 | |
| `/analysis/bias/:coin` | 30 | Cheap |
| `/analysis/ai-analyze` | 5 | Claude-heavy |
| `/analysis/test-prompt` | unlimited | No external calls |
| `/analysis-coordinator/stream` | 10 | Long-lived SSE slot |
| `/analysis-coordinator/coordinate` | 20 | |
| `/analysis-coordinator/portfolio-scan` | 20 | 3× coordinator + optional Claude |
| `/analysis/performance(/:coin)` | unlimited | DB-only |
| `/analysis/performance/coordinator-runs/:symbol` | 30 | Kline-heavy |
| `/analysis/history/:coin` | 60 | DB |
| `/analysis/validate/:coin` | 60 | DB aggregations |
| `/analysis/levels/:coin` | 60 | |
| `/analysis/levels/:coin/full` | 30 | Fib + pivots |
| `/analysis/levels/:coin/nearest` | 60 | |
| All `/analysis/(position-size,risk-reward,portfolio-allocation,leverage/*,leverage-recommendation,leverage-constraints)` | unlimited | `@SkipThrottle()` — pure math |

---

## Appendix — Quick curl pack

```bash
# Health
curl http://localhost:3001/health

# Single-pass analysis
curl -X POST http://localhost:3001/analysis/analyze \
  -H 'Content-Type: application/json' \
  -d '{"coin":"BTC","timeframe":"4h"}'

# SSE pipeline
curl -N 'http://localhost:3001/analysis-coordinator/stream?coin=BTC&timeframe=1h'

# Non-streaming pipeline
curl -X POST http://localhost:3001/analysis-coordinator/coordinate \
  -H 'Content-Type: application/json' \
  -d '{"coin":"BTC","timeframe":"1h"}'

# Multi-timeframe portfolio scanner (smart TTL)
curl -X POST http://localhost:3001/analysis-coordinator/portfolio-scan \
  -H 'Content-Type: application/json' \
  -d '{"coin":"SOL","walletBalance":5000}'

# Smart-TTL evaluation of CoordinatorRun history
curl http://localhost:3001/analysis/performance/coordinator-runs/SOL

# Aggregate performance
curl 'http://localhost:3001/analysis/performance?limit=50'

# Risk sizing
curl -X POST http://localhost:3001/analysis/position-size \
  -H 'Content-Type: application/json' \
  -d '{"accountBalance":10000,"riskPercentage":1,"entryPrice":48000,"stopLoss":46560,"leverage":5}'
```
