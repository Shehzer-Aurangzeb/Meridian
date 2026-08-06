# Meridian — State of Play

**Written:** 1 Aug 2026 · **Verified against:** working tree on `main` (commit `b93bac6` + ~5.8k lines uncommitted)

One line: **you give it a coin + timeframe, it fetches Binance candles, computes indicators, decides which strategy applies, optionally asks Claude for a trade plan, and stores the run.**

---

## 1. Mental model

```
                       POST /analysis-coordinator/coordinate   (sync JSON)
                       GET  /analysis-coordinator/stream       (SSE + progress)
                       POST /analysis-coordinator/portfolio-scan (1d+4h+1h, + risk sizing)
                                          │
                                          ▼
                          ┌───────────────────────────────┐
                          │  AnalysisCoordinatorService   │  the only orchestrator
                          └───────────────────────────────┘
                                          │
   ┌──────────────────────────────────────┼──────────────────────────────────────┐
   ▼                                      ▼                                      ▼
1. FETCH                            2. BUILD CONTEXT                       3. CLASSIFY
BinanceService                      IndicatorsService                      MarketRegimeService
250 candles, cached 5m,             .buildContext() — RSI, BB,             reads bandwidth %ile
3 retries, 1h stale fallback        ATR, ADX/DI, QQE, bandwidth            + ADX off the context
                                    series. Computed ONCE, frozen.
                                                                                  │
                          ┌───────────────────────────────────────────────────────┤
                          ▼                                                       ▼
                  regime = COMPRESSION                          regime = TRENDING | MEAN_REVERSION
                          │                                                       │
                          ▼                                                       ▼
              SqueezeBreakoutService                                   ChecklistService
              20-candle HH/LL envelope                                 5 conditions × 20 pts
              + 1.5× volume rule                                       → WATCHING / TACTICAL /
              always shouldInvokeAI                                      STRATEGIC / APEX
                          │                                                       │
                          └────────────────────────┬──────────────────────────────┘
                                                   │  shouldInvokeAI?
                                                   ▼
                                          ClaudeService  (claude-opus-4-7, 8k tokens)
                                          route-aware prompt → validated JSON
                                          any failure → synthetic WAIT, never throws
                                                   │
                                                   ▼
                                    CoordinatorPersistenceService
                                    fire-and-forget → CoordinatorRun table
                                    (+ expiresAt smart TTL)
                                                   │
                        ┌──────────────────────────┴──────────────────────────┐
                        ▼                                                     ▼
              READ ENDPOINTS                                        PerformanceService
              /analysis/history/:coin                               replays real candles vs
              /analysis/validate/:coin                              stored entry/SL/TP1 →
              /analysis/levels/:coin[/full|/nearest]                PENDING_FILL / OPEN /
              /analysis/performance[/:coin]                         TARGET_HIT / STOPPED_OUT
```

Separate, **not** in the coordinator path: `RiskManagementModule` (position sizing, leverage) — only called by `portfolio-scan` and the legacy `/analysis/complete` flow.

---

## 2. Repo map — one line each

### `apps/api` (NestJS 11, port 3001) — 13.2k lines

| Path | What it does |
|---|---|
| `analysis-coordinator/analysis-coordinator.service.ts` | The orchestrator: fetch → context → regime → route. |
| `analysis-coordinator/analysis-coordinator.controller.ts` | 3 entry points: SSE `stream`, `coordinate`, `portfolio-scan`. |
| `analysis-coordinator/multi-timeframe-scanner.service.ts` | **Uncommitted.** Runs 1d/4h/1h in parallel, 1d = macro bias, 1h-then-4h = execution horizon, sizes the position, sets a TTL. |
| `analysis-coordinator/coordinator-persistence.service.ts` | Fire-and-forget write of every run to `CoordinatorRun`. |
| `market-data/market-data.service.ts` | Binance klines + ticker; 5min candle cache, 30s price cache, 1h stale fallback, 3 retries. |
| `market-data/cache-telemetry.service.ts` | Per-request hit/miss counters via `AsyncLocalStorage`. |
| `indicators/indicators.service.ts` | All the math: RSI, BB(20,2), ATR, ADX/±DI, QQE, bandwidth series + percentile, S/R, key levels. |
| `market-regime/market-regime.service.ts` | COMPRESSION (bandwidth in bottom 15%) → TRENDING (ADX>25) → else MEAN_REVERSION. |
| `squeeze-breakout/squeeze-breakout.service.ts` | 20-candle high/low breakout triggers + volume baseline. Does not enter, just arms. |
| `analysis/services/checklist.service.ts` | The 5-point confluence score (RSI / QQE / BB extreme / structure / S-R). |
| `analysis/services/support-resistance.service.ts` | Swing-point S/R clustering, touch counting, Fibonacci, pivots. |
| `analysis/services/multi-timeframe.service.ts` | **Legacy.** Old 1h/4h/12h/1d HTF-bias flow, 1.1k lines, superseded by the scanner. |
| `analysis/services/complete-analysis.service.ts` | **Legacy.** Old one-shot flow that bundles MTF + risk + AI. |
| `ai/ai.service.ts` | Claude call, response parse, per-route schema validation, fail-soft WAIT fallback. |
| `ai/ai-prompt.service.ts` | 900 lines of prompt building — separate templates for squeeze vs checklist vs legacy. |
| `risk-management/services/position-sizing.service.ts` | 1–2% risk rule → position size, margin, liquidation price, warnings. |
| `risk-management/services/leverage.service.ts` | Leverage cap by experience → score → ATR → stop proximity → cycle → tolerance. |
| `performance/performance.service.ts` | **Closest thing to a backtest today:** replays real candles against stored runs to detect fill, then TP1-vs-SL. |
| `prisma/schema.prisma` | Two tables: `CoordinatorRun` (live) and `TradeAnalysis` (dead legacy). |

### `apps/web` (Next.js 14, port 3000)

| Path | What it does |
|---|---|
| `app/(dashboard)/*` | 6 pages: dashboard, analysis, history, alerts, strategies, settings. |
| `app/api/*` | **Uncommitted.** BFF proxy routes so the browser never sees the backend URL. |
| `lib/hooks/use-*.ts` | **Uncommitted.** React Query hooks wrapping the BFF routes. |
| `lib/utils/*-mapper.ts` | **Uncommitted.** 600 lines mapping backend payloads → UI types. |
| `lib/feature-flags.ts` | **Uncommitted.** Dashboard/analysis/history ON; alerts/strategies/settings OFF (no backend). |
| `lib/api/generated/schema.ts` | OpenAPI types generated from `/docs-json`. |

---

## 3. Where things actually stand

| | Status |
|---|---|
| Typecheck | ✅ clean (`tsc --noEmit`, exit 0) |
| Unit tests | ✅ **124 passing, 5 suites** (was 110 pass / 12 fail — see §4) |
| Postgres | ❌ not running (Docker daemon down, port 5433 closed) |
| API server | ❌ not running; **won't boot without Postgres** (`PrismaService.onModuleInit` calls `$connect()`) |
| Terminal testing | ⚠️ `test/manual/run-analysis.ts` exists but hits the *legacy* endpoints and needs a live server. No CLI. |
| Backtesting | ❌ **does not exist.** Forward evaluation exists; historical replay does not. |
| Frontend | 🟡 3 of 6 pages wired to real data; alerts/strategies/settings/watchlist still on hardcoded mocks. |
| Git | ⚠️ 54 files uncommitted, ~5.8k insertions. Two migrations staged but unapplied to any running DB. |

---

## 4. Bugs found — and they explain the "no signals ever" problem

> **Status: fixed 1 Aug 2026.** Guards live in
> `apps/api/src/analysis-coordinator/checklist-wiring.spec.ts`. Both fixes were
> verified to fail against the pre-fix behaviour before being accepted:
>
> | | Before | After |
> |---|---|---|
> | `rsiHistory` max value | 30150 (prices) | ≤ 100 (RSI) |
> | BB band proximity | exactly 50.0% every run | varies with price |
> | RSI Z-score | −89.7 | −7.5 |


The May 30 rebuild plan concluded *"binary 5-point checklist produces rare and bad signals"* and proposed replacing the whole thing. **That diagnosis looks wrong.** The checklist isn't producing bad signals because it's binary — it's producing bad signals because 3 of its 5 inputs are wired incorrectly.

**A. The checklist is fed the 20-period SMA as "current price."**
`analysis-coordinator.service.ts:186` — `const currentPrice = bollingerBands.middle`.

- **Condition 3 (Bollinger extreme) can never pass, at all.** Proximity is `(price − lower) / (upper − lower)`. Bands are symmetric around the middle, so feeding it the middle yields *exactly 50%* every single time, against a 10% threshold. Permanently 0/20. The sample output saved in `BUILT_SO_FAR.md` says `"50% from upper"` — that's this bug, recorded and not recognised.
- Conditions 4 and 5 (structure, S/R proximity) are anchored to a lagging average instead of the real price, so they're skewed rather than dead.
- `BinanceService.getCurrentPrice()` exists and is never called by the pipeline.

