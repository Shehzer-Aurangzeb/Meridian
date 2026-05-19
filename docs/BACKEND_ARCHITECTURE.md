# Meridian Backend — Architecture & Calculation Reference

> Verification packet for an external review. The goal of this doc is
> to give a reviewer (e.g. Claude) everything needed to validate the
> backend's mental model **and** the math behind every key decision the
> pipeline makes — without reading the source tree end-to-end.

---

## 1. Mental Model (One-Page Summary)

Meridian is a NestJS 11 backend that turns a single
`(symbol, timeframe)` pair into a structured trade decision. There is
**one orchestrator**, **one shared candle window**, and **two strategy
routes**:

```
SSE / POST   ──►  AnalysisCoordinatorService
                        │
                        ├── 1. Fetch 250 candles  (BinanceService, cached)
                        ├── 2. Build IndicatorContext (all baseline math, ONCE)
                        ├── 3. Classify regime    (MarketRegimeService)
                        │
                        ├── 4a. COMPRESSION ──►  SqueezeBreakoutService
                        │                         shouldInvokeAI = true
                        │
                        └── 4b. TRENDING or       ChecklistService
                                MEAN_REVERSION ─► (5-Point Confluence)
                                                  shouldInvokeAI = (status ≠ WATCHING)
                        │
                        └── 5. If shouldInvokeAI ──►  ClaudeService
                                (Claude Opus 4.7, route-aware prompt + validation)
                        │
                        └── 6. CoordinatorPersistenceService
                               fire-and-forget → CoordinatorRun table
```

Core invariants the reviewer should keep in mind:

1. **Single fetch, single context.** Candles and every baseline indicator
   (RSI, Bollinger Bands, ATR, ADX/DI, QQE, percentile bandwidth) are
   computed exactly once per pipeline run inside `IndicatorContext`.
   No downstream service re-fetches or re-computes.

2. **Regime is the master switch.** It deterministically picks the
   strategy route. The AI is never asked "is this a trade?" — it is asked
   to execute one of two clearly-specified playbooks.

3. **AI is fail-soft.** Any error inside the Claude call (network,
   timeout, parse failure, validation failure) returns a synthetic
   `WAIT` with confidence 0. The pipeline never throws because of the AI.

4. **Persistence is fail-soft.** All writes are fire-and-forget; a DB
   outage cannot break a live SSE stream.

5. **The frontend has two ways to invoke the same pipeline.**
   - `GET /analysis-coordinator/stream` → SSE with progress events
   - `POST /analysis-coordinator/coordinate` → synchronous JSON

---

## 2. Pipeline Stages In Detail

### Stage 1 — Fetch candles
- **Service:** `BinanceService`
- **Symbol:** Base symbol is auto-suffixed with `USDT` (`BTC` → `BTCUSDT`).
- **Window:** `ANALYSIS_CANDLE_LIMIT = 250`. Chosen so:
  - `MarketRegimeService` has ≥ 50 samples for bandwidth percentile,
  - `ChecklistService` has ≥ 100 closes for RSI Z-score,
  - `SqueezeBreakoutService` has ≥ 20 candles for HH/LL.
- **Cache TTLs:** candles 5 min, price 30 s, stale fallback 1 h.
- **Resilience:** 3 retries with exponential backoff (1 s, 2 s, 3 s).
  On total failure, return a stale cache snapshot if one exists.

### Stage 2 — Build `IndicatorContext`
- **Service:** `IndicatorsService.buildContext`
- Computes every baseline indicator from the candle window once and
  freezes the result. Downstream services consume the context — they
  never call back into `IndicatorsService` for anything that already
  lives on it.

### Stage 3 — Classify regime
See § 4.1.

### Stage 4 — Strategy route
- **COMPRESSION → Squeeze playbook** (§ 4.2).
  Always invoke the AI to execute a directional breakout decision.
