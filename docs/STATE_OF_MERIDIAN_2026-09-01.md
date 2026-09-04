# The state of Meridian — 1 September 2026

Everything that runs, everything that has been tested, and exactly where it
fails. Written after Phases A–D and the maker-fill test closed out the last
open research question.

Every number here was checked against the code, a results file, or a live
database query. Where something could not be verified, it says so. Nothing is
asserted from memory.

**Read this first, then [`evidence/README.md`](evidence/README.md) for the
individual pre-registrations.**

---

# Part 1 — What Meridian actually is

A systematic crypto **analyst**, not a trading system. It reads the market on a
schedule, produces a written analysis with levels, zones and trade plans, scores
what happened afterwards, and shows the record. **It has never placed an order
and contains no code that could** — no exchange authentication, no order
endpoint, no request signing.

## 1.1 The stack

| piece | what | where |
|---|---|---|
| API | NestJS, single Lambda behind API Gateway HTTP | AWS, container image, 1024 MB, **120 s timeout** |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) | **Neon**, 512 MB `neon.max_cluster_size` |
| Web | Next.js dashboard | Vercel |
| Schedule | EventBridge cron → the same Lambda | AWS |
| Infra | CDK, TypeScript | `infra/lib/meridian-stack.ts` |
| Local DB | Docker `meridian-postgres` | `localhost:5433` |

**Local and Neon are not replicas.** Every experiment reads local; the collector
writes Neon. That divergence has already caused one silent failure — see §5.3.

**Merging to `main` is the deploy.** There is no separate release step. Secrets
load at cold start.

## 1.2 What the schedule does

Two cron rules, both hitting the same Lambda with a JSON event shape that
`lambda.ts` inspects to tell a cron run from an HTTP request.

**Analysis — every 8 hours, `0/8` UTC (00:00, 08:00, 16:00), 10 coins.**
`BTC ETH SOL BNB XRP ADA AVAX LINK DOT LTC`. Thirty analyses a day.

The 8-hour spacing is measured, not chosen: price reaches a zone in a median of
3h, 82% within 12h, 100% within 24h (582 trades, `archive/STATE_OF_PLAY.md`
§14h). An analysis older than a day is finished. `retryAttempts: 0` — a failed
run is not worth retrying because the next one produces a fresher analysis.

**Flow collection — daily at 03:30 UTC.** `retryAttempts: 2`, because unlike
analysis a missed run is *not* made up by the next one: several Binance flow
endpoints keep only ~30 days. It deliberately re-asks for several days each run
so a missed run repairs itself; rows are keyed on `(symbol, metric, ts)` so
re-reading costs nothing.

## 1.3 The analysis pipeline, end to end

`AnalyzeService.analyze(symbol)` — `apps/api/src/analysis-coordinator/analyze.service.ts`

```
1. fetch 12h candles (ANALYSIS_CANDLE_LIMIT — one measure needs 200 past readings)
2. buildContext        RSI, ADX, %B, bandwidth + percentile, ATR, QQE
3. classifyFromContext regime: trending / ranging / squeeze
4. routeFromRegime     picks a strategy route from the regime
5. levelMapService.build(coin)
       support/resistance on 12h, 4h, 1h   (LEVEL_TIMEFRAMES)
       fib anchors, ATR, confluence zones
6. tradePlanService.buildPlans(zones, spot, atr)
       entry ladder, stop, targets — one plan per zone
7. checklist, once PER DIRECTION
       (a shared one put the wrong side's score on half the plans — fixed)
8. persist to CoordinatorRun
9. optionally narrate via Claude
10. OutcomeScorerService marks it later against 1h bars
```

Plans are built **independently of market type**, so a plan is never quietly
hidden. Whether they *should* be filtered by regime is explicitly untested and
marked `TODO` in the code.

## 1.4 The three tables

- **`CoordinatorRun`** — one row per analysis. Holds the coordinator payload,
  the AI payload, and the scored outcome (`outcome`, `grossR`, `netR`,
  `targetsHit`, `entryFilledAt`) projected out of the JSON so the list and stats
  can filter without opening it.
- **`TradeAnalysis`** — the older analysis record.
- **`FlowSample`** — `(symbol, metric, ts, value)`. Deliberately narrow: every
  flow source returns a timestamp and a number, so one table with a `metric`
  label beats four typed tables that would need joining back together.

