# Meridian — briefing for external review

Written 4 September 2026. Audience: a model or engineer seeing this project for
the first time, asked to say how to make it better.

Everything here was checked against the code, a results file, or a live database
query. Where something is uncertain it says so. **The one thing this document
must not do is oversell**, because the whole point of the exercise is that the
system does not currently have an edge and we need to know whether that is
fixable.

---

# 0. What we are trying to build, and what "better" means

Meridian is a **systematic crypto analyst**. On a schedule it reads the market,
finds support/resistance levels and confluence zones, writes a trade plan, scores
what actually happened afterwards, and shows the record.

It has **never placed an order** and contains no code that could — no exchange
authentication, no order endpoint, no request signing.

There are two acceptable end states and we would be happy with either:

**A. An analysis we can trust.** The tool describes the market accurately and its
outputs are calibrated — when it says a zone is strong, that means something
measurable. It does not have to predict returns. It has to be honest and useful.

**B. A system with a real edge.** Something that survives costs out of sample.

We are **open to changing anything**: the features, the timeframes, the target,
the universe, the whole technique. Nothing in the current approach is sacred. If
the right answer is "throw away the confluence-zone framing and do X instead",
say that.

---

# 1. What actually runs in production

## 1.1 Stack

| piece | detail |
|---|---|
| API | NestJS, one Lambda behind API Gateway HTTP, container image, 1024 MB, **120 s timeout** |
| Database | PostgreSQL via Prisma 7, **Neon** (512 MB cluster cap) |
| Web | Next.js on Vercel |
| Schedule | EventBridge cron into the same Lambda |
| Infra | CDK (`infra/lib/meridian-stack.ts`) |
| Local DB | Docker `meridian-postgres` on `localhost:5433` |

**Local and Neon are not replicas.** All research reads local; the collector
writes Neon. Merging to `main` is the deploy.

## 1.2 The scheduled jobs

**Analysis — every 8 hours (00:00, 08:00, 16:00 UTC), 10 coins.**
`BTC ETH SOL BNB XRP ADA AVAX LINK DOT LTC`. Thirty analyses a day.
`retryAttempts: 0` — the next run is fresher than a retry.

The 8-hour spacing is measured, not chosen: price reaches a zone in a median of
3h, 82% within 12h, 100% within 24h (582 trades).

**Flow collection — SWITCHED OFF 5 September 2026.** It ran daily at 03:30 UTC
and wrote eight futures-flow metrics into `FlowSample`. Removed because the table
reached 29.4 million rows with **zero production consumers** and nineteen tests
against that data cleared no bars.

Nearly free to reverse: six of the eight metrics are republished by
`data.binance.vision` back to 2021-12, and `fundingRate` and `premium` have years
of live history. The exception was `takerBuySellRatio1h` — ~30 days of retention,
no archive column — and Neon's 9,350 rows (2026-07-28 to 2026-09-05) were copied
to local before the rule was removed. `FlowCollectorService` and the lambda's
`collect` handler both stay; nothing invokes them on a schedule.

## 1.3 The live analysis pipeline

`AnalyzeService.analyze(symbol)` — `src/analysis-coordinator/analyze.service.ts`

```
1. fetch 12h candles (needs 200 past readings for a percentile)
2. buildContext         RSI, ADX, %B, bandwidth + percentile, ATR, QQE
3. classifyFromContext  regime: trending / ranging / squeeze
4. routeFromRegime      picks a strategy route from the regime
5. levelMapService.build(coin)
      support/resistance on 12h, 4h, 1h
      fib anchors, ATR, confluence zones
6. tradePlanService.buildPlans(zones, spot, atr)
      entry ladder (3 legs), stop, targets — one plan per zone
7. checklist, once PER DIRECTION
8. persist to CoordinatorRun
9. optionally narrate via Claude
10. OutcomeScorerService marks it later against 1h bars
```