- **TRENDING / MEAN_REVERSION → 5-Point Checklist** (§ 4.3).
  Invoke the AI only if the checklist is **not** in `WATCHING`.

### Stage 5 — AI execution (conditional)
See § 4.4. Claude is given a route-aware prompt and the response is
validated against a route-specific schema.

### Stage 6 — Persistence
See § 4.5. Every run (success or error) is written to `CoordinatorRun`
without blocking the response.

---

## 3. Public API Surface

### `GET /analysis-coordinator/stream`  (Server-Sent Events)
Throttle **10 req / 60 s per IP**. Query: `coin`, `timeframe`.

Event sequence, in order:
1. `FETCHING_DATA`         — emitted immediately on subscription
2. `REGIME_CLASSIFIED`     — after step 3 above
3. `AI_THINKING`           — only if `shouldInvokeAI === true`
4. `HEARTBEAT { ts }`      — every **15 s** while connected (keeps Nginx
   60 s / Cloudflare 100 s proxies from killing the stream)
5. `COMPLETE { payload }`  — terminal success
6. `ERROR    { error }`    — terminal failure

### `POST /analysis-coordinator/coordinate`
Throttle **20 req / 60 s per IP**. Body: `{ coin, timeframe }`. Runs the
exact same pipeline and returns one JSON document.

### Other read endpoints (frontend-facing)
| Method | Route                                       | Source                       |
|--------|---------------------------------------------|------------------------------|
| GET    | `/analysis/history/:coin`                   | `CoordinatorRun` table       |
| GET    | `/analysis/validate/:coin`                  | `CoordinatorRun` aggregation |
| GET    | `/analysis/levels/:coin`                    | candles → key levels         |
| GET    | `/analysis/levels/:coin/full`               | S/R + Fibonacci + pivots     |
| GET    | `/analysis/levels/:coin/nearest`            | nearest level lookup         |
| GET    | `/analysis/performance` / `/:coin`          | win-rate over recent runs    |

CORS is env-driven (`CORS_ORIGINS`, default `http://localhost:3000`).
Global throttler: 100 req / 60 s per IP.

---

## 4. Calculations to Verify

This is the section the reviewer should scrutinize most carefully —
every threshold and formula that drives a decision is listed here.

### 4.1  Market Regime Classification

`MarketRegimeService.classifyFromContext(ctx)` returns one of
`COMPRESSION | TRENDING | MEAN_REVERSION`. Rules evaluated **in order**:

1. **COMPRESSION:**
   - If we have ≥ **50** historical bandwidth samples AND current
     bandwidth is in the **bottom 15 %** of that distribution → `COMPRESSION`.
   - Fallback (insufficient history): if current bandwidth **< 1.5 %** → `COMPRESSION`.
2. **TRENDING:** else if `ADX > 25` → `TRENDING`.
3. **MEAN_REVERSION:** otherwise.

Inputs from context:
- `bandWidth` (current Bollinger bandwidth %),
- `bandWidthPercentile` (rank vs prior history, null if too few samples),
- `adx` (Wilder smoothed, period 14),
- plus `pdi`, `mdi`, `rsi`, `atr`, `bollingerBands` for downstream use.

**Reviewer check:** the 15th-percentile rule is the primary signal;
1.5 % strict is only a cold-start fallback. ADX 25 is the standard
Wilder threshold for "trending".

---

### 4.2  Squeeze Breakout Setup

`SqueezeBreakoutService.calculateBreakoutTriggersFromContext(ctx)` is
called when regime = `COMPRESSION`. It returns the breakout envelope —
**it does not enter a trade**; the AI confirms direction.

- **Lookback:** last `SQUEEZE_LOOKBACK = 20` candles.
- **Upper trigger:** highest high over the lookback.
- **Lower trigger:** lowest low over the lookback.
- **Volume baseline:** mean volume over the lookback.
- **Confirmation rule (carried into the prompt for the AI):**
  - **LONG:** candle **closes** strictly above `upperTriggerPrice` AND
    `volume > 1.5 × volumeBaseline`.
  - **SHORT:** candle **closes** strictly below `lowerTriggerPrice` AND
    `volume > 1.5 × volumeBaseline`.
  - Wicks alone do not qualify.

