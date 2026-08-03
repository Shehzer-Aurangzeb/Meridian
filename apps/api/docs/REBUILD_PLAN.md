# Meridian Rebuild Plan

**Document created:** May 30, 2026
**Build starts:** June 1, 2026
**Goal:** A working AI trading analysis system that produces actionable, profitable trade signals without requiring chart-reading skill from the user.

---

## Context: What Today Taught Us

Spent May 30 exploring the AI trading landscape — running mature projects, evaluating live traders, and stress-testing approaches. Key findings:

- **TradingAgents (multi-agent LLM framework)**: Produces excellent reasoning but costs ~$2 per analysis on Claude Haiku, breaks on rate limits, takes 20+ minutes. Not viable for daily trading.
- **Moss platform**: Demonstrated continuous composite signal scoring (vs binary checklists) and the "Evolution Loop" pattern for parameter tuning. Runs on Hyperliquid only — wrong execution venue for our Canadian context.
- **Live trader evaluation**: Reviewed 7 real traders' Hyperliquid performance. Identified one strong candidate (189% ROI, 76.7% win rate, 120 trades). Confirmed that real edge looks like: balanced long/short ratio, low fees, steady equity curve, ROI between 100-300%.
- **Current Meridian's failure mode**: Binary 5-point checklist produces "rare and bad" signals. Single timeframe per analysis. Single Claude call doing everything at once. No outcome tracking, no feedback loop.

The vision is correct (AI does the analysis, user trades manually on Kraken from Canada). The execution needs to be rebuilt.

---

## Core Architectural Decisions

### 1. Multi-agent pipeline (4 focused agents, not 1 monolithic call)

Each agent is a separate Claude API call with a specific system prompt and role. Same model, same endpoint, different prompts. No special "agent infrastructure" — just structured prompting orchestrated from the NestJS backend.

```
Agent 1 — Market Context Analyst
    ↓ (passes 3-sentence summary, not full report)
Agent 2 — Signal Scorer (continuous, 0-100)
    ↓ (summary)
Agent 3 — Bull vs Bear Debater (one call, both perspectives)
    ↓ (summary)
Agent 4 — Trade Planner (final decision + conditional setups)
    ↓
Result delivered to user
```

**Critical:** Summaries between agents, not full reports. This is what keeps tokens flat and cost under $0.15 per analysis. TradingAgents fails here — it passes everything forward and costs explode.

### 2. Multi-timeframe input as default

Every analysis fetches **15m / 1h / 4h / 1d** candles in parallel and computes indicators per timeframe. Agent 1 sees all four. HTF (4h/1d) provides bias, LTF (15m/1h) provides timing.

