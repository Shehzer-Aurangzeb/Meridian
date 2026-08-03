# Meridian v2 Development Plan

**Created:** June 1, 2026  
**Source:** REBUILD_PLAN.md analysis  
**Focus:** Terminal-first CLI → Backtesting → Production → Frontend

---

## 🎯 Core Objectives

1. **Terminal-first development** — CLI is the primary interface until system proves itself
2. **Cost optimization** — Target <$0.10/analysis via smart model routing
3. **Maximum reasoning quality** — 4-agent pipeline with focused prompts
4. **Outcome tracking from day one** — No blind iteration
5. **55% win rate gate** — No real money until backtest validates

---

## 💰 Cost Optimization Strategy

### Model Tiering (Smart Agent Routing)

| Agent | Model | Cost/1K tokens | Reasoning |
|-------|-------|----------------|-----------|
| Market Analyst | **Haiku** | $0.00025 | Pattern recognition, summary output |
| Signal Scorer | **Haiku** | $0.00025 | Math-heavy, structured JSON output |
| Bull/Bear Debater | **Haiku** | $0.00025 | Requires perspective, not deep reasoning |
| Trade Planner | **Sonnet 3.5** | $0.003 | Final decision = worth 12x cost |

**Estimated cost per analysis:**
- 3 Haiku calls × ~2K tokens = ~$0.0015
- 1 Sonnet call × ~3K tokens = ~$0.009
- **Total: ~$0.01-0.02 per analysis** (vs $0.15 target = 7-15x under budget!)

### Additional Cost Strategies

1. **Prompt caching** — Anthropic's cache for system prompts (saves 90% on repeated calls)
2. **Pre-filter with indicators** — Skip AI entirely when composite score < 30
3. **Tiered refresh** — Full analysis every 4h, indicator-only updates hourly
4. **Score-only backtest mode** — Use computed indicators to simulate scoring without AI

---

## 🖥️ Terminal App Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MERIDIAN TERMINAL                        │
├─────────────────────────────────────────────────────────────┤
│  Commands:                                                  │
│    analyze <coin> [--timeframe 1h]  Run full analysis       │
│    scan [--top 10]                  Scan top N coins        │
│    watch <coin>                     Live trigger monitor    │
│    backtest <coin> [--days 90]      Historical validation   │
│    outcomes [--coin BTC]            View outcome stats      │
│    history [--coin BTC]             Past analyses           │
│    config                           Edit settings           │
│    cost                             API spend tracker       │
└─────────────────────────────────────────────────────────────┘
```

### CLI Tech Stack
- **Commander.js** — Command parsing
- **Chalk** — Colorful output
- **Ora** — Spinners for async operations
- **cli-table3** — Beautiful tables
- **Inquirer** — Interactive prompts
- **Boxen** — Bordered boxes for results
- **Gradient-string** — Fancy headers

### Output Example (Target UX)

```
╔══════════════════════════════════════════════════════════════╗
║                    🎯 MERIDIAN ANALYSIS                      ║
║                     BTC/USDT • 1H • June 1, 2026             ║
╚══════════════════════════════════════════════════════════════╝

┌─ MARKET CONTEXT ────────────────────────────────────────────┐
│ Regime: TRENDING (ADX: 34.5)                                │
│ HTF Bias: BEARISH (4H/1D alignment)                         │
│ LTF Signal: Oversold bounce setup forming                   │
└─────────────────────────────────────────────────────────────┘