Plans are built **independently of regime**, so a plan is never quietly hidden.
Whether they *should* be filtered by regime is untested and marked `TODO`.

## 1.4 Live API surface — this is all of it

```
POST /analyses               run one analysis, save it
GET  /analyses               list, paged, filterable
GET  /analyses/stats         aggregates
GET  /analyses/:id           one analysis with payloads
POST /analyses/:id/narrate   Claude's written read of it
POST /auth/login
GET  /auth/me
GET  /health, /health/ready, /health/live
```

Web-only: `/api/candles` in the Next app calls Binance directly for charts.

## 1.5 DEPRECATED / UNUSED — do not spend review effort here

**`src/risk-management/` — 1,300 lines, 6 endpoints, dead.**

```
POST /analysis/position-size
POST /analysis/risk-reward
GET  /analysis/portfolio-allocation
GET  /analysis/leverage/:timeframe
POST /analysis/leverage-recommendation
GET  /analysis/leverage-constraints
```

Verified dead: `LeverageService` and `PositionSizingService` are referenced only
inside their own module, and these paths appear in the frontend **only** in
`lib/api/generated/schema.ts`, a generated OpenAPI artifact. No page or component
calls them.

**`lib/api/generated/schema.ts`** also lists roughly twenty other `/analysis/*`
paths (`/analysis/complete`, `/analysis/multi-timeframe`, `/analysis/quick`,
`/analysis/bias/{coin}`, `/analysis/ai-analyze`, `/analysis-coordinator/*`, …)
that **no longer exist on the backend at all**. It is a stale spec. Ignore it.

**`FlowSample` was write-only in production, and the collector is now off.**
Nothing in `src/` ever read a row of it — 29.4 million rows, zero production
consumers, only research scripts. The daily rule was removed on 5 Sept 2026.

**You are welcome to disagree with that call.** It is nearly free to reverse:
six of the eight metrics are republished by `data.binance.vision` back to
2021-12, and `fundingRate` and `premium` have years of live history, so the data
can be refetched to any depth. Only `takerBuySellRatio1h` was perishable — ~30
days retention, no archive column — and the 9,350 rows that existed were copied
to local first. That one is also the only correct source for an hourly taker
feature, because averaging the 5-minute ratios is 13.9% off at the median.

## 1.6 Size, for calibration

```
src/analysis + analysis-coordinator + indicators   4,420 lines   the live analyst
src/risk-management                                1,300 lines   dead
src/common                                         1,274 lines
test/manual                                       15,442 lines   the research rig
scripts                                            2,768 lines   collectors/importers
```

**The measurement rig is three times the size of the thing it measures.** That is
deliberate and it is the project's main asset.

518 tests, 33 suites, all passing.

---

# 2. The data we hold

Local `meridian_db`, table `FlowSample` = `(symbol, metric, ts, value)`.
**29.4 million rows.**

```
metric                     rows      first        last          source
openInterest            5,114,560   2020-09-01   2026-08-28    Binance
openInterestValue       5,114,560   2020-09-01   2026-08-28    Binance
longShortRatio          5,056,658   2020-09-01   2026-08-28    Binance
takerBuySellRatio5m     4,742,283   2020-09-01   2026-08-27    Binance
topTraderPositionRatio  4,193,033   2020-09-01   2026-08-28    Binance
topTraderAccountRatio   4,192,671   2020-09-01   2026-08-28    Binance
bookImbalanceFar        3,814,922   2023-01-01   2026-08-30    Binance bookDepth
bookDepthNotional       3,814,922   2023-01-01   2026-08-30    Binance bookDepth
bookImbalanceNear         652,920   2026-01-15   2026-08-30    Binance bookDepth
premium                   526,637   2020-08-21   2026-08-30    Binance
fundingRate                65,912   2020-08-22   2026-08-30    Binance
bybitClose                322,100   2023-01-01   2026-09-04    Bybit
bybitOpenInterest         322,100   2023-01-01   2026-09-04    Bybit
okxClose                  322,090   2023-01-01   2026-09-04    OKX
bybitFundingRate           40,270   2023-01-01   2026-09-04    Bybit
```