Replaces current single-timeframe approach which produces incoherent signals (e.g., 1h shows oversold while 4h is in strong downtrend = system can't reason about that).

### 3. Continuous composite scoring (replaces binary checklist)

Each of 5 signal dimensions outputs a continuous value in [-1, +1]:
- Trend (EMA alignment, ADX strength)
- Momentum (RSI, QQE)
- Mean Reversion (Bollinger position, distance to bands)
- Volume (OBV slope, volume-price correlation)
- Volatility (ATR expansion/contraction, bandwidth percentile)

Final score is weighted sum, not pass/fail conditions. RSI 39 vs 41 produces slightly different scores, not a 20-point cliff.

### 4. Conditional setups with live trigger monitoring

Output is never just "WAIT." Every analysis returns 1-2 conditional setups with:
- Trigger description (e.g., "4h close below 8.60")
- Current distance to trigger (percentage)
- Status: `LIVE_ARMED` | `TRIGGERED` | `INVALIDATED` | `FAR`
- Full trade plan (entry, SL, TP1/TP2/TP3, leverage)
- Invalidation condition

Solves the "AVAX problem": user no longer wonders if the trigger has already fired.

### 5. Live price vs last candle close (data freshness)

Every response distinguishes:
- `lastCandleClose` — what indicators were computed on
- `livePrice` — current ticker price (polled from Binance public API)
- `generatedAt` — when this analysis was produced
- `refreshRecommendedAt` — next significant candle close

Binance public market data API works from Canada even though trading doesn't. Execution still happens manually on Kraken.

### 6. Outcome tracking from day one

Every analysis written to database. After N candles forward (24-48 for 1h timeframe), a background job records what actually happened: did TP1 hit first, or SL? What was max favorable excursion?

**Without outcome tracking, no architecture improves over time.** This is non-negotiable.

---

## Phase Plan

### Phase 1: Multi-timeframe data layer (Week 1)

**Goal:** Replace single-TF fetch with parallel multi-TF context.

**Deliverables:**
- `MultiTimeframeContext` service that fetches 15m/1h/4h/1d in parallel
- Live price polling integrated (separate from candle data)
- `IndicatorsService.buildContext` runs per timeframe
- Output: typed `MultiTimeframeContext` object passed to coordinator

**Files affected:**
- New: `apps/api/src/market-data/multi-timeframe.service.ts`
- Modified: `apps/api/src/market-data/market-data.service.ts` (add live price method)
- Modified: `apps/api/src/analysis/services/analysis-coordinator.service.ts`

**No AI involved this week.** Pure data foundation. Verify with logging that we get clean indicator data for all 4 TFs in parallel under 2 seconds.

### Phase 2: Four-agent pipeline (Week 2)

**Goal:** Replace single Claude call with 4-agent orchestrator.

**Deliverables:**
- `MarketAnalystAgent` — reads multi-TF context, outputs market summary
- `SignalScorerAgent` — outputs continuous composite score 0-100 with breakdown
- `BullBearDebaterAgent` — one call producing both perspectives
- `TradePlannerAgent` — final decision with conditional setups
- New `AgentOrchestrator` service that runs them in sequence
- New response schema (the one designed in our planning session)

**Files affected:**
- New: `apps/api/src/ai/agents/` directory with one file per agent
- New: `apps/api/src/ai/agent-orchestrator.service.ts`
- Modified: `apps/api/src/ai/claude.service.ts` (becomes a low-level call wrapper)
- Replaced: `apps/api/src/analysis/services/checklist.service.ts` (logic absorbed into Signal Scorer)
- Replaced: `apps/api/src/analysis/services/market-regime.service.ts` (absorbed into Market Analyst)

**Cost target:** Each full analysis under $0.15 on Claude Haiku, under 2 minutes runtime.

**Validation:** Run on BTC, ETH, AVAX, SOL, ARB manually. Compare output quality to current Meridian.

### Phase 3: Outcome tracking (Week 3)

**Goal:** Build the feedback loop that makes everything else possible.

**Deliverables:**
- Add `tradeOutcome` table or extend `CoordinatorRun` with outcome columns
- Background cron job (or scheduled task) that runs every hour
- For each analysis older than N candles: fetch what price did, compute outcome
- Outcome metrics: TP1 hit / SL hit / chop, max favorable excursion (R-multiple), time to outcome
- Simple read endpoint to query outcomes by coin, timeframe, score tier

**Files affected:**
- Modified: `prisma/schema.prisma` (new fields or table)
- New: `apps/api/src/analysis/services/outcome-tracker.service.ts`
- New: scheduled job (NestJS Cron or similar)

**Validation:** After 1 week of running, query: "Of analyses with score > 70, what % had favorable outcomes?" If we can't answer this question with real data, this phase isn't done.

### Phase 4: Context injection / RAG memory (Week 4)

**Goal:** Each new analysis sees its own past work and outcomes.

**Deliverables:**
- Before calling Agent 1, fetch last 5 analyses for the same coin with their outcomes
- Inject summarized history into Agent 1's prompt
- Agent 1 now reasons with awareness: "Last time I called short here, I was wrong because..."
- No vector DB yet — just structured retrieval from Postgres by recency + similarity heuristics

**Files affected:**
- New: `apps/api/src/ai/services/analysis-history.service.ts`
- Modified: Market Analyst agent prompt
- Modified: Trade Planner agent prompt (also sees own past trades)

**Expected impact:** 30-50% better signal quality from this single change. The biggest leverage in the entire plan.

### Phase 5: Backtest harness + initial validation (Week 5-6)

**Goal:** Validate the system on historical data before risking real money.

**Deliverables:**
- `BacktestService` that replays historical candles through the full pipeline
- Strict look-ahead bias prevention (at candle N, agents only see candles 0..N)
- Score-only mode (skip AI calls for cheap iteration) and full-AI mode (expensive but accurate)
- Outcome scoring: MFE, TP1/SL-first, win rate by score tier
- Simple analysis script that aggregates and reports results

**Critical:** Replay 90 days of 1h candles for BTC, ETH, AVAX, SOL, ARB. We need to know win rate per regime, per score tier, per coin before any real money.

**Validation gate:** No real-money trading until backtest shows ≥55% win rate on signals with score > 70 over at least 90 days of data. This is non-negotiable.

### Phase 6: Reflection agent + lessons store (Month 2)

**Goal:** Active learning loop. System writes its own lessons.

**Deliverables:**
- New `ReflectionAgent` that runs after each completed trade outcome
- Compares the analysis's prediction vs actual outcome
- Writes a structured "lesson" (e.g., "When RSI > 75 on daily AND funding > 0.05%, long positions get squeezed in 73% of cases")
- Lessons stored in a `lessons` table with embeddings (pgvector)
- Future analyses retrieve semantically relevant lessons and inject into prompts

**Files affected:**
- New: `apps/api/src/ai/agents/reflection.agent.ts`
- New: `apps/api/src/ai/services/lessons.service.ts`
- New: pgvector setup in Postgres

**This is closer to real learning.** Not training Claude — building a knowledge base it queries.

### Phase 7: Parameter evolution / prompt tuning (Month 3+)

**Goal:** Automatically adjust agent prompts based on what works.

Inspired by Moss's Evolution Loop. Periodically (weekly):
- Group recent outcomes by signal-scoring weight configuration
- Identify which weight configs produced best risk-adjusted returns
- Adjust Signal Scorer's weights within bounded drift (±20-30%)
- Re-run forward, repeat

Not training a model. Just data-driven prompt parameter updates.

### Phase 8: Frontend (Month 3+)

Connect existing Next.js frontend to new backend. SSE streaming for real-time analysis. Display:
- Multi-TF context view
- Setup cards with trigger status
- Live price vs trigger distance
- Historical analyses + outcomes
- Outcome tracker dashboard (win rate over time)

Authentication via NextAuth + JWT. Per-user history, preferences.

---

## What We're Explicitly NOT Building (Yet)

- **Auto-execution** — analysis only. User executes manually on Kraken.
- **Real-time alerts** (Telegram/Discord) — Phase 9 if at all. Not needed for personal use.
- **Multiple users** — single user (you) until system proves itself.
- **Mobile app** — web is enough.
- **Copy trading features** — irrelevant to the core thesis.
- **Crypto wallet integration** — not trading on DEXes.

---

## Cost & Performance Targets

| Metric | Current Meridian | Target |
|--------|------------------|--------|
| Cost per analysis | ~$0.10-0.30 (1 call) | <$0.15 (4 calls with summaries) |
| Time per analysis | 15-17s (when AI fires) | <2 min total |
| Signals produced (daily) | Mostly WAIT | 1-3 conditional setups per coin per day |
| Multi-timeframe | No | Yes (4 TFs) |
| Outcome tracking | No | Yes (from Week 3) |
| Memory | No | Context injection by Week 4 |

**Monthly API cost estimate at 10 coins × 4 analyses/day on Haiku:**
10 × 4 × 30 = 1,200 analyses × $0.15 = **~$180/month at most.**
Likely lower with prompt caching and selective re-runs. Acceptable for the value.

---

## Success Criteria

By end of Month 2, the system must:

1. Produce 1-3 actionable setups daily on top 5 coins (BTC, ETH, AVAX, SOL, ARB), not WAIT-spam
2. Show ≥55% win rate on signals with score > 70 in backtest over 90 days
3. Cost under $200/month in total API spend
4. Produce trade plans understandable by someone who can't read charts
5. Track every analysis outcome with no manual intervention
6. Improve measurably from Phase 4 onward (compare win rate before/after context injection)

If by end of Month 2 we cannot meet criterion #2 (55% win rate in backtest), the architecture is wrong and we re-evaluate. No real money trading until this gate passes.

---

## Files & Code Affected Summary

**New files (Phase 1-4):**
- `apps/api/src/market-data/multi-timeframe.service.ts`
- `apps/api/src/ai/agents/market-analyst.agent.ts`
- `apps/api/src/ai/agents/signal-scorer.agent.ts`
- `apps/api/src/ai/agents/bull-bear-debater.agent.ts`
- `apps/api/src/ai/agents/trade-planner.agent.ts`
- `apps/api/src/ai/agent-orchestrator.service.ts`
- `apps/api/src/analysis/services/outcome-tracker.service.ts`
- `apps/api/src/ai/services/analysis-history.service.ts`

**Replaced/refactored:**
- `analysis-coordinator.service.ts` (becomes a thin facade over `AgentOrchestrator`)
- `claude.service.ts` (becomes a low-level Anthropic API wrapper)
- `checklist.service.ts` (logic absorbed into Signal Scorer)
- `market-regime.service.ts` (logic absorbed into Market Analyst)
- `squeeze-breakout.service.ts` (logic absorbed into Signal Scorer)

**Unchanged (mostly):**
- `BinanceService` (slight extension for live price)
- `IndicatorsService` (runs per-TF, otherwise same)
- `CoordinatorPersistenceService` (extended for outcomes)
- All risk management services (position sizing, leverage)
- SSE streaming infrastructure
- Existing API endpoints (response shape changes but URLs preserved)

---

## Open Questions for Later

- Should regime classification still exist as a discrete output, or is it implicit in the composite score?
- Do we need per-timeframe agents, or one Market Analyst handles all TFs in one call?
- When does the multi-agent debate (Bull/Bear) become a single call vs separate calls?
- Vector DB choice when we get to Phase 6 — pgvector vs ChromaDB vs Pinecone?
- Frontend tech for the trigger-status live updates — SSE (already have) vs WebSockets?

These get answered as we hit each phase.

---

## Reminders to Self

- **Outcome tracking is the single most important feature.** Without it, nothing else matters. Build it Week 3 even if other things slip.
- **Don't skip the backtest gate.** No real money until backtest validates the system.
- **Cost discipline.** If a phase pushes us over $200/month, redesign instead of accepting the cost.
- **The AI doesn't learn — the database does.** Memory lives in retrieval, not the model.
- **Personal use first.** Commercial path is 12-18 months away minimum. Don't optimize for it now.
- **Trade tiny when going live.** $50-100 per trade for the first month regardless of confidence.

---

*This document is a living plan. Update as phases complete or assumptions change. Keep at the repo root for visibility.*