┌─ COMPOSITE SCORE ───────────────────────────────────────────┐
│                                                              │
│   Trend:       ████████░░  +0.72  (Strong bearish)          │
│   Momentum:    ███░░░░░░░  -0.35  (Oversold)                │
│   Mean Rev:    █████████░  +0.85  (Near lower band)         │
│   Volume:      ████░░░░░░  +0.42  (Accumulation)            │
│   Volatility:  ██████░░░░  +0.55  (Expanding)               │
│   ─────────────────────────────────────────────────         │
│   TOTAL:       72/100  [TACTICAL SETUP]                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─ CONDITIONAL SETUP ─────────────────────────────────────────┐
│ Direction: SHORT                                            │
│ Trigger: 4H close below $67,850                             │
│ Status: ⚡ LIVE_ARMED (1.2% away)                            │
│                                                              │
│ Entry:     $67,800 (on trigger confirmation)                │
│ Stop Loss: $69,200 (-2.1%)                                  │
│ TP1:       $66,500 (+1.9%) — Scale 30%                      │
│ TP2:       $65,200 (+3.8%) — Scale 40%                      │
│ TP3:       $63,800 (+5.9%) — Scale 30%                      │
│ Leverage:  3x (conservative for HTF trade)                  │
│ R:R:       2.8:1                                            │
│                                                              │
│ Invalidation: 4H close above $69,500                        │
└─────────────────────────────────────────────────────────────┘

┌─ AI REASONING ──────────────────────────────────────────────┐
│ "HTF structure bearish with lower highs on daily. Current   │
│ bounce looks like a retest of broken support at $68K.       │
│ Volume declining on this bounce suggests weak hands.        │
│ Wait for 4H confirmation before entry — don't front-run."   │
└─────────────────────────────────────────────────────────────┘

💰 Analysis cost: $0.018 | ⏱️ Time: 12.3s
```

---

## 📅 Phase Breakdown

### Phase 0: CLI Foundation (Days 1-2)
**Goal:** Terminal app skeleton with beautiful output

**Tasks:**
- [ ] Create `apps/api/src/cli/` directory structure
- [ ] Set up Commander.js with base commands
- [ ] Implement output formatters (tables, boxes, spinners)
- [ ] Create `analyze` command stub (mock data)
- [ ] Create `config` command for settings
- [ ] Add `cost` command for API spend tracking
- [ ] Test colorful output in terminal

**Deliverables:**
```
apps/api/src/cli/
├── index.ts              # Entry point
├── commands/
│   ├── analyze.ts
│   ├── scan.ts
│   ├── watch.ts
│   ├── backtest.ts
│   ├── outcomes.ts
│   ├── history.ts
│   └── config.ts
├── formatters/
│   ├── analysis-output.ts
│   ├── table-formatter.ts
│   ├── progress-spinner.ts
│   └── score-bar.ts
└── utils/
    ├── colors.ts
    └── cost-tracker.ts
```

**New package.json scripts:**
```json
{
  "scripts": {
    "cli": "ts-node src/cli/index.ts",
    "cli:analyze": "ts-node src/cli/index.ts analyze",
    "cli:scan": "ts-node src/cli/index.ts scan"
  }
}
```

---

### Phase 1: Multi-Timeframe Data Layer (Days 3-5)
**Goal:** 15m/1h/4h/1d parallel fetch with live price

**Tasks:**
- [ ] Create `MultiTimeframeService` with parallel fetches
- [ ] Add live price polling to `BinanceService`
- [ ] Create `MultiTimeframeContext` type
- [ ] Compute indicators per timeframe
- [ ] Add CLI logging to verify data quality
- [ ] Cache optimization (share 1h candles between 1h and 4h context)

**Key Type:**
```typescript
interface MultiTimeframeContext {
  symbol: string;
  livePrice: number;
  lastUpdate: Date;
  timeframes: {
    '15m': TimeframeContext;
    '1h': TimeframeContext;
    '4h': TimeframeContext;
    '1d': TimeframeContext;
  };
}

interface TimeframeContext {
  candles: Candle[];
  indicators: IndicatorValues;
  lastCandleClose: number;
  candleCloseTime: Date;
}
```

**CLI Output:**
```
$ pnpm cli analyze BTC --debug

⏳ Fetching multi-timeframe data...
  ✓ 15m: 250 candles (143ms)
  ✓ 1h:  250 candles (156ms)
  ✓ 4h:  250 candles (148ms)
  ✓ 1d:  250 candles (152ms)
  ✓ Live price: $67,842.50