On disk: 13,338 bookDepth day-files, and 677 MB of 1-minute klines (2023-01 →).

## 2.1 Availability limits, measured not read from docs

```
             1h price     funding      open interest
  Binance    full         2020+        2020+
  OKX        2023-01 ok   ~3 months    ~1 month
  Bybit      2023-01 ok   2023-01 ok   2023-01 ok
```

## 2.2 Constraints that must not be re-derived

- `bookImbalanceNear` starts **2026-01-15**. Binance did not publish the 0.2%
  depth band before then. Seven months against everyone else's 3.6 years.
- **32 days have no bookDepth file at all** — 2023-02-08/09 across every coin (a
  Binance outage) plus scattered singles. Holes, not quiet books.
- `topTraderAccountRatio`, `topTraderPositionRatio`, `takerBuySellRatio5m` start
  **2023-01-01**; 2022 is 87.2% blank for the first two.
- **Never build a 1h taker feature by averaging 5m ratios** — 13.9% off at the
  median, 67.3% at worst.
- Binance liquidation data is **gone**; the free endpoint was removed.
- Archive rows are stamped in the live convention. Feeding raw archive timestamps
  to the embargo helper embargoes them one bar early.

---

# 3. Everything that has been tested, and what it returned

**Nineteen directional tests. Not one has cleared its pre-registered bar.**

## 3.1 The original strategy (tests 1–10)

| # | tested | verdict |
|---|---|---|
| 1–3 | zones, confluence, level strength | null |
| 4 | cross-sectional momentum, 30d formation, weekly hold, top-100 | **worse than its own random control** |
| 5 | cross-sectional funding, contrarian on crowding | null — delta a coin flip |
| 6 | seven charts vs three, pooled | worse; reverted to three |
| 7 | seven charts, hierarchical | worse; reverted |
| 8 | volume node distance, relative volume, volume at extremes, volume delta | dead |
| 9 | funding rate, premium index | fails on effective n |
| 10 | all of the above at decile resolution | one cell cleared, did not survive inspection |
| — | the trade harness itself | **−0.106R per resolved trade** |

Test 4 is the one people assume was never tried. Corrected for the funding
cashflow: strategy +0.273%/wk vs random control +0.183%, delta CI
`[-0.0065, +0.0078]`, P(≤0) = 0.38, **Sharpe 0.45 against random's 0.52 — worse
risk-adjusted.** 166 weekly rebalances, 2023-04 to 2026-08.

## 3.2 Harness defects fixed before any new measurement

- **The random control was drawn from the wrong population** — `allSignals` was
  filled before the state filter, so the control sampled three states while the
  strategy arm took one. Carried **0.301R of a 0.318R interval width**.
- **The interval on a difference is not two intervals subtracted.** Both arms are
  drawn from the same weeks; a paired block bootstrap cancels the common move.
- **A checklist units bug** — thresholds named "minimum 3 touches" were compared
  to a 1–5 strength score. Affected ~14% of levels **in production**.
- **Unfilled trades counted as finished losses.**
- **A thin chart returned `[]` instead of throwing.**

Result: the 95% interval on edge-over-random went **0.318R → 0.0556R**, 5.7×
narrower. Gated by `pnpm --filter api interval`, which exits non-zero.

**And the strategy still loses at zero fee: −0.0476R resolved.** Three
explanations tested and eliminated — fees (loses at zero), the breakeven-after-TP1
rule (removing it *doubles* the loss), the entry ladder (working as designed).

The structural fact: **all 3,630 losers fill every ladder leg; only 67.3% of
winners do.** Not a bug — the ladder fills deeper only when price moves against
you, and that *is* the road to the stop. It also kills the obvious fix, because
the deeper fill and the loss are the same event.

## 3.3 Phase A — the panel