**B. The RSI Z-score is computed against prices, not RSI values.**
`indicators.service.ts:577` sets `rsiHistory` to the last 100 **closes**. `checklist.service.ts:134` then computes `(rsi − mean(closes)) / stdDev(closes)`.

For BTC at ~$100k that's `(30 − 100000) / 1500 ≈ −66`. The saved sample shows `Z: -62.12` — a real Z-score can't be −62.

- LONG passes if `z ≤ −1.5` → **always true**, free 20 points on every long.
- SHORT passes if `z ≥ +1.5` → **never true**, so shorts silently fall back to strict `rsi ≥ 60`.

Both bugs carry a code comment saying the behaviour was "preserved verbatim" from the legacy implementation during a refactor. It was preserved faithfully — it was just already wrong.

**Net effect: max reachable score was 80/100, condition 3 was dead weight, and longs got a free 20 points that shorts didn't.** Every tier threshold in the system was tuned on top of that distortion — so the thresholds themselves are now suspect and should be re-tuned once the backtest exists.

**C. Dead code + stale tests in the prompt layer** *(fixed)*
`buildLegacyPrompt` was rewritten inline at some point, orphaning ~228 lines of prompt-builder methods (`buildStrategyRules`, `buildTaskInstructions`, `buildOutputFormat`, …) that nothing called. The 12 failing tests were asserting against that dead format. Deleted the dead code; rewrote the tests to assert the prompt *carries its data* (scores, direction, price, levels, JSON schema keys) instead of matching prose headers, so the next prompt edit doesn't break them.

**Known, not fixed:** the legacy prompt renders `**Status**: ✅ PASSED (need 60+ points)` for a score of 40 — the text still describes the old binary 60-point rule while the value comes from the newer 4-tier system. Only affects the deprecated legacy path, so I left it; it dies with that path.

---

## 5. Doc drift (what to distrust)

- `docs/BACKEND_ARCHITECTURE.md` §7 — says performance tracking uses `TradeAnalysis`. It was migrated to `CoordinatorRun` in the uncommitted work.
- `docs/BACKEND_ARCHITECTURE.md` §4.3 — says BB proximity is normalised by `(middle − band)`. Code uses `(upper − lower)`.
- `apps/api/docs/BUILT_SO_FAR.md` — says "backend is complete and production-ready," next step is auth. Superseded twice over; ignore it.
- `docs/MERIDIAN_REBUILD_PLAN.md` / `DEVELOPMENT_PLAN_V2.md` — the June rebuild (4-agent pipeline, outcome tracking, backtest harness, CLI) was **planned but never started.** Zero files from those plans exist.
- `docs/DEVELOPMENT_PLAN.md` — the original phase plan, fully superseded.

Five overlapping planning docs, three of them stale. That's the cleanup.

---

## 6. Findings from live runs

**D. The S/R level grid moves with price, so scores aren't reproducible.**
`IndicatorsService.identifyKeyLevels` snaps swing points onto a grid of spacing `currentPrice × 0.5%`, and `Math.round(price / zone) * zone` measures that grid **from zero**. Change the price, change the grid, change every level.

Observed across two `pnpm analyze BTC 1h` runs ~90 seconds apart:

| | run 1 | run 2 |
|---|---|---|
| last close | $63,463.36 | $63,420.01 (−0.07%) |
| nearest level | support, 4 touches | resistance, 1 test |
| condition 5 | 20 pts | 0 pts |
| **total** | **60/100 STRATEGIC_TRADE** | **40/100 TACTICAL_SETUP** |

A 0.07% price move swung the score 20 points. This is the "20-point cliff" the rebuild plan blamed on binary scoring — but the cause is unstable level clustering underneath it. A continuous scorer fed the same levels would wobble just as much.

Also note the level price equals the last close in both runs: because the grid is anchored to `currentPrice`, a level frequently lands at exactly 0% distance.

**Not fixing yet.** Two candidate fixes (anchor the grid to a fixed reference vs. cluster swings directly) and no way to choose without measurement. This is the first thing the backtest should settle.

**E. Two bandwidth thresholds disagree.**
The regime classifier calls COMPRESSION at bottom-15th-percentile bandwidth; the checklist rejects condition 3 below a flat 2%. BTC at 1.34% @ 26th pct falls between them: not compressed enough to route to squeeze, too narrow to score the BB condition. Max achievable score in that band is 80, not 100. Same verdict — measure, don't guess.

---

## 7. Validation method (how we'll know it works)

**Your current gate has a hole.** `≥55% win rate on score > 70` is not sufficient: a 55% win rate at 0.5R loses money, a 40% win rate at 3R prints. The gate must be **expectancy in R-multiples, net of fees and slippage**:

```
expectancy = (win% × avgWin_R) − (loss% × avgLoss_R)
```

Win rate stays as a secondary diagnostic, never the gate.

The stack, in order of how much trouble each one prevents:

1. **Look-ahead safety** — at candle *N* the pipeline sees only `candles[N-249..N]`, the same 250-candle window live uses. The pipeline is already pure given candles, so this is one slice, not a refactor.
2. **Walk-forward, not a single backtest** — rolling re-optimisation. Walk-Forward Efficiency >0.6 good, ~0.5 acceptable, <0.3 means overfit.
3. **Multiple-testing correction** — we will try many threshold combinations. Deflated Sharpe exists because trying 50 configs guarantees one looks great by luck.
4. **Out-of-sample holdout** — carve off the most recent 20% and don't look at it until the end.
5. **Costs modelled** — fees + slippage. "Survives at zero cost, dies at realistic cost" is the standard failure mode.

---

## 8. Research: skills & APIs (2 Aug 2026)

### Claude quant skills

[agiprolabs/claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills) — 255 stars, MIT, 67 skills. Relevant: `walk-forward-validation` (CPCV, overfit detection), `vectorbt`, `backtrader`, `strategy-framework`. Also [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills).

**Caveat: they're Python; our strategy is TypeScript.** Adopting `vectorbt` means reimplementing the strategy in a second language — two sources of truth that will silently diverge. Take the *methodology* from `walk-forward-validation` (language-agnostic), skip the library wrappers, keep the replay loop in TS against the real pipeline.

### APIs worth adding

| | Cost | Verdict |
|---|---|---|
| **Binance futures** — `/fapi/v1/fundingRate`, `/fapi/v1/openInterest`, `/futures/data/openInterestHist` | free, no key | **Take.** Funding extremes + OI trend are among the most predictive crypto signals, and it's the vendor we already call. Directly feeds the "crowd positioning" reasoning the prompt asks Claude for but gives it no data for. |
| **Live price** — `/api/v3/ticker/price` | free | Already implemented as `BinanceService.getCurrentPrice()` and **never called by the pipeline.** One line to wire up. |
| **Kraken OHLC** | free | Measure once. We analyse Binance and execute on Kraken — quantify the basis rather than assume it's zero. |
| CoinAPI / Coinglass / Glassnode / Kaiko | paid | Skip until free data is proven insufficient. |

---

## 9. First backtest results (2 Aug 2026)

`pnpm backtest <coin> <tf>` — replays 750 bars through the real pipeline, ATR exits, 0.6s/run.
Settings: stop ATR×1.5, target 2R, max hold 48 bars, cost 0.04R. Breakeven win rate at 2R = **33.3%**.

| coin | tf | span | signals | traded | win% | expectancy |
|---|---|---|---|---|---|---|
| BTC | 1h | 31d | 386 | 44 | 34.1% | −0.065R |
| BTC | 4h | 125d | 365 | 47 | 29.8% | −0.135R |
| ETH | 4h | 125d | 372 | 52 | 28.8% | −0.156R |
| SOL | 4h | 125d | 403 | 42 | 35.7% | +0.005R |

**Read: the strategy is currently a coin flip that pays fees.** Every result sits within noise of breakeven, three of four negative.

### The three findings that matter

**1. The score has almost no resolution.** Distribution over all checklist-routed bars (BTC 4h):

```
  0 │█████                                 8.8%
 20 │████████████████████████████████     53.6%
 35 │                                      0.3%
 40 │██████████████████████               36.0%
 55 │                                      0.7%
 60 │                                      0.7%
```

**89.6% of bars score exactly 20 or exactly 40.** Only 1.4% clear 40. The score takes six distinct values and is effectively binary — 1 condition passing vs 2. As a *ranking* signal it barely ranks. This is the rebuild plan's "binary checklist" complaint, now measured rather than asserted, and it's the strongest evidence yet for continuous scoring.

**2. The 40 threshold fires on ~half of all bars.** ~370–400 signals per 750 bars. That is not a selective strategy; TACTICAL_SETUP means "any 2 of 5 conditions," which is close to a permanent on-state. TACTICAL is also ~95% of trades and is consistently negative (−0.135, −0.181, −0.018).

**3. The tiers that were supposed to matter never fire.** APEX_SETUP: **0 occurrences** across all four runs. STRATEGIC_TRADE: 0–4 per run. The only positive expectancy anywhere sits in STRATEGIC at n=4 — statistically meaningless, but the ordering (STRATEGIC > TACTICAL) is at least the right sign.

### Widened to 10 coins (4h, 125 days each)