📊 Indicator Summary:
┌──────────┬────────┬────────┬────────┬────────┐
│          │  15m   │   1h   │   4h   │   1d   │
├──────────┼────────┼────────┼────────┼────────┤
│ RSI      │  45.2  │  38.7  │  42.1  │  51.3  │
│ ADX      │  22.1  │  34.5  │  28.9  │  31.2  │
│ BB %     │  0.35  │  0.28  │  0.45  │  0.52  │
└──────────┴────────┴────────┴────────┴────────┘
```

---

### Phase 2: Continuous Composite Scoring (Days 6-8)
**Goal:** Replace binary checklist with continuous 0-100 scoring

**Tasks:**
- [ ] Create `CompositeScorer` service
- [ ] Implement 5 dimension scorers:
  - [ ] TrendScorer (EMA alignment, ADX)
  - [ ] MomentumScorer (RSI, QQE, rate of change)
  - [ ] MeanReversionScorer (BB position, distance)
  - [ ] VolumeScorer (OBV slope, volume-price correlation)
  - [ ] VolatilityScorer (ATR, bandwidth percentile)
- [ ] Configurable weights (default: equal 20% each)
- [ ] Score tiers: WATCHING (<40) | TACTICAL (40-69) | STRATEGIC (70-84) | APEX (85+)
- [ ] CLI visualization with score bars

**Score Calculation:**
```typescript
interface CompositeScore {
  total: number;           // 0-100
  tier: ScoreTier;
  breakdown: {
    trend: DimensionScore;
    momentum: DimensionScore;
    meanReversion: DimensionScore;
    volume: DimensionScore;
    volatility: DimensionScore;
  };
  direction: 'long' | 'short' | 'neutral';
  confidence: number;      // How aligned are all dimensions
}

interface DimensionScore {
  raw: number;             // -1 to +1
  normalized: number;      // 0-20 contribution to total
  reasoning: string;
}
```

**This phase is AI-FREE.** Pure math scoring. Fast, cheap, deterministic.

---

### Phase 3: Agent Pipeline (Days 9-14)
**Goal:** 4-agent orchestration with model tiering

**Tasks:**
- [ ] Create base `Agent` class with model selection
- [ ] Implement `MarketAnalystAgent` (Haiku)
- [ ] Implement `SignalScorerAgent` (Haiku) — enhances computed score with context
- [ ] Implement `BullBearDebaterAgent` (Haiku)
- [ ] Implement `TradePlannerAgent` (Sonnet)
- [ ] Create `AgentOrchestrator` with summary passing
- [ ] Add cost tracking per agent
- [ ] CLI progress display for each agent

**Agent Interface:**
```typescript
abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly model: 'haiku' | 'sonnet' | 'opus';
  abstract readonly systemPrompt: string;
  
  async run(input: TInput): Promise<AgentResult<TOutput>> {
    const startTime = Date.now();
    const response = await this.callClaude(input);
    return {
      output: this.parseResponse(response),
      tokens: response.usage,
      cost: this.calculateCost(response.usage),
      durationMs: Date.now() - startTime,
    };
  }
}
```

**CLI Output During Analysis:**
```
$ pnpm cli analyze BTC

🎯 Running Meridian Analysis for BTC...

  [1/4] 🔍 Market Analyst (Haiku)
        ✓ Completed in 2.1s | $0.0008
        Summary: "Bearish HTF structure, oversold LTF bounce"

  [2/4] 📊 Signal Scorer (Haiku)
        ✓ Completed in 1.8s | $0.0006
        Score: 72/100 (TACTICAL)

  [3/4] ⚔️  Bull vs Bear Debate (Haiku)
        ✓ Completed in 2.4s | $0.0009
        Verdict: Bears have edge (65% confidence)

  [4/4] 📋 Trade Planner (Sonnet)
        ✓ Completed in 4.2s | $0.0085
        Setup: SHORT @ trigger $67,850