## 1.5 The web app

Next.js on Vercel: dashboard, analysis, history, strategies, alerts, settings,
sign-in. Reads the API. Filtering, paging and stats are server-side.

---

# Part 2 — Everything that has been tested

**Nineteen directional tests. Not one has cleared its pre-registered bar.**

## 2.1 The original strategy (tests 1–10, to 30 Aug 2026)

| # | what was tested | verdict |
|---|---|---|
| 1–3 | zones, confluence, level strength (`archive/STATE_OF_PLAY.md` §14c–d) | null |
| 4 | cross-sectional momentum, 30d formation, weekly hold, top-100 (`panel.ts`) | **worse than its own random control** |
| 5 | cross-sectional funding, contrarian on crowding (`panel.ts --signal funding`) | null — delta a coin flip |
| 6 | seven charts vs three, pooled ([`CHARTS_AB.md`](evidence/CHARTS_AB.md)) | worse; **reverted to three** |
| 7 | seven charts, hierarchical ([`HIERARCHY_AB.md`](evidence/HIERARCHY_AB.md)) | worse; **reverted** |
| 8 | volume node distance, relative volume, volume at extremes, volume delta ([`VOLUME_AB.md`](evidence/VOLUME_AB.md)) | dead |
| 9 | funding rate, premium index ([`FUNDING_AB.md`](evidence/FUNDING_AB.md)) | fails on effective n, not direction |
| 10 | all of the above at decile resolution ([`DECILE_AB.md`](evidence/DECILE_AB.md)) | one cell cleared, does not survive inspection |
| — | the trade harness itself ([`HANDOFF.md`](evidence/HANDOFF.md)) | **−0.106R per resolved trade** |

Test 4 is worth reading carefully because it is the one people assume was never
tried. Corrected for the funding cashflow: strategy +0.273%/wk against a random
control's +0.183%, delta CI `[-0.0065, +0.0078]`, P(≤0) = 0.38 — and **Sharpe
0.45 against random's 0.52, worse risk-adjusted**. 166 weekly rebalances,
2023-04 to 2026-08.

## 2.2 The harness fixes (30 Aug 2026)

Before any new measurement could be trusted, five defects were fixed:

- **The random control was drawn from the wrong population.** `allSignals` was
  filled *before* the `STATES` filter, so the control sampled ACTIONABLE,
  APPROACHING and FAR while the strategy arm took ACTIONABLE only. "Same plans,
  random timing" was comparing two different populations. This carried **0.301R
  of the old 0.318R interval width**.
- **The interval on a difference is not two intervals subtracted.** Both arms
  are drawn from the same weeks of the same market, so `blockBootstrapDiff` now
  draws a block and takes *both* arms from it and the common move cancels.
- **A checklist units bug.** Thresholds named `STRONG_MIN_TESTS: 3 // minimum 3
  touches` were being compared to `strength`, a 1–5 score that rounds a held
  level up to count+1. Affected ~14% of levels **in production**.
- **N3** — `aggregate()` counted a trade that never filled as a finished loss.
- **A thin chart returned `[]` instead of throwing**, which reads downstream as
  "this chart offered nothing" rather than "there is not enough data".

Result: the 95% interval on edge-over-random went from **0.318R wide to 0.0556R**
— 5.7× narrower, on 95 blocks against 6. It is now gated by
`pnpm --filter api interval`, which exits non-zero.

**And the strategy still loses at zero fee: −0.0476R resolved.** Three
explanations were tested and eliminated — fees (loses at zero), the
breakeven-after-TP1 rule (removing it *doubles* the loss to −0.0958R), and the
entry ladder (working as designed).

The structural fact underneath: **all 3,630 losers fill every ladder leg; only
67.3% of winners do.** Not a bug — the ladder fills a deeper leg only when price
moves further against you, and that *is* the road to the stop. It also kills the
obvious fix, because the deeper fill and the loss are the same event.

## 2.3 Phase A — the panel (30 Aug 2026)

`test/manual/panel-build.ts` → `pnpm --filter api panel-build`

**320,000 rows × 73 columns, 10 coins × 32,000 hourly bars, 2023-01-02 →
2026-08-27.** Built in 587 s.