| coin | trades | win% | expectancy | total |
|---|---|---|---|---|
| ARB | 40 | 45.0% | **+0.255R** | +10.2R |
| ADA | 53 | 43.4% | **+0.225R** | +11.9R |
| SOL | 42 | 35.7% | +0.005R | +0.2R |
| DOGE | 44 | 34.1% | −0.061R | −2.7R |
| BTC | 47 | 29.8% | −0.134R | −6.3R |
| ETH | 52 | 28.8% | −0.155R | −8.1R |
| LINK | 47 | 29.8% | −0.163R | −7.6R |
| XRP | 53 | 26.4% | −0.233R | −12.4R |
| AVAX | 59 | 25.4% | −0.261R | −15.4R |
| BNB | 45 | 28.9% | −0.296R | −13.3R |
| **aggregate** | **482** | **32.7%** | **−0.090R** | **−43.5R** |

**482 trades, −0.090R/trade. No edge.** Breakeven needs 33.3%; the pooled win rate is 32.7%.

The per-coin spread (−0.296R to +0.255R) is **what noise looks like at n≈50**. With per-trade R scattered between −1 and +2, the standard error on a 50-trade mean is roughly ±0.2R — so ARB at +0.255R sits about 1.3 standard errors above zero, and BNB at −0.296R about 1.5 below. Neither is distinguishable from chance.

This is textbook multiple testing: run 10 coins on a zero-edge system and 3 will look profitable. **ADA and ARB are not discoveries.** Pooled across all 482 trades the aggregate is ~1.4 SE below zero — weakly negative, and certainly not positive.

Costs are only 0.04R of that, so gross expectancy is ≈ −0.05R. The system isn't being killed by fees; it has no edge to begin with.

### What this does NOT yet establish

- **n is small** (42–52 trades/run). Nothing here is significant.
- **One window, one regime.** No walk-forward, no out-of-sample holdout.
- **~40% of signals are unmeasured** — the squeeze route has no direction without Claude, so 136–161 signals per run were skipped and counted, not scored.
- **Exits are ATR proxies, not Claude's trade plans.** This measures whether the *score* predicts, which is the right first question, but it is not the full system.

---

## 10. Continuous scorer — experiment result: **hypothesis rejected**

`ContinuousChecklistService` (drop-in subclass of `ChecklistService`, same 5 conditions, same inputs, only the scoring function changed — so the A/B isolates "does resolution help?"). Run with `pnpm backtest x 4h --coins BTC,ETH,… --continuous`.

**The mechanism worked.** Score distribution went from 2 meaningful buckets to 10:

```
binary                        continuous
 20 │████████████ 53.6%        25 │█████████████ 22.1%
 40 │████████     36.0%        40 │██████████████████ 29.8%
 (4 other values, 1.4%)        (8 other buckets, 48%)
```

**The outcome did not.** Pooled over 10 coins, 125 days:

| scorer | trades | win% | expectancy |
|---|---|---|---|
| binary | 482 | 32.6% | −0.090R |
| continuous | 493 | 32.3% | −0.096R |

Identical within noise. **Resolution was not the binding constraint.**

### The decisive table — the score does not rank

Pooled, continuous scorer, by score bucket:

| bucket | n | win% | expectancy |
|---|---|---|---|
| 40–49 | 455 | 32.7% | −0.082R |
| 50–59 | 31 | 25.8% | **−0.307R** |
| 60–69 | 7 | 28.6% | −0.053R |

Higher score → *worse* outcome. Not monotonic, not even weakly. If the score carried information, this table would slope. It doesn't.

### Robustness: 9 exit configurations, all negative

| config | trades | expectancy |
|---|---|---|
| ATR×1.5, 2R, 48 bars (base) | 493 | −0.096R |
| target 1R | 696 | −0.139R |
| target 1.5R | 583 | −0.156R |
| target 3R | 407 | −0.149R |
| stop ATR×1 | 728 | −0.126R |
| stop ATR×3 | 216 | +0.015R |
| max hold 12 bars | 592 | −0.113R |
| max hold 120 bars | 487 | −0.087R |

The single positive (`ATR×3`, +0.015R at n=216) sits ~0.16 standard errors above zero — indistinguishable from a coin flip. **The result is not an artifact of one arbitrary exit rule.**

### Diagnosis

The problem is **the inputs, not the scoring function**. RSI, QQE, Bollinger position, market structure and S/R proximity — as computed here, on 4h crypto — carry no directional signal. Recombining them more smoothly recombines the same non-information.

**What this rules out (tested, not assumed):**
- Continuous scoring on its own ✗
- Tier-threshold tuning ✗ — no cut point helps a score that doesn't rank
- Exit-rule tuning ✗ — swept

**What it implies for the 4-agent rebuild:** the same logic applies. Four Claude calls reasoning over features that don't predict will still not predict. An LLM can improve *trade planning* (entry placement, sizing, risk narrative); it cannot manufacture signal that isn't in the inputs. The rebuild plan should not be started on the assumption that it fixes this.

**What's actually left:** new *information*, not new processing. Funding rate and open interest (free, Binance, §8) are the cheapest genuinely-new inputs available — they measure crowd positioning rather than re-reading price. That is the next experiment.

---

## 11. Paging → 21 months of data. Two conclusions change, one survives.

`BinanceService.getCandlesPaged()` walks backwards with `endTime` to beat the 1000-candle cap. Window went from 125 days to **21 months** (2024-11-15 → 2026-08-02), 37,500 test bars, 2,353 trades.

### ⚠️ Correction to §9 and §10

**The 125-day result was underpowered, and I stated its conclusion too strongly.** With 5× the data the sign flips:

| sample | trades | win% | expectancy |
|---|---|---|---|
| 125 days (§9, §10) | 493 | 32.3% | **−0.096R** |
| 21 months | 2,353 | 36.5% | **+0.027R** |

Standard error at n=2,353 is ≈0.030R, so **+0.027R is under 1 SE from zero — still not an edge.** But "the system has no edge, −0.090R" was a claim the 493-trade sample could not support. The honest statement then and now: *not distinguishable from zero.*

### What survived — the score still does not rank

| bucket | n | win% | expectancy |
|---|---|---|---|
| 40–49 | 2,217 | 36.7% | +0.036R |
| 50–59 | **120** | 32.5% | −0.110R |
| 60–69 | 16 | 31.3% | −0.117R |

This is the robust finding. It held through a 5× data increase, and the 50–59 bucket now has n=120 rather than 31 — still negative. **Higher score is not better.** APEX_SETUP still fired zero times in 37,500 bars.

Binary vs continuous also holds: +0.023R vs +0.027R. No meaningful difference.

### New trap: the short "edge" is market beta

| direction | n | expectancy |
|---|---|---|
| long | 1,173 | −0.028R |
| short | 1,180 | **+0.082R** |

Tempting. But over this exact window: **BTC −35.2%, ETH −44.1%, SOL −70.8%.** Shorting anything in a bear market wins. That is a directional bet that happened to be right, not an edge — and it would invert in a bull market.

This is why the window must be split by regime before any of these numbers are trusted.

### Standing conclusions

- Score doesn't rank → **new inputs, not new processing** (unchanged from §10)
- Continuous scoring alone doesn't help → confirmed at 5× data
- Overall expectancy → indistinguishable from zero, in either direction
- Any result from a single market regime is suspect until split

---

## 12. Walk-forward + overfit test — verdict: **not real**

Applied `trading-skills:walk-forward-validation`. Honest scoping first: classic walk-forward guards against *parameter* overfitting, and we have never fitted a parameter — every threshold is hardcoded. So two of its three components apply today:

| component | applies now | why |
|---|---|---|
| Fold stability | **yes** | is expectancy consistent, or one lucky stretch? |
| DSR (multiple testing) | **yes** | we ran ~21 configs; the best will look good by luck |
| Train/test + embargo | not yet | nothing is fitted. Wired up (`EMBARGO_BARS = 2 × max hold = 96 bars`, per the skill's crypto rule) for when we start tuning. |

Purging is implemented: a trade is assigned to the fold containing its **entry**, and dropped if its exit crosses the boundary (64 of 2,353 purged).

### Fold stability — 8 folds, ~468 bars each

| fold | n | win% | expectancy |
|---|---|---|---|
| 1 | 290 | 38.3% | +0.068R |
| 2 | 280 | 39.6% | +0.098R |
| 3 | 284 | 38.0% | +0.086R |
| 4 | 290 | 41.0% | **+0.170R** |
| 5 | 281 | 34.9% | +0.006R |
| 6 | 292 | 34.6% | −0.015R |
| 7 | 285 | 26.0% | **−0.272R** |
| 8 | 287 | 36.2% | +0.011R |

6/8 positive, **mean +0.019R, fold-to-fold spread (sd) 0.124R**. The spread is **6.5× the mean** — the aggregate is carried by folds 1–4 and nearly erased by fold 7 alone. That is what noise looks like, not an edge.

### Deflated Sharpe Ratio

| | |
|---|---|
| trades | 2,353 |
| mean | +0.0272R (std 1.414) |
| per-trade Sharpe | 0.0192 (skew +0.60, kurtosis 1.40) |
| null threshold (best of 21 trials) | 0.0394 |
| **DSR** | **0.162** — need ≥0.95 → **FAIL** |

Our Sharpe is *below* what the luckiest of 21 random strategies would be expected to produce. 

**To pass, we need a per-trade Sharpe of 0.073 — 3.8× current — i.e. ≈ +0.103R per trade vs today's +0.027R.** That is now a concrete target rather than a vibe.

> **Note on the skill's script:** `overfit_detector.py` compares the observed SR directly against `expected_max_sr` without scaling it by the SR standard error. Those are different units (per-trade SR ≈0.019 vs an unscaled expected-max of ≈1.92), so it returns a degenerate `dsr_pvalue = 0.0` for essentially any realistic input. Per López de Prado, SR₀ = √Var(ŜR) × E[max of N normals]. The 0.162 above uses the corrected scaling; the conclusion (FAIL) is the same either way.

### Standing verdict

Three independent tests now agree the current strategy has no demonstrable edge:
1. Score buckets don't rank (§10, §11)
2. Fold spread 6.5× the mean (§12)
3. DSR 0.162 vs 0.95 required (§12)

The target is quantified: **≈4× the current per-trade edge.** Threshold tuning cannot deliver that — the score doesn't rank at all, so no cut point helps. It has to come from new information.

---

## 13. Funding rate & open interest — result

**Open interest is untestable.** `futures/data/openInterestHist` retains only ~31 days (2026-07-02 → 2026-08-02 on probe). It cannot be validated over a 21-month window, so it was deliberately *not* wired in. Building on an input we can never backtest is how a fake edge gets shipped.

**Funding rate** is pageable over years and was added: `BinanceService.getFundingRates()`, forward-filled from 8h prints onto each bar, with a 90-period z-score. Measured *before* integrating — bucket existing trades by funding and see if it ranks.

| funding at entry | n | win% | expectancy |
|---|---|---|---|
| < −0.5bp (shorts pay) | 283 | 34.3% | −0.050R |
| −0.5…0.5bp (flat) | 981 | 36.5% | +0.032R |
| 0.5…2bp (mild long) | 1,042 | 37.6% | +0.065R |
| 2…5bp (crowded long) | **42** | 21.4% | −0.397R |
| > 5bp (very crowded) | **5** | 0.0% | −1.040R |

**`corr(funding, R) = 0.0021` over 2,353 trades.** No usable relationship.

The two extreme buckets look dramatic and match the theory (crowded longs → reversal), but they hold **47 of 2,353 trades (2%)**. The `n=5` bucket at −1.040R simply means all five lost. The 86% of trades in the middle two buckets differ by 0.033R — noise.

There is a structural problem beyond sample size: **extreme funding is rare by construction.** Even if real, it would fire a handful of times per year — a rare-event strategy, not the daily-signal product being built.

Also note shorts beat longs in *every* funding band. That's the same bear-market beta from §11, not funding.

---

## 14. ✅ BREAKTHROUGH — 1d timeframe, long-only, edge confirmed vs control

**Supersedes the pessimistic conclusion in §15.** Two things were wrong there: I tested only 1h/4h/15m, and I never measured the squeeze route. Both are now fixed.

### Result — 1d, 10 coins, 2018-04 → 2026-08 (8.3 years, multiple cycles)

| | n | win% | expectancy |
|---|---|---|---|
| TACTICAL_SETUP | 766 | 52.2% | +0.148R |
| SQUEEZE | 176 | 45.5% | −0.019R |
| **ALL** | **942** | **51.0%** | **+0.117R** |

Median cost 0.006R — negligible at 1d, because the stop is wide in percentage terms.

### It survives every test that killed the earlier results

| test | result |
|---|---|
| **DSR** (40 trials assumed) | **0.972** → PASS (≥0.95) |
| **Fold stability** (8 folds) | 7/8 positive, mean 0.090R vs spread 0.087R — mean ≥ spread for the first time |
| **Survivorship** | BTC+ETH only (top-2 in 2018, no hindsight): +0.122R, same shape |
| **Random control** | strategy longs +0.2373R vs random longs +0.0577R, **Welch t=2.88, p=0.0041** |

The random control is the important one. Random long entries with identical exits earn +0.058R — that is pure market drift. The strategy earns +0.237R. **The +0.18R difference is edge, not beta.**

### Two hard constraints

**1. Long-only.** Shorts are exactly zero (−0.008R over 462 trades). The edge does not reverse.

**2. Cost sets the timeframe floor.** `net = gross − (round-trip% ÷ stop%)`:

| timeframe | median cost | net | gross |
|---|---|---|---|
| 1d | 0.006R | **+0.117R** | +0.123R |
| 4h | 0.041R | −0.018R | +0.023R |
| 1h | 0.106R | −0.101R | +0.005R |
| 15m | 0.252R | −0.323R | −0.071R |

Shorter holds mean tighter stops, so the same fee eats a larger share of risk. **Going faster is strictly worse.** Cost levers (wider stops, maker orders) cut 0.25R → 0.03R, but they can't manufacture gross edge that isn't there at those horizons.

### Frequency comes from breadth, not speed

942 trades / 8.3 years / 10 coins ≈ **1 trade per coin every ~3.7 weeks**, or ~2/week across the basket.

To trade more often, **add coins, not shorter bars**:

| universe | approx trades/week |
|---|---|
| 10 coins | ~2 |
| 30 coins | ~6 |
| 100 coins | ~20 |

Same edge per trade, more opportunities. This is the answer to "I don't want it saying WAIT most of the time" — widen the universe rather than shorten the horizon.

---

## 14b. ⚑ DIAGNOSIS — we built a scanner; the playbook describes a level system

*Read `docs/MIRAJ ... PLAYBOOK.pdf` (116pp) end to end plus web research. **This is the most important section in this document. Start here tomorrow.***

**The core error:** Miraj's 5-point checklist is a **confirmation filter** applied *after* you've located a zone. We turned it into a **scanner** that fires whenever a score crosses 40.

| | Playbook / real traders | What we built |
|---|---|---|
| Trigger | price *arrives* at a pre-marked zone | score crosses 40 on some bar |
| Entry | limit orders inside the zone | market order at signal-bar close |
| Timeframes | 12h Fib → 4h S/R → 1h micro, hierarchical | one timeframe, all at once |
| Levels | drawn once, persist for weeks | recomputed every bar on a price-anchored grid |
| Stop | below zone − ATR (setup invalidation) | entry − 1.5×ATR (volatility only) |
| Targets | next resistance, then next, then major | entry + 2×risk (arbitrary) |
| Position | 3 scaled entries (20/40/40) | one entry, full size |
| Checklist | confirms a located trade | *generates* the trade |

### It explains every measurement we took

- **Score doesn't rank (§10–12)** — it was never meant to. It's a yes/no gate applied *after* location.
- **Fires on ~50% of bars** — we deleted the location requirement, which is what makes setups rare. Miraj's own frequency: **2–5 trades/month**, not 400.
- **Costs kill low timeframes (§14)** — market orders pay taker and get no price advantage. Resting limits at a level pay *maker* and fill better. That is the 0.25R → 0.03R swing, free.
- **Stops feel random** — ATR-only has no relationship to invalidation. Playbook stop = *below the zone* − ATR (wick protection).
- **2R targets underperform** — price stalls at levels, not at multiples of our risk.

### The piece never built at all: WAITING

Playbook Step 5 is literally *"Wait for price to reach zone."* We have no concept of a zone that exists, sits armed, and triggers later. Every run must decide *now*.

This is also exactly the product spec ("say why, and when to come back"). It falls out for free:

> **AVAX — not tradeable at $22.40.** Confluence zone $19.80–20.10 (0.5 Fib + 4h support + trendline). 11.6% below. Stop $19.20, TP1 $23.40. **Re-check within 2% of $20.10.**

The zone *is* the answer to "when."

### Missing in code
Fibonacci from HTF swings · trend lines (3+ touches, extended) · persistent level store with touch history · cross-timeframe confluence scoring · armed-zone state machine · level-based stops/targets · scaled entries.

**Already solid:** data plumbing, indicators, backtest harness, position sizing, risk management.

### Where we can beat the playbook
Hand-drawn S/R is subjective — which is also why our grid version was unstable (finding D). **Order blocks are objective**: the last opposing candle before a break of structure with displacement. Codeable and reproducible. Plus the thing no human does — run it across 200 coins every 12h, tracking every armed zone at once. The edge over a human trader is *coverage*, not better analysis.

### Next steps (specced, not built)
1. **Level engine** — swing detection → HTF Fib → order blocks → persistent store with touch counts
2. **Confluence scoring** — how many independent levels agree in a price band, across 12h/4h/1h
3. **Zone state machine** — `ARMED → APPROACHING → TRIGGERED → INVALIDATED`
4. **Level-based stops and targets** replacing ATR-multiple and 2R
5. **Backtest against the current version** — same harness, direct comparison

Note the §14 result (+0.117R, p=0.004) is a *degraded* version of this method — right indicators, wrong entry mechanics. If zone entries are genuinely better that number should improve, and the harness can now prove it rather than assume it.

---

## 14c. ⛔ RETRACTION — §14 does not survive clustered inference, and is not reproducible

*3 Aug 2026. External review (Kimi) flagged the independence assumption and the parameter count. Both objections land. Reproduce with the commands in this section — they are recorded here because §14's were not.*

### Finding 1 — §14's exact configuration was never written down, and cannot be recovered

Re-running 1d on the same 10 coins (`ARB,ADA,SOL,DOGE,BTC,ETH,LINK,XRP,AVAX,BNB`, `--limit 3300`) reproduces **nothing** in §14's table. Sweeping the stop width, which is the parameter §14's median cost of 0.006R implies was non-default:

| `--atr` | trades | expectancy | median cost | avg hold |
|---|---|---|---|---|
| 1.5 (default) | 1482 | +0.065R | 0.015R | 12.0 bars |
| 3 | 742 | **+0.194R** | 0.007R | 28.5 bars |
| 4 | 619 | +0.147R | 0.006R | 34.6 bars |
| 5 | 566 | +0.160R | 0.004R | 38.0 bars |
| §14 as recorded | **942** | **+0.117R** | 0.006R | — |

No setting lands on 942 trades or +0.117R. **§14's headline number is unreproducible**, and the true configuration is lost.

### Finding 2 — "zero fitted parameters" was false, which invalidates why we trusted §14

The claim that nothing is tuned was the entire reason §14's DSR of 0.972 was believable, and the reason external review said the result was worth building on. It does not hold: **stop width is a parameter, and expectancy varies 3× across it** (+0.065R → +0.194R). Target multiple (`--rr`), max hold, and squeeze arm window are three more. The 1d timeframe itself was selected *after* 4h/1h/15m failed.

So the honest trial count is well above the 40 assumed in §14's DSR, and the DSR must be recomputed against the real count before it means anything.

### Finding 3 — the p=0.0041 was an artefact of assuming trade independence

The harness's Welch t-test treats 942 trades as 942 independent observations. They are ten correlated assets over one window with overlapping holds. `test/manual/bootstrap.ts` resamples **whole calendar months** with replacement, which preserves both cross-coin and serial correlation. 10,000 resamples, longs only:

| config | strategy longs | random longs | **delta** | 95% CI on delta | P(≤0) |
|---|---|---|---|---|---|
| `--atr 1.5` | +0.125R (n=839) | +0.122R (n=491) | **+0.003R** | [−0.263, +0.166] | **0.61** |
| `--atr 3` | +0.365R (n=398) | +0.176R (n=376) | **+0.189R** | [−0.026, +0.368] | **0.055** |

**At default parameters the strategy's long edge over random longs is +0.003R — indistinguishable from nothing.** At the best swept configuration the delta is +0.189R but its confidence interval still includes zero, and that 0.055 is *before* any correction for having swept four stop widths to find it.

Random longs alone measure +0.176R at `--atr 3` with CI [−0.020, +0.394]. Market drift over this window is large and itself barely distinguishable from zero — which is precisely why the control was necessary.

### What actually replicates

- **Shorts are zero.** −0.003R to −0.068R across every configuration tested. Robust, and the one part of §14 that holds.
- **Cost scales inversely with stop distance**, exactly as modelled.
- **Funding is noise**: corr(funding, R) = −0.0035 over 1,333 trades at 1d, reconfirming §13 on a different window.

### One display bug found, no impact on results

The run header prints `runs[0].stats.span` — **coin #1's span only**, not the basket's. §14's "2018-04 → 2026-08, 8.3 years" was BTC's history; with ARB listed first the identical run prints "2023-11 → 2026-08". Pooled coverage *is* 2018-04 → 2026-08 (~100 distinct months), so the claim was true by accident. Per-coin: BTC/ETH from 2018-04, ADA 2018-12, BNB 2018-07, XRP 2019-01, LINK 2019-09, DOGE 2020-03, SOL 2021-04, AVAX 2021-05, ARB 2023-11. **The pre-2021 years rest on five coins, so "multiple cycles" is thinner than it reads.**

### Standing verdict after retraction

There is **no configuration of the current system with a demonstrated edge over random long entries.** The 1d result was the best of a parameter sweep, evaluated with a test that assumed independence it does not have.

This does not kill the §14b zone thesis — it removes the baseline the zone work was meant to beat. The bar is no longer "+0.117R"; it is **"beat random longs with month-clustered inference"**, which is harder and honest.

### Methodology rules added

6. **Record the exact command with every result.** A number whose configuration is lost is not a result. §14 cost us a day to discover was unreproducible.
7. **Never claim "no fitted parameters" without listing them.** Defaults in a harness are still choices; sweeping them is still fitting.
8. **Cluster-resample before believing any p-value.** The unit of evidence is the month, not the trade. `bootstrap.ts --self-check` verifies the estimator.
9. **A result that exists at only one parameter value is drift, not edge**, until shown otherwise. The `--atr 3` delta vanishing at `--atr 1.5` is the tell.

---

## 14d. ⛔ LIGHT ZONE TEST — the §14b hypothesis is refuted

*3 Aug 2026. Pre-registered, playbook parameters only, no sweep, month-clustered inference. Reproduce:*

```
npx ts-node test/manual/zonetest.ts --self-check
npx ts-node test/manual/zonetest.ts x 1d --coins ARB,ADA,SOL,DOGE,BTC,ETH,LINK,XRP,AVAX,BNB \
  --limit 3300 --csv zone.csv
npx ts-node test/manual/zonetest.ts x 1d --coins <same> --limit 3300 --random --csv zrand.csv
npx ts-node test/manual/bootstrap.ts zone.csv zrand.csv --direction long
```

### Parameters, all read from the playbook before the first run

| parameter | value | source |
|---|---|---|
| Fib ratios | 0 / 0.25 / 0.5 / 0.75 / 1.0 | p8 — **not** 0.236/0.382/0.618 |
| Fib anchor | swing low → swing high | p51 Step 1 |
| stop | zone low − **1.0**×ATR(14) | p17 — anchored to the *level*, not entry |
| target | first resistance above entry (TP1) | p14 |
| confluence | ≥2 levels within 0.5% | p53; 0.5% is the existing `SR_DEFAULTS` |
| arm window | 48 bars | ambiguous in playbook; fixed to the trade horizon |

Note three corrections to §14b's reading of the playbook: scaled entries are **20/20/60** (p11), not 20/40/40; the entry minimum is **3 of 5** conditions (p12), i.e. 60/100 — *above* the TACTICAL_SETUP tier of 40 we had been trading; and the ATR stop multiplier is **1.0**, not 1.5.

### Run 1 — with the playbook's 3/5 gate: unevaluable, and it exposed a third wiring bug

Zero trades from 1,101 zone arrivals. The funnel located the cause:

| stage | count |
|---|---|
| zones armed | 1,393 |
| price reached zone | 1,101 (79%) |
| expired unreached | 282 |
| **failed the 3/5 gate** | **1,100** |
| entered | **0** |

**735 of 839 checklist-routed arrivals were evaluated as `short` — while price was arriving at a *support* zone.** The checklist derives its own direction and disagreed with the zone 88% of the time. Consequently:

| condition | pass rate at zone arrival |
|---|---|
| RSI Condition | **0.0%** (0/839) — a short tests `rsi ≥ 60`; at support it is low |
| Bollinger Band Extreme | **0.0%** (0/839) — a short tests the *upper* band |
| Support/Resistance Confluence | **1.2%** (10/839) — while standing inside a confluence zone |
| QQE Volume Bars | 69.4% |
| Market Structure (HTF) | 86.1% |

Max achievable score at a zone arrival is therefore ~40/100. The playbook's own minimum entry requirement is **structurally unreachable** by our checklist. The 1.2% S/R rate is the clearest signal: the checklist's price-anchored grid (finding D) and the zone engine are two level systems that disagree almost totally.

**A confirmation filter must be told the direction of the setup it is confirming. Ours decides for itself, then vetoes.**

### Run 2 — location alone, gate removed (pre-registered before running)

Because run 1 was blocked by broken wiring rather than by evidence, the test was re-scoped to §14b's actual claim: does arriving at a pre-marked confluence zone beat entering at a random bar, given identical playbook exits? Long by construction, no gate.

| | n | win% | median RR | expectancy | 95% CI (month blocks) |
|---|---|---|---|---|---|
| zone arrival | 886 | 63.1% | 0.25 | **−0.180R** | [−0.231, −0.115] |
| random entry | 623 | 75.0% | 0.21 | −0.059R | [−0.109, −0.005] |
| **DELTA** | | | | **−0.121R** | **[−0.166, −0.046]** |

**The delta's confidence interval excludes zero on the negative side. Zone-arrival entries are significantly WORSE than random entries with identical exits.** Not "no edge" — negative edge. P(delta ≤ 0) = 1.0000 over 10,000 resamples of 95 months.

### Why this is a clean refutation

Both arms lose, because the level-to-level TP1 rule is degenerate as implemented: median RR 0.21–0.25 requires a **>80% win rate** to break even, and neither arm reaches it. That explains the levels of both results — but **not the delta**, because both arms share the identical exit rule. The delta isolates entry location, and location made outcomes worse.

The intuition is unkind but obvious in hindsight: price arriving at support on a daily chart is price *falling*, and buying it caps upside at a nearby resistance while leaving the full stop exposed. The 63.1% win rate is real and useless.

**One known implementation gap, which does not rescue the result.** Levels were taken as raw 2-bar swing pivots; the clustering + `MIN_TOUCHES ≥ 2` filter that `SR_DEFAULTS` and the playbook ("support that held multiple times", p52) both specify was not applied, so the level set is roughly 4–5× denser than a human would mark. A sparser set would widen TP1 for *both* arms. It cannot explain a negative delta, since the defect is shared. Testing it anyway would be a third run, which the pre-agreed stop rule forbids.

### Standing verdict

Three hypotheses have now been measured and none survives:

1. **Checklist-as-scanner** (§14, §14c) — no edge over random longs once inference respects month correlation.
2. **Checklist-as-confirmation-filter** (§14d run 1) — structurally unreachable; the filter is mis-wired.
3. **Zone-arrival location** (§14d run 2) — significantly *worse* than random.

The §14b diagnosis was a coherent story that fit every prior measurement, and it was wrong. That is what the harness is for.

**The prediction claim should be dropped.** What remains defensible is the part that never depended on forecasting: level identification, position sizing, risk management, regime *description*, and trade journalling — option D of §15, and §8(h) of the review brief. The measurement infrastructure (`backtest.ts`, `zonetest.ts`, `bootstrap.ts`) is the durable asset and it did its job: it killed three ideas in one day for $0.

---

## 14e. ⛔ CROSS-SECTIONAL MOMENTUM — no edge; loses to its own random control

*3 Aug 2026. Pre-registered, no sweep. First test built to output a **direction** (long or short) rather than long-only, and the first venue-agnostic one.*

```
npx ts-node test/manual/panel.ts --self-check
npx ts-node test/manual/panel.ts --out-dir <dir>          # builds/reuses panel_1d.json
npx ts-node test/manual/bootstrap.ts <dir>/panel_ls.csv <dir>/panel_flip.csv
npx ts-node test/manual/bootstrap.ts <dir>/panel_ls.csv <dir>/panel_long.csv
```

### Design

Rank the universe by trailing 30d return (skip 1d), **long the top decile, short the bottom decile**, equal weight, equal capital per leg, weekly rebalance. Universe = top 100 by trailing 30d median dollar volume, recomputed per rebalance date, from 399 Binance USDT pairs surviving mechanical filters (stablecoins, fiat, metals, leveraged tokens, tokenised equities).

The point of the market-neutral construction: **market drift cannot manufacture the result.** Every earlier section was ambiguous because "did the signal work" was entangled with "did crypto go up". Here the book is half long and half short at all times. It also gives shorts their only fair test — relative weakness against peers rather than fighting an uptrend.

Two bars, both pre-registered: beat a **random-direction** control (same position count, sides shuffled within the same eligible set) *and* beat **always-long**.

### Result — 166 weekly rebalances, 2023-04-22 → 2026-08-03

| book | mean/period | positive % | sd/period | Sharpe (ann) | turnover cost |
|---|---|---|---|---|---|
| long/short (strategy) | +0.081% | 51.2% | 4.38% | **0.13** | 0.067% |
| random direction | **+0.182%** | 48.8% | 2.47% | **0.53** | 0.128% |
| always long | −0.436% | 49.4% | 11.06% | −0.28 | 0.009% |

Month-clustered bootstrap, 10,000 resamples, 39 blocks:

| | point | 95% CI | P(≤0) |
|---|---|---|---|
| strategy | +0.0008 | [−0.0058, +0.0078] | 0.41 |
| **delta vs random direction** | **−0.0010** | [−0.0085, +0.0064] | **0.60** |
| delta vs always-long | +0.0052 | [−0.0120, +0.0220] | 0.33 |

**The strategy's point estimate is BELOW its random control.** It fails the primary bar outright, and clears neither bar significantly. Annualised Sharpe 0.13 is economically meaningless even taken at face value.

### Two findings worth keeping, neither about edge

**1. Breakeven round-trip cost is 0.309%,** at 48% weekly turnover. This is the venue-agnostic number the tool should carry: any strategy of this turnover needs sub-0.31% round-trip execution. At retail spot fees (~0.5–0.8% round trip) it is dead before the signal is even considered.

**2. The equal-weight top-100 altcoin universe lost 0.436% per week** across this window while majors rose. That is a structural drag, and it qualifies §14's "frequency comes from breadth" conclusion: **breadth into the long tail is not free.** More coins means fishing in a pond that bleeds, so a wider universe raises trade count and lowers per-trade quality at the same time.

### A bug found and fixed mid-run (worth recording)

The first run reported a window of 2022-06-16 → 2026-08-03. That was wrong. The date axis was built as the **union** of all coins' dates, and because every horizon in the file is expressed in array steps, it must be a contiguous calendar. It wasn't: the leading 179 slots were covered by exactly **one delisted coin (FTT)**, followed by a **127-day hole**. A "30-day" signal spanning that hole measured 157 days, and a "7-day" hold spanned months.

Fixed by `trimToContiguous`, which keeps the longest run of consecutive days covered by ≥20 coins and then asserts contiguity. Effective window became 2023-04-22 → 2026-08-03, 1,200 contiguous days. Also fixed: a coin with no print on its exit date now uses its last available close instead of being dropped from the basket, since dropping silently removes exactly the positions most likely to have collapsed.

The random control's estimate moved from −0.076% to +0.182% across that fix — purely a different RNG draw sequence. **A single random draw is itself a noisy benchmark**; averaging over many draws would be the better construction. It does not change the verdict, since the strategy sits below random either way.

### Caveats

- **Power is lower than earlier tests**: 39 month blocks vs 95–98, because the fetch was capped at 1,200 bars/coin for runtime. A modest real edge might not be detectable here.
- **Survivorship remains the biggest threat**: the universe is pairs listed *today*, so delisted coins are absent — inflating the long leg's pool and removing short-leg opportunities.
- Funding excluded (conservative for shorts). Daily closes only.

### Standing verdict after four hypotheses

| # | hypothesis | result |
|---|---|---|
| 1 | checklist as scanner | no edge vs random longs (§14c) |
| 2 | checklist as confirmation filter | structurally unreachable; mis-wired (§14d) |
| 3 | zone-arrival location | **significantly worse** than random (§14d) |
| 4 | cross-sectional momentum, long/short | no edge; below its random control (§14e) |

Four families, four negatives, measured in one day for $0. The measurement stack (`backtest.ts`, `zonetest.ts`, `panel.ts`, `bootstrap.ts`, all with self-checks) is what makes that possible and is the only thing here with demonstrated value.

---

## 14f. ⛔ FUNDING (positioning) — no edge · and a cashflow correction to §14e

*3 Aug 2026. The "final cheap shot" run. Pre-registered before execution.*

```
npx ts-node test/manual/panel.ts --self-check
npx ts-node test/manual/panel.ts --signal funding --out-dir <dir>
npx ts-node test/manual/bootstrap.ts <dir>/fund_ls.csv <dir>/fund_flip.csv
```

### Design

Perps have no literal term structure, so this tests the **cross-sectional positioning** read instead: rank by trailing 7-day mean funding and trade it **contrarian** — long the lowest-funding decile (crowded shorts), short the highest (crowded longs). Positioning data rather than price data, market-neutral, direction output. 360 of 399 coins had perp history.

Funding **slope** (whether crowding is building or unwinding) remains untested. One hypothesis per run.

### First run was invalid — it traded on funding without collecting it

The first pass reported **−0.593%/week, Sharpe −1.65**. That number is discarded. The strategy ranks on funding but the backtest never applied the funding *cashflow*, and shorting the highest-funding decile **receives** that funding. For the momentum test that omission was minor conservatism; for a funding strategy it is disqualifying — the entire −0.63% swing turned out to be the missing cashflow.

`holdFunding` now applies it to every arm. Because a short's return is exactly the negation of `price return − funding`, subtracting funding inside `basketReturn` makes all three arms correct with no other change. The self-check asserts the two directions separately: the **signal** looks backward and averages, the **cashflow** accrues forward and sums.

Storage bug behind it: funding was cached as the daily *mean*, which makes the daily *total* unrecoverable. Now stored as `{s, n}`.

### Result — funding, corrected, 166 weekly rebalances

| book | mean/period | Sharpe (ann) | turnover cost |
|---|---|---|---|
| long/short contrarian | +0.037% | 0.10 | 0.079% |
| random direction | +0.027% | 0.07 | 0.128% |
| always long | −0.485% | −0.32 | 0.008% |

Month-clustered delta vs random: **+0.0001, CI [−0.0051, +0.0053], P(≤0) = 0.48.** That is a coin flip. Funding positioning carries no cross-sectional edge. Breakeven round-trip cost 0.205%.

### ⚠️ Correction to §14e — the momentum point estimate moves to the right side

The same cashflow fix changes the momentum result, because it was run with funding excluded:

| | §14e as committed | corrected |
|---|---|---|
| strategy | +0.081%/wk | **+0.273%/wk** |
| random direction | +0.182%/wk | +0.183%/wk |
| always long | −0.436%/wk | −0.408%/wk |
| delta vs random | −0.0010 | **+0.0009** |
| CI | [−0.0085, +0.0064] | [−0.0065, +0.0078] |
| P(≤0) | 0.60 | **0.38** |

**This matters procedurally.** The decision to stop extending the momentum test was explicitly premised on the point estimate sitting *below* its benchmark. After a correctness fix — not a sweep, not a re-look — it sits above. That premise no longer holds and should not be relied on.

**It is still not an edge, on three independent grounds:**

1. **Not significant.** P(≤0) = 0.38, CI comfortably spans zero.
2. **Risk-adjusted it is WORSE than random.** Sharpe 0.45 vs random's 0.52 — momentum's higher mean comes with far higher volatility (4.35% vs 2.52% per period). For a book anyone would actually run, that is the relevant comparison and momentum loses it.
3. **The improvement leans on the least trustworthy part of the data.** Universe funding is strongly negatively skewed: median daily total **+0.0269%** but mean **−0.0166%**, with **77.1% of days positive.** So the mean is set by a fat negative tail, and the funding P&L that lifted momentum comes disproportionately from rare extreme episodes — precisely what is hardest to capture live (position limits, dislocations, borrow constraints).

### An unexpected empirical fact, worth recording

Momentum **winners** carried *negative* mean funding (−0.0138%/day) while **losers** were slightly positive (+0.0011%/day). Coins that had rallied were the ones with crowded *shorts paying longs* — a squeeze dynamic, the opposite of the naive "winners are crowded longs" assumption. This is why including funding helped both momentum legs, and it is a genuine description of this window regardless of whether any strategy exploits it.

### Standing verdict — five hypotheses

| # | hypothesis | result |
|---|---|---|
| 1 | checklist as scanner | no edge vs random longs (§14c) |
| 2 | checklist as confirmation filter | structurally unreachable; mis-wired (§14d) |
| 3 | zone-arrival location | **significantly worse** than random (§14d) |
| 4 | cross-sectional momentum, long/short | not significant; worse than random risk-adjusted (§14e, corrected here) |
| 5 | cross-sectional funding, contrarian | no edge; delta is a coin flip (§14f) |

Five families, five negatives. The pivot in `SYSTEMATIC_ANALYST.md` stands on the evidence.

---

## 14g. ⛔ SEQUENCED DIP→TURN — fires often, predicts nothing

The sequencing test (`b581e86`) proved the five checklist conditions are a
*sequence*, not a conjunction: read as "dip, THEN momentum turns," the same
conditions fire **314 times** (12.06/coin-year) where the simultaneous rule
fired **10** (0.38/coin-year). That fixed the frequency problem — it said
nothing about whether the signals are worth taking.

This is that measurement, and it is negative.

### Design — pre-registered in the harness header before the first run

Deliberately **no exit rule.** §14d showed a bad exit drowns the entry: a
0.25 reward/risk TP1 needs an >80% win rate just to break even, so the entry
could not be seen through it. And 2R is arbitrary — we chose it, not the
market. So this measures the **raw forward return** and leaves exit design to
a later step. Entry and exit are measured separately instead of confounded.

| | |
|---|---|
| signal | dip (RSI ≤ 40 AND within 10% of lower band), THEN QQE turns green within 20 bars |
| window | 20 bars — **not fitted.** Zero dips went stale and the median wait is 1 bar, so the cap never binds. A guard, not a parameter. |
| horizons | 5, 10, 20 bars. Declared together, reported together. |
| units | ATR at the entry bar — makes a 4% BTC move and a 12% alt move comparable |
| cost | 0.05% fee + 0.02% slip per side = 0.140% round trip, over ATR% (median 0.020R) |
| control | random long entries, matched count **per coin**, uniform without replacement over the same eligible bars |
| eligible | full indicator window, ATR > 0, largest horizon still ahead — identical set for both arms and all horizons |
| inference | month-clustered block bootstrap. No t-test. |

Signal definition extracted to `test/manual/signal.ts` so the frequency test
and the return test provably measure the same thing. Verified by re-running
`sequencing.ts` after the extraction: 314 / 10 / 0% band-proximity / 2.2%
HH/HL, identical to the committed run.

```
npx ts-node test/manual/forward.ts 1d \
  --coins ARB,ADA,SOL,DOGE,BTC,ETH,LINK,XRP,AVAX,BNB --limit 3300 \
  --out test/manual/results/step1-long
npx ts-node test/manual/bootstrap.ts test/manual/results/step1-long-signal-h20.csv \
  test/manual/results/step1-long-random-h20.csv --direction long
```

### Result — 672 signals, 24,206 bars, ~66 coin-years, 85 monthly blocks

| horizon | signal mean net | random mean net | delta | 95% CI | P(≤0) |
|---|---|---|---|---|---|
| 5 bars | +0.010R | +0.139R | −0.129R | [−0.181, +0.188] | 0.458 |
| 10 bars | −0.055R | +0.193R | −0.248R | [−0.418, +0.163] | 0.791 |
| 20 bars | +0.411R | +0.436R | −0.024R | [−0.431, +0.673] | 0.301 |

Every horizon includes zero. Two of three point estimates are negative. The
signal does not precede better returns than a coin flip at matched frequency.

### The reason both sample sizes were run — and why it matters

The first run used `--limit 1200` (matching the sequencing run) and gave only
**29 monthly blocks**, which cannot resolve an effect of this size. At 29
blocks the 20-bar delta was **+0.435R, P(≤0) = 0.068** — the first
positive-leaning number in this project.

At 85 blocks it is **−0.024R**. The lean was small-sample noise.

Same specification, same seed, same coins — only the history length changed.
This is recorded because the tempting move was to report the 29-block number
and call the longer run a robustness check. **29-block CIs on this data are
not informative and should not be quoted.**

### One distributional fact, which is an observation and not an edge

At 20 bars the signal beats random on the *middle* of the distribution and
loses the tail:

| | signal | random |
|---|---|---|
| median net | **+0.013R** | −0.202R |
| win % | **50.3%** | 45.7% |
| mean net | +0.411R | +0.436R |
| sd | 4.02 | 4.45 |

The signal wins slightly more often and more tightly; random longs win less
often but bigger. Identical means. This is a real difference in *shape*, and
it is worth remembering when an exit rule is eventually designed — a rule
that harvests the middle would treat these differently. It is not evidence of
predictive edge, and it was found after the fact.

### A generator bug found by the new self-check — affects earlier CIs

`bootstrap.ts` and the new harness both used this inline LCG:

```
s = (s * 1103515245 + 12345) & 0x7fffffff
```

In JavaScript this is badly non-uniform: `s * 1103515245` reaches ~2^61, past
the 2^53 where doubles are exact, so the product's low bits are rounding
artefacts — and `& 0x7fffffff` then keeps exactly those bits. Measured by the
new uniformity assertion: drawing 5-of-20 twenty thousand times gave bucket
counts from **369 to 1632** against an expected 1000. In a month-block
bootstrap that silently over-weights some months.

Replaced with mulberry32 (`test/manual/rng.ts`), all arithmetic through
`Math.imul` so it stays in exact 32-bit range. Still fully deterministic, so a
reported CI still reproduces from its seed.

**⚠️ Consequence for §14b–§14f:** every CI in those sections was computed with
the biased generator. The direction of the distortion is not knowable without
re-running, and the CSVs were not kept, so they cannot be re-bootstrapped
without re-running the generating harnesses. The §14g numbers above are the
only ones in this document computed with the fixed generator.

This does not change any decision: §14d's zone result reads either
"significantly worse than random" or "no better than random," and both say
*do not build it.* But **§14d's "CI excludes zero" should be treated as
unverified**, not as an established fact, until `zonetest.ts` is re-run.

### Standing verdict — six hypotheses

| # | hypothesis | result |
|---|---|---|
| 1 | checklist as scanner | no edge vs random longs (§14c) |
| 2 | checklist as confirmation filter | structurally unreachable; mis-wired (§14d) |
| 3 | zone-arrival location | worse than random — *significance unverified, see §14g* (§14d) |
| 4 | cross-sectional momentum, long/short | not significant; worse than random risk-adjusted (§14e) |
| 5 | cross-sectional funding, contrarian | no edge; delta is a coin flip (§14f) |
| 6 | sequenced dip→turn | fires 32× more often; no edge at any horizon (§14g) |

**What §14g does and does not close.** It closes "the conditions were just
encoded wrong" — the sequencing fix was real, it produced a tradeable
frequency, and the signals still carry no directional information. It does
not test *location*: `signal.ts` uses momentum and band-extremity only, with
no support/resistance input at all, because the level engine that would
supply trustworthy levels does not exist yet. The dip conditions fire at
whatever price happens to be oversold, not at a level.

So the open question narrows to one: **does requiring the dip to happen at a
real level change this?** That is a delta against the table above, on the
same signal and the same control — which is what step 3 of the build plan
measures. Six negatives means the prior on it is low.

### Methodology rules added

- **Report the block count next to every CI.** 29 blocks and 85 blocks on the
  same data disagreed on sign. Trade count is not sample size.
- **Never quote a point estimate from the smaller of two sample sizes** you
  ran, whichever direction it leans.
- **A seeded RNG needs a uniformity assertion,** not just a reproducibility
  one. Reproducible and uniform are different properties, and the harness
  passed reproducibility for months while being non-uniform.

---

## 14h. ⛔ THE TRADE PLAN ITSELF — flat before costs, negative after

**The first test of what the tool actually prints.** Every experiment above
scored a *signal* — a checklist score, a momentum rank, a funding rank, a
sequenced dip. None of them scored the thing `pnpm analyze` emits: a
confluence zone, a three-step entry ladder, a stop one 4h ATR beyond the zone,
and targets at the next zones. Different geometry, different trades, so §14c–g
say nothing about the current output.

`test/manual/backtest-plans.ts` closes that. It rebuilds the level map as of
every historical 1h bar from **only completed candles** (`completedAsOf` —
`open + duration <= bar close`, because a forming 12h candle already contains
the future), builds both directions' plans, takes any plan in an eligible
distance state once price reaches its average entry, and scores the printed
ladder: stop before target within a bar, breakeven after TP1 (p14), open
weight marked to market at the cap.

### Config — quote these with any number below

```
A (primary)     pnpm backtest:plans --coins BTC,ETH,SOL --bars 6000 --random --csv plans.csv
                states=ACTIONABLE fill-bars=24 max-bars=72 cooldown=24 fee=0.05% slip=0.02% seed=12345
B (sensitivity) same, --max-bars 240
window          2025-11-29 → 2026-08-06 · 6000 1h bars per coin · 10 monthly blocks
drift           BTC −28.9%  ETH −36.0%  SOL −46.2%
```

### Result

| | A (72-bar cap) | B (240-bar cap) |
|---|---|---|
| trades | 582 | 518 |
| win rate | 58% | 58% |
| **net R/trade** | **−0.039** | **−0.043** |
| gross R/trade | +0.046 | +0.042 |
| cost R/trade | 0.084 | 0.085 |
| long / short | −0.060 / −0.016 | −0.046 / −0.039 |
| random control | −0.121 | −0.040 |
| **delta vs random** | **+0.083** | **−0.003** |

Month-clustered bootstrap on A, 10,000 resamples, 10 blocks:

```
strategy   −0.0387R   CI [−0.1206, +0.0583]   P(<=0) 0.81
control    −0.1212R   CI [−0.2330, +0.0102]   P(<=0) 0.96
delta      +0.0826R   CI [−0.0908, +0.2435]   P(<=0) 0.18
```

### Six findings, all of which change what to build next

**1. Costs, not direction, are the binding constraint.** Gross is +0.046R;
cost is 0.084R. At the average 1.82% stop distance, breakeven demands a
**round-trip cost under ~0.08%** — about 0.04% per side including slippage.
The modelled 0.14% is ordinary taker pricing. The geometry does not have to be
wrong for this to lose; it only has to be flat.

**2. The apparent edge over random does not survive a modelling knob.**
+0.083R at a 72-bar cap becomes −0.003R at 240. `max-bars` is not a strategy
parameter — it is an artifact of the harness — so a result that flips on it is
not a result. This is the single most important line in this section.

**3. 9% of trades were holding up the number.** The TIMEOUT bucket (never
resolved inside the cap, marked to market) averaged +1.76R in A. Score those
as 0R and the whole thing drops to **−0.202R**. Mark-to-market is a
modelling choice, and this result rests on it.

**4. Confluence strength does not rank outcomes.** Net R by source count:
2 → −0.028, 3 → +0.036, 4 → −0.267, 5 → −0.118. The same non-monotonic
non-ranking the deleted checklist score showed. Requiring *more* agreement
picked worse trades, exactly as the earlier `minSources` 2→3 measurement
predicted (level-map.service.ts).

**5. `ACTIONABLE` is not selective — the cooldown is.** BTC produced 7,971
eligible plans over 6,000 bars: price sits within 1% of a confluence zone, on
both sides, essentially always. That does satisfy "don't say WAIT 95% of the
time", but it means the distance state carries no information, and the trade
count is set by `--cooldown`, not by the market.

**6. A 58% win rate with negative expectancy.** TP1 is the next zone rather
than a multiple of risk, so it is routinely below 1R by construction. Win rate
is not the metric and never was; 41% of trades stop out at −1.08R and outvote
the wins.

### What this does and does not close

It closes **§14g's open question** — "does requiring the signal to happen at a
real level change this?" The level engine now exists, plans are built on it,
and the answer is no: not distinguishable from zero, and the delta over random
is not robust. Hypothesis 3 (zone-arrival location) is no longer "worse than
random, significance unverified"; on the real engine it is *flat*.

It does **not** close whether the tool is useful. It measures a mechanical
version of the analyst — fixed cooldown, fixed cap, no regime filter, no human
judgment, no narration. The journal (step 8) measures the version that has
those. That remains the only instrument that can answer the actual question.

### Standing verdict — seven hypotheses

| # | hypothesis | result |
|---|---|---|
| 1 | checklist as scanner | no edge vs random longs (§14c) |
| 2 | checklist as confirmation filter | structurally unreachable; mis-wired (§14d) |
| 3 | zone-arrival location | flat on the real level engine (§14h, supersedes §14d) |
| 4 | cross-sectional momentum, long/short | not significant; worse than random risk-adjusted (§14e) |
| 5 | cross-sectional funding, contrarian | no edge; delta is a coin flip (§14f) |
| 6 | sequenced dip→turn | fires 32× more often; no edge at any horizon (§14g) |
| 7 | **the printed trade plan** | **flat gross, negative net; delta not robust (§14h)** |

### Methodology rules added

- **Vary the modelling knobs, not just the strategy ones.** `max-bars`,
  `fill-bars` and the mark-to-market rule are harness artifacts. If the
  conclusion moves when they do, report that in the same breath as the number.
- **Name the share of trades that carry the result.** 9% of trades at +1.76R
  decided the sign here. A mean without that share is a mean that hides.
- **Score what the tool prints, not what it used to print.** `backtest.ts` was
  still measuring a signal the analysis path no longer emits, and would have
  answered "is this reliable" about code that no longer runs.

---

## 15. Where six experiments left us *(superseded by §14 — kept for the record)*

| # | experiment | result |
|---|---|---|
| 1 | Fix 3 wiring bugs | ✅ real bugs, fixed |
| 2 | Binary checklist, 125d | −0.096R (underpowered) |
| 3 | Continuous scoring | no change (−0.096 → −0.096) |
| 4 | 21 months of data | +0.027R, still ~0 |
| 5 | Walk-forward + DSR | fold spread 6.5× mean; DSR 0.162 vs 0.95 |
| 6 | Funding rate | corr 0.002 |
| — | Open interest | untestable (31-day retention) |

**The honest conclusion: five technical indicators, scored and thresholded on 4h crypto bars, do not predict direction.** This is not a tuning problem — it has survived a scoring rewrite, a 5× data increase, nine exit configurations, and a genuinely new input.

That is a real result, obtained for $0 and about two hours, and it is far better to know it now than after funding a live account.

### Options, honestly

**A. Change the product, keep the code.** The pipeline is good at *explaining market state* — regime, levels, positioning, risk sizing. That's a research assistant a human trades from, not an autonomous signal generator. Most of the codebase survives; only the claim changes.

**B. Different data class.** Order-flow/microstructure, cross-exchange basis, on-chain flows. Each needs data we don't have cheaply, and each is weeks of work with no guarantee.

**C. Different target.** Volatility is far more predictable than direction. But that monetises through options, and the execution venue here is spot/perp on Kraken.

**D. Keep the system, drop the prediction claim.** Use it for risk management and journalling — position sizing, level identification, trade logging — where the code is already correct and the value doesn't depend on forecasting.

The measurement harness (`pnpm backtest`) is the durable asset from this work. Any future idea can now be tested in under a minute, for free, with honest statistics.

---

## 15. Plan

1. **Score-only backtest** ← *in progress.* Replay historical candles through the existing pure pipeline. No API spend, no Claude. **This is the measuring instrument — everything after it is a measurement instead of an argument.**
2. **Settle findings D and E with numbers**, plus the tier cuts (40/60/80), which were tuned on top of the pre-fix broken scoring and are currently arbitrary.
3. **A/B the additions** — funding rate + OI as checklist inputs; `livePrice` vs `lastCandleClose`.
4. **Then decide** on the 4-agent rebuild. With a backtest it's a measurement, not a philosophy argument.
5. **Full-fidelity backtest on a sample** — Claude in the loop costs one API call per evaluated candle, so it runs on a subset once the deterministic half looks sane.
6. **Frontend** stays parked until the expectancy gate passes.

Cleanup (delete `TradeAnalysis`, the legacy MTF + complete-analysis flows, fold five planning docs into one) rides along whenever we're already in those files. It is not a phase.