─────────────────────────────────────────
Total: 10.5s | $0.0108
```

---

### Phase 4: Database Schema Update (Days 15-16)
**Goal:** New schema for multi-agent pipeline + outcomes

**Tasks:**
- [ ] Create new Prisma schema (or extend existing)
- [ ] Migration strategy (keep old tables, add new)
- [ ] `AnalysisRun` table (replaces `CoordinatorRun`)
- [ ] `ConditionalSetup` table (trigger tracking)
- [ ] `TradeOutcome` table (or columns on AnalysisRun)
- [ ] Indexes for common queries

**New Schema:**
```prisma
model AnalysisRun {
  id               String   @id @default(cuid())
  symbol           String
  
  // Multi-TF context snapshot
  livePrice        Float
  lastCandleCloses Json     // { "15m": 67800, "1h": 67750, ... }
  
  // Composite score
  totalScore       Int
  scoreTier        String
  scoreBreakdown   Json     // { trend: 0.72, momentum: -0.35, ... }
  direction        String   // long | short | neutral
  
  // Agent outputs
  marketSummary    String
  debateVerdict    String
  debateConfidence Float
  
  // Setups
  setups           ConditionalSetup[]
  
  // Cost tracking
  totalCost        Float
  totalDurationMs  Int
  agentCosts       Json     // { analyst: 0.0008, scorer: 0.0006, ... }
  
  // Outcome (filled later)
  outcomeStatus    String?  // pending | tp1_hit | sl_hit | expired
  outcomeFillTime  DateTime?
  maxFavorable     Float?   // Max R-multiple reached
  actualResult     Float?   // Final P&L in R
  
  createdAt        DateTime @default(now())
  
  @@index([symbol, createdAt])
  @@index([scoreTier, outcomeStatus])
}

model ConditionalSetup {
  id               String   @id @default(cuid())
  analysisId       String
  analysis         AnalysisRun @relation(fields: [analysisId], references: [id])
  
  direction        String   // long | short
  triggerType      String   // price_above | price_below | candle_close
  triggerPrice     Float
  triggerTimeframe String   // 4h | 1h
  
  entryPrice       Float
  stopLoss         Float
  tp1              Float
  tp2              Float
  tp3              Float
  leverage         Int
  riskReward       Float
  
  invalidationPrice Float
  invalidationReason String
  
  status           String   // armed | triggered | invalidated | expired
  statusUpdatedAt  DateTime?
  
  createdAt        DateTime @default(now())
  
  @@index([status, createdAt])
}
```

---

### Phase 5: Outcome Tracker (Days 17-19)
**Goal:** Automatic outcome recording for every analysis

**Tasks:**
- [ ] Create `OutcomeTrackerService`
- [ ] Cron job running every 30 minutes
- [ ] For each pending analysis older than N candles:
  - Fetch historical candles since analysis
  - Check if TP1, TP2, TP3, or SL was hit first
  - Calculate max favorable excursion (MFE)
  - Update `outcomeStatus` in database
- [ ] CLI command to view outcome stats
- [ ] Aggregate queries: win rate by tier, by coin, by direction

**CLI Outcomes Command:**
```
$ pnpm cli outcomes --last 30d

📊 OUTCOME STATISTICS (Last 30 Days)
════════════════════════════════════════════════════════════

Overall: 142 analyses | 89 triggered | 53 pending

┌─────────────┬─────────┬──────────┬─────────┬───────────┐
│ Score Tier  │ Signals │ Win Rate │ Avg MFE │ Avg R     │
├─────────────┼─────────┼──────────┼─────────┼───────────┤
│ APEX (85+)  │    12   │   75.0%  │  2.4R   │  +1.8R    │
│ STRATEGIC   │    34   │   61.8%  │  1.9R   │  +0.9R    │
│ TACTICAL    │    43   │   53.5%  │  1.4R   │  +0.3R    │
│ WATCHING    │     0   │    N/A   │   N/A   │    N/A    │
└─────────────┴─────────┴──────────┴─────────┴───────────┘