`test/manual/panel-build.ts`. **320,000 rows × 78 columns**, 10 coins × 32,000
hourly bars, 2023-01 → 2026-09. Rows are `(coin, 1h bar close)`. Targets: forward
log returns at 4/12/24/72h, volatility-normalised returns, and triple-barrier
labels.

**No fills, no stops, no ladder, no cooldown.** The geometry layer is removed
entirely, which is the point — every confound above sat between a feature and its
outcome.

## 3.4 Phase B — does any single feature predict?

192 tests, bar |t| > 3.0 (Harvey/Liu/Zhu), Newey-West at lag = horizon plus a
30-day block bootstrap. **Seven families cleared:**

| family | best | IC | t |
|---|---|---|---|
| level distance / shape | `sup_1h_distPct` @4h | +0.0190 | 6.43 |
| volatility compression | `bandWidth` @24h | −0.0513 | −6.42 |
| mean reversion | `percentB` @4h | −0.0186 | −6.00 |
| funding rate | `fundingRate` @12h | −0.0245 | −5.14 |
| trend strength | `pdi` @4h | −0.0154 | −4.85 |
| top-trader positioning | `topTraderPositionRatio_z` @4h | −0.0133 | −4.27 |
| order book | `bookImbalanceFar` @72h | −0.0309 | −3.33 |

Every sign points the same way: **short-horizon mean reversion.** One story told
seven ways.

**None of them pays the fee.** Priced as top-3 vs bottom-3 long-short:
`bookImbalanceFar` 4.79 bp/trade, `bandWidth` 4.12, `fundingRate` 1.83 — against
a **14 bp** round trip.

**Two things the IC could not see, and they matter for method:**
- `sup_1h_distPct` has the largest t-stat in the run and a **completely flat**
  return profile across all ten ranks. Real rank information, no information
  about the size of the move.
- `percentB` and `pdi` both measured *negative* IC at |t| 6.00 and 4.85 and both
  have a **rising** return profile. Spearman correlates the *rank* of the return,
  and a coin that wins rarely but enormously ranks the same as one that wins
  slightly. Trading either on its IC sign loses money.

## 3.5 Phase C — do they combine?

Ridge on 39 cross-sectionally standardised features, 5 purged calendar folds,
embargo = horizon.

```
horizon  trades  gross bp   net@14   95% interval on gross
     4h   8,000      1.01   -12.99           [-0.06, 2.26]
    12h   2,667      0.82   -13.18           [-1.75, 3.51]
    24h   1,334     -0.84   -14.84           [-5.86, 3.87]
    72h     445      2.73   -11.27         [-11.96, 17.88]
```

**No.** Not tuning (lambda 1 → 10,000 moves gross 0.80–1.21 bp). Not better than
chance (shuffled returns 0.98 vs real 1.01). Not turnover (a conviction sweep of
24 cells produced one positive with an interval of **[−1.40, 42.28]**).

## 3.6 Phase D — does non-linearity help?

Targets changed first (return-over-ATR, triple barrier), features 39 → 160
(deltas, cross-sectional ranks, market context), overlapping labels thinned,
`HistGradientBoosting` depth 3, holdout = last 182 days touched once.

**0 of 8 holdout rows cleared.** At the horizon with the most trades, ridge got
1.01 bp and trees got **0.34**. But the shuffle control says it is not a clean
null: real holdout mean **+2.53 bp** against shuffled **−3.97**. There is real
information here, worth roughly **a third of a retail fee.**

## 3.7 Stage 0 — would a maker order have filled?

Every phase charged 14 bp, which is *taker* on both sides. A resting limit order
costs ~3.6 bp. Simulated against 1-minute klines.

```
                       legs   gross bp   95% interval
holdout (182 days)    1,098     +10.81   [  0.81, 19.93]
dev     (3.1 years)   6,912      -8.20   [-13.33, -2.75]
```