Rows are `(coin, 1h bar close)`. Columns are every feature the analyst computes
plus ten flow metrics. Targets are forward log returns at 4h/12h/24h/72h, plus
(added for Phase D) volatility-normalised returns and triple-barrier labels.

**No fills, no stops, no ladder, no cooldown.** The entire geometry layer is
removed, which is the point: every confound in §2.2 sat between a feature and
its outcome and none of them were about whether the feature predicts anything.

Look-ahead is handled by `completedAsOf` (candles) and `flowAsOf` (flow rows,
5-minute publication embargo). Levels are recomputed only when a bar on their
own timeframe closes — an identity, not an approximation, and it turns 96,000
calls per coin into 43,000.

Verified on landing: staleness p50 is 5 min for the 5-minute metrics and 60 for
premium — half each publication interval, which is what an honest embargoed read
looks like.

**Corrected 4 Sept.** The same sentence originally said 240 for funding and
called it half its interval too. Funding settles 8-hourly on the hour, so with
the 5-minute embargo the age at a bar closing at hour H cycles `480, 60, 120,
180, 240, 300, 360, 420` as H mod 8 runs 0 to 7 — the 480 being the settlement
hour itself, correctly held back. The median of that cycle is 270, not 240, and
Binance stamps `fundingTime` about 29 ms off the hour so 35.7% of ages are not
whole minutes. `scripts/venue-check.py` now asserts the cycle directly, which is
a stronger statement than any median: the cycle IS the embargo.

## 2.4 Phase B — does any single feature predict? (30 Aug)

`pnpm --filter api phase-b`. 48 features × 4 horizons = **192 tests**, bar
|t| > 3.0 (Harvey/Liu/Zhu), 0.52 false passes expected. Newey-West at lag =
horizon, plus a 30-day block bootstrap.

**Seven families cleared the bar:**

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
seven ways, not seven edges.

**The gate that changed the answer.** The first run reported 63 passes led by raw
`openInterest` at |t| = 10.05. Its cross-sectional ranking of the ten coins
correlates **0.99 with itself thirty days later** — it never times anything, it
says BTC and ETH sit at the top and over this sample the top underperformed. One
bet on one 3.6-year window, effective n near 1, wearing 32,000 observations. A
rank-persistence gate removed 24 of the 63. `openInterest_z` (persistence −0.06)
does not pass; raw `openInterest` (0.99) "passed" enormously. The normalisation
was the entire difference.

**Shuffle control:** real max |t| 6.43 / IC +0.0190; shuffled 3.11 / +0.0058.

**And none of them pays the fee.** Mean forward return by cross-sectional rank
revealed two things the IC could not:

- `sup_1h_distPct` carries the largest t-stat in the run and its return profile
  is **flat across all ten ranks**. Real rank information, no information about
  the size of the move.
- `percentB` and `pdi` both measured *negative* IC at |t| 6.00 and 4.85 and both
  have a **rising** return profile. Spearman correlates the *rank* of the return,
  and a coin that wins rarely but enormously ranks the same as one that wins
  slightly. Trading either on its IC sign loses money.

Priced as a top-3 vs bottom-3 long-short: `bookImbalanceFar` 4.79 bp/trade,
`bandWidth` 4.12, `fundingRate` 1.83 — against a **14 bp** round trip. Three to
eight times underwater.

Full record: [`evidence/PHASE_B_IC.md`](evidence/PHASE_B_IC.md).

## 2.5 Phase C — do they combine? (31 Aug)

`pnpm --filter api phase-c`. Ridge on 39 cross-sectionally standardised features,
5 contiguous calendar folds, embargo = horizon.

```
horizon  trades  gross bp   net@14   95% interval on gross   oos IC
     4h   8,000      1.01   -12.99           [-0.06, 2.26]  -0.0151
    12h   2,667      0.82   -13.18           [-1.75, 3.51]  -0.0100
    24h   1,334     -0.84   -14.84           [-5.86, 3.87]  -0.0073
    72h     445      2.73   -11.27         [-11.96, 17.88]  -0.0033
```

**No.** Every interval straddles zero. Three objections ruled out:

- **Not tuning.** Lambda 1 → 10,000 moves gross between 0.80 and 1.21 bp.
- **Not better than chance.** Shuffled returns 0.98 bp against the real 1.01.
- **Not turnover.** A conviction gate swept 6 levels × 4 horizons produced one
  positive cell (72h @ 95th pct, net +5.73) with neighbours at +8.87 and +0.25
  and a bootstrap interval of **[−1.40, 42.28]**. A spike on a sweep.

Full record: [`evidence/PHASE_C_COMBINE.md`](evidence/PHASE_C_COMBINE.md).

## 2.6 Phase D — does non-linearity help? (31 Aug)

`.venv-research/bin/python research/phase_d.py`. The plan deliberately weighted
the *target* and *features* over the model:

- **Target changed first.** Raw return → return-over-ATR (winsorised at ±5 for
  training only) and a triple-barrier label.
- **Features 39 → 160.** 4h and 24h deltas (trees cannot see time), cross-sectional
  ranks beside z-scores, four market-context columns.
- **Overlapping labels thinned**, not weighted — 1/concurrency is a *constant* on
  an evenly sampled hourly panel and therefore a no-op.
- **Holdout:** last 182 days, touched once.

**0 of 8 holdout rows cleared the bar.** Best is `tb72h` at 8.15 bp on 61
trades, interval `[-9.51, 27.81]`. At the horizon with the most trades, ridge got
1.01 bp and trees got 0.34.

But the shuffle control says it is **not** a clean null: real holdout mean +2.53
bp against shuffled −3.97, max 8.15 against 2.19. **There is real information in
this feature set, worth roughly a third of a retail fee.**

Full record: [`evidence/PHASE_D_NONLINEAR.md`](evidence/PHASE_D_NONLINEAR.md).

## 2.7 Stage 0 — would a maker order have filled? (1 Sept)

`pnpm --filter api maker-fill`. Every phase charged 14 bp, which is **taker on
both sides**. A resting limit order costs ~3.6 bp, so the whole question turned
on fills. Simulated against the **1-minute** kline archive (677 MB, 430 monthly
files + August dailies) — 1-hour would report ~100% fills and teach nothing.

```
                       legs   gross bp   95% interval       verdict
holdout (182 days)    1,098     +10.81   [  0.81, 19.93]   inconclusive
dev     (3.1 years)   6,912      -8.20   [-13.33, -2.75]   FAILS
```

**On 6× the sample and 17× the span the strategy loses 8.20 bp gross, before any
fee, with an interval entirely below zero.** A cheaper fee multiplies a negative
number by one.

Three things worth keeping:

- **A 99% fill rate is a broken test.** At 0 bp inside, median wait is **0
  minutes** — the order was marketable, i.e. a *taker* order at ~9 bp. An earlier
  output charged it a 3.6 bp maker fee and reported +1.31 bp net. Retracted.
- **Posting further away looks better and is not.** Gross rises 4.91 → 27.23 bp
  from 0 to 20 bp inside, almost entirely mechanical: post X bp better both ways
  and 2X is booked regardless of signal. Net of it the edge is flat then negative
  (4.91, 4.75, 6.81, 3.09, −1.55, −12.77). At 10 and 20 bp all profit is spread
  capture — that is market making, and a kline simulator cannot measure it.
- **Fills were *favourably* selected, not adversely.** Not the prediction. There
  is a mechanism — a buy on a mean-reversion signal fills exactly when the
  dislocation deepens — but the effect collapses from +35.96 bp (n=11) to +3.50
  (n=698) as the sample grows.

Full record: [`evidence/STAGE0_MAKER_FILL.md`](evidence/STAGE0_MAKER_FILL.md).

## 2.8 Cross-venue dispersion — the first non-Binance inputs (4 Sept)

`pnpm --filter api venue-backfill` then `phase-b`. OKX and Bybit price, funding
and open interest, 1,005,804 rows, 2023-01-01 onward, all ten coins. Five derived
features: the two price spreads against Binance, the dispersion across all three
venues, the funding spread, and Bybit's share of notional open interest.

Pre-registered in [`evidence/CROSS_VENUE_PREREG.md`](evidence/CROSS_VENUE_PREREG.md)
**before the panel was rebuilt**, and it is the first pre-registration here to
state a bar in basis points rather than t-stats — because tests 11 to 14
established that a significant IC and a payable edge are different things.