By Coin:
┌────────┬─────────┬──────────┬───────────┐
│ Coin   │ Signals │ Win Rate │ Total R   │
├────────┼─────────┼──────────┼───────────┤
│ BTC    │    28   │   64.3%  │  +12.4R   │
│ ETH    │    24   │   58.3%  │   +8.2R   │
│ SOL    │    19   │   52.6%  │   +3.1R   │
│ AVAX   │    11   │   54.5%  │   +2.8R   │
│ ARB    │     7   │   42.9%  │   -1.2R   │
└────────┴─────────┴──────────┴───────────┘
```

---

### Phase 6: Backtest Harness (Days 20-25)
**Goal:** Validate system on 90 days of historical data

**Tasks:**
- [ ] Create `BacktestService`
- [ ] Historical candle fetcher (batch download)
- [ ] Time-travel simulation (strict look-ahead prevention)
- [ ] Two modes:
  - **Score-only** (fast, free): Use computed scores only
  - **Full-AI** (slow, ~$0.01/analysis): Run complete pipeline
- [ ] Progress bar for long backtests
- [ ] Results aggregation and reporting
- [ ] Export to CSV for external analysis

**CLI Backtest Command:**
```
$ pnpm cli backtest BTC --days 90 --mode score-only

🔄 BACKTESTING BTC (90 days, score-only mode)
════════════════════════════════════════════════════════════

Downloading historical data...
  ✓ 2,160 hourly candles fetched

Running simulation...
  [████████████████████████████████████████] 100% (2,160/2,160)

📊 BACKTEST RESULTS
────────────────────────────────────────────────────────────

Period: Mar 3, 2026 → Jun 1, 2026
Total Signals: 156 (1.7/day avg)
Triggered: 134 (85.9%)

┌─────────────┬─────────┬──────────┬─────────┬───────────┐
│ Score Tier  │ Signals │ Win Rate │ Avg MFE │ Total R   │
├─────────────┼─────────┼──────────┼─────────┼───────────┤
│ APEX (85+)  │    18   │   72.2%  │  2.1R   │  +18.4R   │
│ STRATEGIC   │    42   │   59.5%  │  1.7R   │  +14.2R   │
│ TACTICAL    │    74   │   51.4%  │  1.2R   │   +4.8R   │
└─────────────┴─────────┴──────────┴─────────┴───────────┘

✅ GATE CHECK: STRATEGIC+ win rate = 63.3% (>55% required)
   System PASSES backtest validation gate.

Cost: $0.00 (score-only mode)
Time: 42.3s
```

---

### Phase 7: Context Injection / Memory (Days 26-30)
**Goal:** Agents see their own past work + outcomes

**Tasks:**
- [ ] Create `AnalysisHistoryService`
- [ ] Before Agent 1: fetch last 5 analyses for same coin
- [ ] Summarize past analyses with outcomes
- [ ] Inject into Market Analyst + Trade Planner prompts
- [ ] Track improvement in win rate with/without memory
- [ ] A/B test: 50% with memory, 50% without (for validation)

**Prompt Injection Example:**
```
PAST ANALYSES FOR BTC (last 5):

1. May 28: SHORT @ $68,200 (Score: 78, STRATEGIC)
   → Outcome: TP2 HIT (+2.1R) in 18h
   → What worked: HTF resistance held, volume confirmed

2. May 25: LONG @ $66,500 (Score: 65, TACTICAL)
   → Outcome: SL HIT (-1R) in 6h
   → Lesson: Entered against HTF trend, momentum faded

3. May 22: SHORT @ $69,100 (Score: 82, STRATEGIC)
   → Outcome: TP1 HIT (+1.2R) in 12h
   → What worked: Clean breakdown of support
   
[... continue ...]