Orders fill 88–92%, and fill **favourably** rather than adversely — a buy on a
mean-reversion signal fills exactly when the dislocation deepens. **It does not
matter: on the larger sample the gross is negative before any fee.** A cheaper
fee multiplies a negative number by one.

## 3.8 Cross-venue dispersion — the first non-Binance inputs

Five features from OKX and Bybit. Pre-registered with a bar in **basis points**
rather than t-stats.

**Nine of twenty clear |t| > 3.0** (0.054 expected by chance), topping at
**|t| = 9.77** — the second-largest t-stat this project has produced.
**Zero of nine clear the money bar.** Best is 5.59 bp with an interval
`[1.40, 10.38]` that contains the 4.79 bp it had to beat.

`oiShareBybit` reached |t| = 4.13 and was rejected by the persistence gate at
0.80 — Bybit's share of a coin's open interest is a stable venue preference, not
a forecast.

---

# 4. Where it fails, in order

1. **Entry timing is genuinely better than chance.** Edge over random +0.0517R,
   CI [0.0241, 0.0798], P(edge > 0) = 100%.
2. **The trade geometry gives it all back.** 61.1% win rate needs a 0.637 payoff;
   the plan delivers 0.560. Loses at zero fee.
3. **Removing the geometry does not rescue it.** Seven feature families over
   |t| > 3, each worth 1.8–4.8 bp against 14.
4. **Combining does not rescue it.** 1.01 bp, indistinguishable from shuffled.
5. **Non-linearity does not rescue it.** 0.34 bp; real, a third of the fee.
6. **A cheaper fee cannot rescue it** — the gross is negative.
7. **Other venues do not rescue it.** |t| = 9.77, worth 1–2 bp.
8. **The two canonical slow edges were already dead** (weekly momentum, weekly
   funding).

**The sharpest statement available:** the constraint has never been *finding
information*. It has been finding information **large enough to pay a fee**. Nine
tests at |t| > 3 that move 1 bp say the two are close to unrelated on this data.

---

# 5. Methodology rules the project has paid for

Each of these came out of a real defect. **A proposal that violates one is
already known to be wrong here.**

1. **Effective n is one to two orders of magnitude below raw n.** 13,500
   observations carry 300–1,500 of actual evidence.
2. **A t-stat is not an edge.** Two features cleared |t| > 6 with a flat or
   inverted money profile. Every claim must be priced in basis points.
3. **A cross-sectional IC cannot tell "this feature times the market" from "these
   coins beat those coins".** Raw `openInterest` scored |t| = 10.05 with a
   30-day rank persistence of 0.99. A persistence gate is mandatory.
4. **Overlapping forward returns need Newey-West or block bootstrap.** A 24h
   return sampled hourly shares 23 of 24 hours with its neighbour.
5. **Purged K-fold with an embargo, and a holdout touched once.**
6. **A shuffle control on every result** — permute which coin got which forward
   return within each hour.
7. **A short page is not the end of history.** `/fapi/v1/fundingRate` accepts
   `limit=1000` and caps at 500; reading the short page as the live edge
   truncated a 2,200-day backfill to 166 days while reporting no failures.
8. **Compare every new feature against a quantity it must NOT resemble.** The
   cross-venue spread came out 0.995 correlated with the 1-hour return because a
   publication embargo pushed the cursor back one bar. Reconciliation against the
   live API passed at 0.000 bp throughout — the stored data was right and the
   *reading* was wrong.
9. **Winsorise the training target, never the P&L.** Dividing return by ATR made
   kurtosis worse (27 → 243); 27 rows out of 320,000 with a median 19.7% 4-hour
   move drove it. Real crashes.
10. **Sample weighting by 1/concurrency is a no-op on an evenly sampled panel.**
    It looks like rigour and does nothing. Thin the training set instead.

---

# 6. The research rig — what exists to reuse

`test/manual/` is 15,442 lines. The important pieces:

| file | what it does |
|---|---|
| `panel-build.ts` | Phase A. Builds the 320,000-row panel. |
| `phase-b.ts` | Cross-sectional IC, Newey-West, bootstrap, persistence gate, shuffle. |
| `phase-c.ts` | Ridge combiner, purged K-fold, book scored in bp. |
| `research/phase_d.py` | Gradient boosting, barrier labels, holdout. |
| `backtest-plans.ts` | Replays what `pnpm analyze` actually prints. |
| `forward-test.ts` | Scores the analyses the **schedule actually saved**. |
| `holdout.ts` | Chronological TUNE/HOLDOUT split, refuses to default. |
| `interval-check.ts` | Gate: exits non-zero if the interval is too wide to decide. |
| `panel.ts` | Cross-sectional momentum/funding, top-100 universe, weekly. |
| `exits.ts` | Exit-style arms on identical entries; bit-identity control. |
| `bootstrap.ts` | Block bootstrap. |
| `zoneaudit.ts` | Level-detection audit. |

Scripts: `flow-collector`, `flow-backfill`, `book-depth-import`, `maker-fill`,
`venue-backfill`, `venue-reconcile`, `venue-check.py`.

**Forward testing exists** (`forward-test.ts`, and `OutcomeScorerService` marks
every saved analysis against 1h bars), but the live record is short and has not
produced a verdict. The backtest is where all the evidence came from.

---

# 7. What we want from a review

Concretely, in rough priority order:

1. **Is the framing wrong?** We test features against forward returns
   cross-sectionally. Is there a better question to ask of this data?
2. **Is there a target we have not tried?** We have used raw return,
   volatility-scaled return, and triple-barrier labels.
3. **Is the universe wrong?** Ten liquid majors. More coins bleed 0.436%/week in
   the long tail; fewer means less cross-section.
4. **Is 1 hour the wrong bar?** Everything is hourly with 4/12/24/72h horizons.
5. **What data would you get next?** Deribit IV/skew is free but only BTC and ETH
   have liquid options, so it cannot be a cross-sectional feature on this
   universe at all. `aggTrades` is free but ~440 GB and partly duplicates
   `takerBuySellRatio5m`.
6. **Was switching the collector off the right call?** It was turned off on
   5 Sept 2026 — 29.4M rows, zero production consumers, and every feature built
   on it failed. Reversible, and the one perishable series was preserved first.
   If you think a specific metric there is worth keeping alive, say which and
   what you would do with it.
7. **If the honest answer is "there is no edge here for a retail participant",
   say so** — and tell us what end state A looks like instead: what would make
   the analysis trustworthy and useful without predicting returns?

## What a useful answer looks like

- Names a specific change and what it would predict, **in basis points against a
  14 bp round trip**, not in t-stats or ICs.
- Says what would falsify it, before it runs.
- Does not violate any rule in section 5.
- Is honest about effective n.

## What is not useful

- "Try more features." Nineteen tests, ~550,000 observations in the older ones
  plus a 320,000-row panel, say the constraint is not feature count.
- "Use a neural net." 320,000 rows with effective n two orders lower is not
  deep-learning territory, and Phase D's trees bought nothing over ridge.
- Anything that requires paid data before proving itself on free data.
- Anything that reports a t-stat as the result.

---

# 8. Reading order for the full record

```
docs/STATE_OF_MERIDIAN_2026-09-01.md   what runs, all tests, where it fails
docs/evidence/README.md                the ledger, 19 tests indexed
docs/evidence/PHASE_B_IC.md            the seven families, and why none pays
docs/evidence/PHASE_C_COMBINE.md       the combination result
docs/evidence/PHASE_D_NONLINEAR.md     trees, and a statistic we misread
docs/evidence/STAGE0_MAKER_FILL.md     fills, and the negative gross
docs/evidence/CROSS_VENUE_IC.md        the first non-Binance inputs
docs/ROADMAP.md §3                     parked defects, with line numbers
```

Each evidence document states its bar **before** the run and its result after.
That ordering is the only thing that makes any of them mean anything.