**Nine of twenty clear |t| > 3.0 with the bootstrap agreeing and the persistence
gate passed, against 0.054 expected by chance.** Top is `pxSpreadOkxBp` @4h at
|t| = **9.77**, the second-largest t-stat this project has measured.

**Zero of nine clear the money bar.** Best is `pxSpreadOkxBp` @24h at 5.59 bp
with an interval of [1.40, 10.38] — which contains the 4.79 bp it had to beat —
and neighbours across horizons of 1.10, 2.08, 5.59, 2.80. A spike, not a pattern.

`oiShareBybit` reached |t| = 4.13 and was **rejected by the persistence gate at
0.80**: Bybit's share of a coin's open interest is a stable venue preference, not
a forecast. Same trap as raw `openInterest` in Phase B, caught by the same gate.

Full record: [`evidence/CROSS_VENUE_IC.md`](evidence/CROSS_VENUE_IC.md).

---

# Part 3 — Where it fails, precisely

Not "it doesn't work". The chain, in order, with the measurement that closed
each link:

**1. The entry timing is genuinely better than chance.** Edge over random
+0.0517R, 95% CI [0.0241, 0.0798], P(edge > 0) = 100%. This is real and stable
across seven fee levels and two exit rules.

**2. The trade geometry gives it all back.** At 61.1% win rate breakeven needs a
payoff of 0.637; the plan delivers 0.560. It loses **at zero fee**. The cause is
structural: every loser fills the full ladder, only 67.3% of winners do, and the
deeper fill and the loss are the same event.

**3. Removing the geometry does not rescue it.** Phase A stripped fills, stops,
ladder and cooldown entirely. Phase B then found seven feature families over
|t| > 3.0 — and every one of them earns 1.8–4.8 bp per trade against a 14 bp
round trip.

**4. Combining them does not rescue it.** Phase C: 1.01 bp, indistinguishable
from a shuffled control, insensitive to four orders of magnitude of
regularisation.

**5. Non-linearity does not rescue it.** Phase D: 0.34 bp at the horizon with the
most trades. Real, above noise, roughly a third of the fee.

**6. A cheaper fee cannot rescue it, because the gross is negative.** Stage 0:
−8.20 bp over 3.1 years, interval entirely below zero.

**7. Data from other venues does not rescue it either.** Cross-venue price
dislocation is genuine information at |t| = 9.77 and is worth one to two basis
points against a fourteen basis point fee.

**8. And the two canonical slow edges were already dead.** Weekly cross-sectional
momentum is worse than random risk-adjusted; weekly funding is a coin flip.

**The honest summary: there is a small, real amount of directional information in
this feature set — Phase D's holdout beats its own shuffle — and it is roughly a
third of the size needed to survive a retail fee. Closing that gap needs either
a fee an order of magnitude below 14 bp, or information this panel does not
contain.**

---

# Part 4 — The data we hold

Local `meridian_db`, `FlowSample`, **28.4 million rows across 11 metrics:**

```
metric                     rows      first        last
bookDepthNotional       3,814,922   2023-01-01   2026-08-30
bookImbalanceFar        3,814,922   2023-01-01   2026-08-30
bookImbalanceNear         652,920   2026-01-15   2026-08-30
fundingRate                65,912   2020-08-22   2026-08-30
longShortRatio          5,056,658   2020-09-01   2026-08-28
openInterest            5,114,560   2020-09-01   2026-08-28
openInterestValue       5,114,560   2020-09-01   2026-08-28
premium                   526,637   2020-08-21   2026-08-30
takerBuySellRatio5m     4,742,283   2020-09-01   2026-08-27
topTraderAccountRatio   4,192,671   2020-09-01   2026-08-28
topTraderPositionRatio  4,193,033   2020-09-01   2026-08-28
```

Plus **cross-venue, added 4 Sept 2026** — the only non-Binance data here:

```
bybitClose              322,100   2023-01-01 -> 2026-09-04
bybitOpenInterest       322,100   2023-01-01 -> 2026-09-04
okxClose                322,090   2023-01-01 -> 2026-09-04
bybitFundingRate         40,270   2023-01-01 -> 2026-09-04
```

Verified against the live APIs by `pnpm --filter api venue-reconcile`: 7,175 rows
over 30 days across five coins, **worst mismatch 0.000 bp, zero orphans.**