---

### 4.3  5-Point Confluence Checklist

`ChecklistService.evaluateChecklist(params)`. Five conditions, **20
points each, max 100**. Pure synchronous transform.

#### Condition 1 — RSI (20 pts)
Uses dynamic relative thresholds:

- **LONG passes if:** `rsi ≤ 40` **OR** `zScore ≤ -1.5`
- **SHORT passes if:** `rsi ≥ 60` **OR** `zScore ≥ +1.5`

Z-score is computed over the last `100` RSI samples
(`RSI_ZSCORE_CONFIG.LOOKBACK_PERIOD = 100`):

```
mean   = (Σ values) / n
stdDev = sqrt( Σ (vᵢ - mean)² / n )      // population stddev
zScore = (rsi - mean) / stdDev           // 0 if stdDev = 0
```

Implementation note: the mean is computed once and reused for the
variance pass (no double traversal).

#### Condition 2 — QQE Volume Bars (20 pts)
- **LONG passes if** `qqeColor === 'green'`
- **SHORT passes if** `qqeColor === 'red'`
- A transition from the opposite color is a bonus (reported in the
  reason string but does not double-score).

#### Condition 3 — Bollinger Band Extreme (20 pts)
Two hard requirements:

1. Bands must be **expanded**: bandwidth > **2 %** (`BB_MIN_WIDTH = 2`).
2. Price within **10 %** of the relevant band:
   - LONG: distance to lower band ÷ (middle − lower) ≤ 10 %
   - SHORT: distance to upper band ÷ (upper − middle) ≤ 10 %

#### Condition 4 — Market Structure (20 pts)
- **LONG passes if** structure = `HH/HL` (Higher High / Higher Low).
- **SHORT passes if** structure = `LH/LL` (Lower High / Lower Low).
- `ranging` and `unknown` always fail.

Structure is derived in `AnalysisCoordinatorService.buildChecklistInputs`:

```
mid       = (support + resistance) / 2
pivotIdx  = max(0, lastIdx - 20)

if currentPrice > mid AND highs[last] > highs[pivot]  → HH/HL
else if currentPrice < mid AND lows[last] < lows[pivot] → LH/LL
else                                                    → ranging
```

#### Condition 5 — Support/Resistance (20 pts)
Tiered credit:

- **Full credit (20 pts):** within **2 %** of a level with **≥ 3** touches.
- **Partial credit (15 pts):** within **1.5 %** of a level with
  **exactly 2** touches AND volume at touch ≥ **1.2 ×** the level's
  average touch volume.
- Otherwise **0 pts**.

#### Score → Tier
| Score   | Tier              | `shouldInvokeAI` |
|---------|-------------------|-----------------:|
| 0–39    | `WATCHING`        | **false**        |
| 40–59   | `TACTICAL_SETUP`  | true             |
| 60–79   | `STRATEGIC_TRADE` | true             |
| 80–100  | `APEX_SETUP`      | true             |

---

### 4.4  AI Execution (`ClaudeService`)

- **Model:** `claude-opus-4-7`
- **Max output tokens:** 8000
- **Prompt is route-aware** (`ClaudePromptService`):
  - SQUEEZE_BREAKOUT prompt includes the trigger prices, the
    `1.5 × volume` confirmation rule, and an explicit "wait for the
    close" instruction.
  - CONFLUENCE_CHECKLIST prompt includes the 5-point breakdown and
    requires a `conditionsMet` field in `"X/5"` format.

**Response validation** is performed per route:

| Action | Required fields                                                              |
|--------|-------------------------------------------------------------------------------|
| `WAIT`           | `confidence`, `summary`, `reasoning`                              |
| `LONG`/`SHORT` via **SQUEEZE_BREAKOUT** | full trade plan + `reasoning.keyLevels` |
| `LONG`/`SHORT` via **CONFLUENCE_CHECKLIST** | full trade plan + `conditionsMet` matching `^\d/5$` |

**Fail-soft contract:** API error, parse error, schema validation
error, or any thrown exception → `buildFallbackWait()` returns:

```
{
  action: 'WAIT',
  confidence: 0,
  summary: '<reason>',
  reasoning: { … },
  warnings: ['<reason>'],
  conditionsMet: undefined
}
```

The pipeline always emits `COMPLETE`; it never throws because of the AI.

---

### 4.5  Persistence (`CoordinatorPersistenceService`)

Every coordinator run is written to the **`CoordinatorRun`** Prisma
model (no longer the legacy `TradeAnalysis` table). Two entry points:

- `persist({ coordinatorResult, aiResponse, durationMs, errorMessage? })`
  for runs that reached the routing stage.
- `persistError({ symbol, timeframe, durationMs, errorMessage })`
  for failures that died before routing (regime = `UNKNOWN`,
  strategyRoute = `UNKNOWN`).

Both wrap the actual write in `.catch((err: unknown) => log)` — the
promise is consumed via `void`, and the calling controller does not
`await` it.

`CoordinatorRun` schema (key fields):

```
id              cuid
symbol          string
timeframe       string
regime          string   // COMPRESSION | TRENDING | MEAN_REVERSION | UNKNOWN
strategyRoute   string   // SQUEEZE_BREAKOUT | CONFLUENCE_CHECKLIST | UNKNOWN
checklistStatus string?  // WATCHING | TACTICAL_SETUP | STRATEGIC_TRADE | APEX_SETUP
totalScore      int?     // 0–100
shouldInvokeAI  boolean
aiAction        string?  // LONG | SHORT | WAIT
aiConfidence    int?     // 0–100
coordinatorPayload  Json
aiPayload           Json?
durationMs      int
errorMessage    string?
createdAt       DateTime
```

Indexes: `(symbol, createdAt)`, `(strategyRoute, createdAt)`,
`(aiAction, createdAt)`.

---

## 5. `tradeType` Derivation (used by checklist)

`AnalysisCoordinatorService.deriveTradeType(regimeResult, marketStructure)`
chooses long/short for the checklist:

1. `marketStructure === 'HH/HL'` → `long`
2. `marketStructure === 'LH/LL'` → `short`
3. else if `pdi > mdi`           → `long`
4. else if `mdi > pdi`           → `short`
5. else                          → `long`  (deterministic default)

This is the only place in the coordinator where a direction is picked
without AI input; SHORT setups are now reachable via the pipeline.

---

## 6. Risk Management (only used when called via `CompleteAnalysisService`)

The coordinator pipeline does **not** call risk management — it is
invoked separately by the legacy multi-timeframe flow when
`accountBalance` is provided.

### `PositionSizingService` — Miraj's 1–2 % rule

```
riskAmount          = accountBalance × (riskPercentage / 100)
stopLossDistance    = |entryPrice − stopLoss|
stopLossPercentage  = stopLossDistance / entryPrice × 100
positionSize        = riskAmount / (stopLossPercentage / 100)
margin              = positionSize / leverage
liquidationPrice    = entryPrice × (1 ± (100 / leverage) / 100)
                       // LONG: −, SHORT: +
```

Warnings raised by the service:
- margin > account balance (invalid)
- margin > 10 % of account (high capital use)
- stop-loss < 2 % (too tight) or > 15 % (too wide)
- liquidation crosses stop-loss (invalid)
- liquidation buffer < 5 % beyond stop (risky)
- leverage > 10 (very risky)