Use these outcomes to inform your current analysis.
```

---

### Phase 8: Live Trigger Monitoring (Days 31-35)
**Goal:** `watch` command that monitors armed setups

**Tasks:**
- [ ] Create `TriggerMonitorService`
- [ ] Poll live price every 30s for watched coins
- [ ] Check each armed setup for trigger/invalidation
- [ ] Update setup status in database
- [ ] CLI `watch` command with live updates
- [ ] Optional: Desktop notifications on trigger

**CLI Watch Command:**
```
$ pnpm cli watch BTC ETH SOL

👁️  WATCHING 3 COINS (5 armed setups)
════════════════════════════════════════════════════════════

Live prices updating every 30s... (Ctrl+C to exit)

┌────────┬───────────┬───────────────┬──────────┬──────────┐
│ Coin   │ Direction │ Trigger       │ Distance │ Status   │
├────────┼───────────┼───────────────┼──────────┼──────────┤
│ BTC    │ SHORT     │ 4H < $67,850  │   1.2%   │ ⚡ ARMED  │
│ BTC    │ LONG      │ 1H > $68,500  │   2.1%   │ ⚡ ARMED  │
│ ETH    │ SHORT     │ 4H < $3,420   │   0.8%   │ ⚠️ CLOSE  │
│ SOL    │ LONG      │ 1H > $142.50  │   3.4%   │ ⚡ ARMED  │
│ SOL    │ SHORT     │ 4H < $138.00  │   0.3%   │ 🔥 IMMINENT│
└────────┴───────────┴───────────────┴──────────┴──────────┘

Last update: 14:32:45 | Next: 14:33:15
```

---

## 📋 Phase Summary

| Phase | Days | Focus | AI Cost | Key Deliverable |
|-------|------|-------|---------|-----------------|
| 0 | 1-2 | CLI Foundation | $0 | Beautiful terminal output |
| 1 | 3-5 | Multi-TF Data | $0 | Parallel 4-TF fetch + live price |
| 2 | 6-8 | Composite Scoring | $0 | Continuous 0-100 scoring |
| 3 | 9-14 | Agent Pipeline | ~$5 testing | 4-agent orchestration |
| 4 | 15-16 | Database Schema | $0 | New tables + migration |
| 5 | 17-19 | Outcome Tracking | $0 | Automatic outcome recording |
| 6 | 20-25 | Backtest Harness | ~$20 full mode | 90-day validation |
| 7 | 26-30 | Context Injection | ~$10 testing | Memory/RAG |
| 8 | 31-35 | Live Monitoring | $0 | Watch command |

**Total estimated dev cost:** ~$35-50 in API calls

---

## 🚀 Quick Start Commands

```bash
# After Phase 0
pnpm cli --help
pnpm cli config

# After Phase 1
pnpm cli analyze BTC --debug

# After Phase 3
pnpm cli analyze BTC
pnpm cli scan --top 10

# After Phase 5
pnpm cli outcomes --last 7d

# After Phase 6
pnpm cli backtest BTC --days 90

# After Phase 8
pnpm cli watch BTC ETH SOL
```

---

## ✅ Success Gates

| Gate | Criteria | When |
|------|----------|------|
| Data Quality | All 4 TFs fetch <2s, indicators match TradingView | End Phase 1 |
| Score Validity | Composite score correlates with market moves in eyeball test | End Phase 2 |
| Cost Target | Full analysis <$0.02 | End Phase 3 |
| Outcome Tracking | 100% of analyses have outcomes after 48h | End Phase 5 |
| **Backtest Gate** | **≥55% win rate on Score 70+ signals over 90 days** | **End Phase 6** |
| Memory Impact | Win rate improves ≥5% with context injection | End Phase 7 |

---

## 🔮 Future (Post-Validation)

- **Frontend Integration** (Month 3) — Connect Next.js to CLI-proven backend
- **Reflection Agent** (Month 3) — AI writes its own lessons
- **Alerting** (Month 4) — Telegram/Discord notifications
- **Parameter Evolution** (Month 4+) — Auto-tune scoring weights

---

*Start with `pnpm cli --help` and iterate from there.*