Plus, on disk: **13,338 bookDepth day-files** (2023-01-01 →) and **440 1-minute
kline month/day files, 677 MB** (2023-01 →).

## 4.1 Constraints that must not be re-derived

- **`bookImbalanceNear` starts 2026-01-15.** Binance did not publish the 0.2%
  depth band before then. Seven months against everyone else's 3.6 years — it
  cannot clear a |t| > 3 bar on its own window.
- **32 days have no bookDepth file at all** — 2023-02-08/09 across every coin (a
  Binance outage) plus scattered singles. Holes in the record, not quiet books.
- **`topTraderAccountRatio`, `topTraderPositionRatio`, `takerBuySellRatio5m`
  start 2023-01-01.** 2022 is 87.2% blank for the first two, 35.0% for taker. A
  split straddling it compares two datasets, not two periods.
- **Never build a 1h taker feature by averaging 5m ratios** — 13.9% off at the
  median, 67.3% at worst.
- **Archive rows are stamped in the live convention.** Feeding raw archive
  timestamps to `flowAsOf` embargoes them one bar early.
- **Binance liquidation data is gone.** The free endpoint was removed.

## 4.2 What other venues offer (probed 1 Sept 2026)

| | 1h price | funding | open interest |
|---|---|---|---|
| Binance | have it | 2020+ | 2020+ |
| OKX | 2023-01 ✓ | **~3 months only** | **~1 month only** |
| Bybit | 2023-01 ✓ | 2023-01 ✓ | 2023-01 ✓ |

**Corrected 3 Sept 2026.** This table first said OKX open interest reached
2023-01. It does not, and the way it looked as though it did is worth keeping:
the endpoint ignores `begin` on its own and returns the most recent rows
whatever window you ask for. Counting rows says "100 rows, works fine". Reading
the timestamps says every one of them is from today. Only `begin` AND `end`
together filter, and that combination returns nothing before roughly a month
ago. The first probe counted rows.

So OKX contributes **price only** to a 2023-start panel. Bybit contributes
price, funding and open interest.

---

# Part 5 — The measurement rig

**The strategy is dead; the rig is the asset**, and it works against any
strategy. 32 test suites, **501 tests**, all passing.

- **One scorer** — `src/common/replay/trade-scoring.ts`. Fills the ladder leg by
  leg, sizes to what was held, charges cost in R, derives status in one place.
- **`aggregate` with a permanent marking gap** — reports marked average,
  resolved-only average, and the difference, always.
- **Look-ahead guards that run on every bar** — `completedAsOf`, `flowAsOf`, and
  a check that throws if any series extends past the decision bar.
- **The resolution gate** — `pnpm interval` exits non-zero when the interval is
  too wide to decide anything.
- **Golden harness** — frozen inputs and outputs, so a scoring change announces
  itself.
- **`BASE_check` bit-identity** — an arm configured identically to the base trade
  must reproduce it to the floating-point bit.
- **Shuffle controls everywhere** — Phase B, C and D each permute which coin got
  which outcome within each hour and re-run the whole pipeline.
- **A rank-persistence gate** — separates "this feature times the market" from
  "these coins beat those coins", which a cross-sectional IC cannot do alone.
- **Purged K-fold with embargo** and a holdout touched exactly once.
- **Python research stack** — `.venv-research`, numpy/pandas/scikit-learn,
  pinned in `research/requirements.txt`, with `research/test_phase_d.py` planting
  an oracle (recovered at 125.9 bp) and noise (−0.6 bp).

## 5.1 Bugs found in the measurement code itself

Recorded because each one would have produced a confident wrong answer:

- Sample weighting by 1/concurrency — a **no-op** on an evenly sampled panel.
- A market-context column built from `fwd4h` and lagged to stay legal. Legal, and
  one refactor from being the target.
- Market-context columns cross-sectionally standardised — identical across coins
  by construction, so 0/0, so every column entirely NaN. sklearn reported it as
  `window shape cannot be larger than input array shape`.
- `fundingRate` capped at **500** rows despite accepting `limit=1000`; the short
  page tripped the live-edge break and a 2,200-day backfill silently collected
  166 days per coin while reporting `failed: {}`.