### `LeverageService` — recommended leverage
Caps by experience level (Miraj):
```
beginner: 3x   intermediate: 5x   advanced: 10x   expert: 20x
```
Base by timeframe:
```
1w 2x · 1d 2x · 12h 3x · 4h 5x · 1h 7x · 15m 10x · 5m 12x · 1m 15x
```
Adjustments applied in order: experience cap → checklist confidence
(`≥80` no-op, `60–79` × 0.8, `<60` × 0.5) → ATR-based volatility cut →
stop-loss proximity (liquidation must sit beyond the stop) → market
cycle modifier → risk tolerance (`conservative` × 0.6, `aggressive`
× 1.4, recapped to experience cap).

---

## 7. Performance Tracking

`PerformanceService` measures legacy `TradeAnalysis` rows (not
`CoordinatorRun`). Status per row:

- `WAIT` action                              → `neutral`
- age < 1 hour OR `currentPrice` missing     → `pending`
- stop-loss breached                         → `failed` (overrides entry check)
- LONG and `currentPrice ≥ entryPrice`       → `correct`
- SHORT and `currentPrice ≤ entryPrice`      → `correct`
- otherwise                                  → `failed`

Win-rate: `correct / (correct + failed) × 100` (neutral and pending
excluded from the denominator).

---

## 8. Infrastructure & Config

- **CORS:** `CORS_ORIGINS` (CSV), default `http://localhost:3000`.
  Methods GET/POST/PUT/PATCH/DELETE/OPTIONS. Credentials on.
  `maxAge = 86_400`.
- **Throttling:** global `100 / 60 s` per IP. Overrides as listed in
  § 3. Test env raises the limit to 10 000 / 60 s.
- **Caching:** in-memory `cache-manager` (TTL 5 min, max 500 items).
- **Cache telemetry:** `CacheTelemetryService` uses Node
  `AsyncLocalStorage` so concurrent requests cannot pollute each
  other's hit/miss counters. `CompleteAnalysisService` derives
  `meta.cacheHit` and `meta.dataFreshness` from the scoped stats.

### Required environment variables
| Var                       | Purpose                       |
|---------------------------|-------------------------------|
| `DATABASE_URL`            | PostgreSQL connection         |
| `ANTHROPIC_API_KEY`       | Claude API key                |
| `CORS_ORIGINS`            | CSV of allowed origins        |
| `BINANCE_TIMEOUT_MS`      | candle fetch (default 30000)  |
| `BINANCE_PRICE_TIMEOUT_MS`| price fetch (default 10000)   |
| `PORT`                    | listen port (default 3001)    |

---

## 9. Things For The Reviewer To Specifically Sanity-Check

1. **Regime ordering.** COMPRESSION wins over TRENDING when both could
   match (e.g. a low-bandwidth trending pullback). Intended.

2. **Bandwidth cold start.** First ~50 candles of historical data
   silently fall back to the strict 1.5 % rule. Verify this is not
   masking false positives on illiquid alts.

3. **RSI Z-score lookback (100).** Confirm this is long enough to
   stabilise the mean on volatile altcoins.

4. **Bollinger Band Extreme.** "Within 10 %" is measured **from the
   band, normalised by the half-range (middle − band)**. Sanity-check
   this matches Miraj's playbook description.

5. **Market structure 20-candle pivot.** Hard-coded lookback. May want
   to scale by timeframe in the future.

6. **`tradeType` fallback.** Pure DI-spread breakers can flap. Watch
   for whipsaw on choppy markets.

7. **Claude fail-soft.** Verify no caller anywhere depends on the AI
   throwing on bad output — every consumer must handle
   `{ action: 'WAIT', confidence: 0 }`.

8. **Persistence does not block.** Confirm the SSE controller awaits
   nothing from the persistence service.

9. **`CoordinatorRun.coordinatorPayload`** is the full result object;
   `aiPayload` is `null` (DB `JsonNull`) when the AI is skipped.

10. **Stale-cache fallback** silently serves data up to 1 hour old on
    Binance failure. Confirm this is acceptable for trade decisions.