- The bookDepth 0.2% band missing before 2026-01-15 caused the importer to
  discard the ±5% data that was present, voting three years of archive to zero
  while reporting a successful run.
- The EventBridge rule passed `days: 30`, silently beating the service constant
  it was supposed to read.

## 5.2 Two statistical readings that were wrong and are retracted

- **"6 of 8 dev-holdout sign flips with a negative correlation is damning."** The
  shuffled control — noise by construction — scored *better* on that statistic (2
  flips, +0.540). At n = 8 it carries no information.
- **"99% fill, +1.31 bp net at maker fees."** The fills were marketable, i.e.
  taker.

## 5.3 The local/Neon trap

Adding a metric to `METRICS` starts it accumulating in **Neon** and leaves
**local** with nothing. That happened to `fundingRate` on 30 Aug, and a panel
built the same day would have had an empty column — which does not fail, it
quietly shrinks the sample. `scripts/flow-backfill.ts` exists for this and
prints its masked target URL before writing.

---

# Part 6 — What is open

## 6.1 Road 1 — pay a smaller fee: **closed**

Stage 0 measured it. The orders fill (88–92%) and fill favourably. The gross they
fill into is negative over the longer sample.

## 6.2 Road 2 — data this panel does not contain

**1. Cross-exchange dispersion — DONE 4 Sept 2026, and it fails.** Collected,
reconciled at 0.000 bp, measured against a pre-registered money bar. Nine of
twenty tests clear |t| > 3.0 at up to 9.77; zero of nine clear the money bar. The
information is real and worth one to two basis points.
[`evidence/CROSS_VENUE_IC.md`](evidence/CROSS_VENUE_IC.md).

**2. Deribit implied volatility and skew — open, not started.** Free, and the
only *forward-looking* input available: nothing in the panel is a market
expectation, and every feature tested so far is a description of what already
happened. Only BTC and ETH have liquid options, so 2 of 10 coins, which means it
cannot be a cross-sectional feature on this universe — it would have to be tested
as a time-series or regime input, which is a different construction from
everything in Phases A–D.

**3. `aggTrades` order flow — open, lowest ratio.** Free but ~440 GB, and
`takerBuySellRatio5m` is already a coarse version of it.

Ruled out: Glassnode / CryptoQuant (predictive metrics paywalled), Coinglass
liquidations (paid; Binance killed the free endpoint), social sentiment
(timestamp integrity is a look-ahead machine), more coins (§14e measured the long
tail bleeding 0.436%/week).

**The bar road 2 has to clear is higher than a top-up.** Stage 0 measured
−8.20 bp gross over 3.1 years. New data must turn a negative into something that
also covers 3.6 bp. That is "the current feature set carries nothing and the new
data carries the whole thing", not "add a little more signal".

Cross-venue was the best candidate on that list and it produced the
second-largest t-stat in the project's history while moving one to two basis
points. That is the clearest statement available of what this panel's problem
is: **the constraint has not been finding information. It has been finding
information large enough to pay a fee**, and nine tests at |t| > 3 that move
1 bp say the two are close to unrelated here.

## 6.3 Deliberately parked

Known, measured, not being fixed — see `ROADMAP.md` §3 for the full list with
line numbers. The reason is unchanged: these move a result that is negative by a
wide margin, on inputs separately shown to carry no edge.

## 6.4 Offered and not done

- Amend commit `c0852d8`, whose message says "all seven level timeframes" while
  `LEVEL_TIMEFRAMES` is three (`12h/4h/1h`).
- Collector/analysis health monitoring in the 03:30 Lambda.
- Whether to track `docs/archive/` and `docs/reference/` in git. **Everything
  under them exists on exactly one laptop.** That is a real risk and it is not
  solved; the fix also publishes them, since the repository is public.

---

# Part 7 — What is true regardless

The analyst works. It reads the market on a schedule, finds levels and zones
correctly, writes a plan, scores what happened, and shows the record. The zone
and level code was audited (`archive/ZONE_AUDIT.md`, questions 1–2) and the
checklist units bug found there was real and is fixed.

**What has been tested to exhaustion is the claim that it predicts returns.**
Eighteen tests, roughly 550,000 observations in the older ones and 320,000 rows
in the newer, and the strongest surviving statement is: there is a small amount
of real directional information in these features, worth about a third of a
retail fee.
