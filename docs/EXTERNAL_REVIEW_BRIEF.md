# Meridian — External Review Brief

> ⚠️ **SUPERSEDED by `STATUS_FOR_REVIEW.md` (4 Aug 2026).** Kept as the record of what
> we actually asked in the first review round. **Its headline result is retracted:**
> the +0.117R / p=0.0041 figure in §3 did not survive month-clustered inference and
> is not reproducible — see `STATE_OF_PLAY.md` §14c. Four further hypotheses were
> tested after this document was written and all four also failed. Do not quote
> numbers from this file.

**Date:** 3 Aug 2026 · **Purpose:** independent second opinion on direction before we build the next phase.

You have no access to the repository. Everything needed to judge this is in this document. We are not asking for encouragement — we are asking whether the reasoning holds. **§8 lists the specific things we think are most likely to be wrong. If you only address one section, address that one.**

---

## 1. The product

A personal, non-commercial crypto analysis tool for one user who trades **manually**.

The user asks about a coin. The tool answers one of two ways:

- **Tradeable now** → direction, entry, stop, targets, position size.
- **Not tradeable now** → *why not*, and **the specific condition that would make it tradeable, so the user knows when to come back.**

The second half is the actual product. Every existing tool the user tried answers "no signal" and leaves you refreshing it. The intended output looks like:

> **AVAX — not tradeable at $22.40.** Confluence zone $19.80–20.10 (0.5 Fib + 4h support + trendline). 11.6% below current price. If it gets there: stop $19.20, TP1 $23.40. **Re-check when price is within 2% of $20.10.**

It is a decision-support tool, not an autonomous trader. It never places an order.

### Constraints that shape every decision

| Constraint | Consequence |
|---|---|
| Trades manually on **Kraken, from Canada** | Binance is data-only (accessible for market data, not for trading). Execution venue fees and liquidity are Kraken's. |
| Manual execution | Signals must survive being acted on hours later. No sub-minute anything. |
| Wants **frequent** trades — a tool that says WAIT 95% of the time is a failed product | This is a genuine product requirement, and it collides with the statistics. See §6. |
| Personal, non-commercial, single user | No scale requirements. Correctness over throughput. |
| Budget-conscious | Free/cheap data sources. One LLM call per analysis at most. |

---

## 2. What is built

A TypeScript monorepo: NestJS API + Next.js frontend + Postgres.

The analysis pipeline, in order:

1. **Fetch** — Binance klines, 250 candles, cached 5 min, retries, stale fallback.
2. **Indicators** — RSI, Bollinger Bands(20,2), ATR, ADX/±DI, QQE, BB-bandwidth series + percentile, swing-point S/R, Fibonacci. Computed once per run and frozen.
3. **Regime classification** — `COMPRESSION` if BB bandwidth is in the bottom 15th percentile of its own history → else `TRENDING` if ADX > 25 → else `MEAN_REVERSION`.
4. **Route** — `COMPRESSION` goes to a squeeze-breakout module (20-candle high/low envelope + 1.5× volume confirmation). Everything else goes to a **5-point checklist**.
5. **The 5-point checklist** — five binary conditions, 20 points each, 0–100 total:
   - RSI extreme (with a z-score variant)
   - QQE cross agreement
   - Price at a Bollinger extreme (within 10% of a band)
   - Market structure agreement (HH/HL vs LH/LL)
   - Proximity to a support/resistance level

   Tiers: `WATCHING` <40 · `TACTICAL_SETUP` 40–59 · `STRATEGIC_TRADE` 60–79 · `APEX` 80+.
6. **Claude call** (optional, gated on tier) — produces the human-readable plan and levels. Fail-soft: any error returns a synthetic WAIT.
7. **Persist** the run; a separate service later replays real candles against stored entry/stop/target to classify outcomes.

Also built: position sizing (1–2% risk rule), leverage caps, risk management.

**The strategy logic is derived from a 116-page trading playbook** by a discretionary trader ("Miraj") that the user follows. §5 is about the fact that we implemented it wrong.

### The measurement harness — the most important thing we built

`pnpm backtest <coin> <timeframe>` replays historical candles through **the real production pipeline, in-process**. No server, no database, no LLM calls. ~0.6 s per coin. Flags: `--coins A,B,C`, `--folds N` (walk-forward), `--random long` (control), `--csv`.

This means any hypothesis is testable in under a minute for $0. Every number below came from it.

**Cost model.** Not a flat constant — cost is charged in R-multiples against each trade's own stop distance:

```
cost_R = round-trip-% ÷ stop-distance-%
```

Default round trip = 0.14% (Kraken futures taker 0.05%/side + 0.02% slippage/side). This matters enormously and is the single most load-bearing modelling choice in the whole exercise — see §6.

---

## 3. Results — the honest sequence

Presented in the order they happened, including the ones that killed our hypotheses.

| # | Experiment | Result |
|---|---|---|
| 1 | Fixed 3 wiring bugs (below) | Real bugs, real fixes, guarded by tests |
| 2 | Binary checklist, 4h, 125 days | −0.096R/trade (n=493) |
| 3 | Replaced binary scoring with continuous scoring | −0.096R → −0.096R. **No change.** |
| 4 | Paged in 21 months of data (n=2,353) | +0.027R. Statistically zero. |
| 5 | Walk-forward + Deflated Sharpe | Fold spread 6.5× the mean; DSR 0.162 (need ≥0.95). **FAIL** |
| 6 | Added funding rate as an input | corr(funding, R) = 0.0021 over 2,353 trades. Nothing. |
| 7 | Open interest | **Untestable** — Binance retains only ~31 days. Deliberately not built. |
| 8 | **1d timeframe, long-only** | **+0.117R over 942 trades. Passes every test above.** |

### The bugs (fixed, and they mattered)

Three of the five checklist inputs were mis-wired, all inherited from a refactor that "preserved behaviour verbatim" — faithfully preserving something already broken.

| Bug | Effect |
|---|---|
| The 20-period SMA was passed as "current price" | BB-extreme proximity computed to **exactly 50.0% on every run**, against a 10% threshold. Condition 3 was **structurally incapable of ever passing.** |
| RSI z-score computed against the price series, not the RSI series | For BTC: `(30 − 100000) / 1500 ≈ −66`. Longs got a free 20 points always; shorts never could. |
| Orphaned prompt-builder code | 228 dead lines; 12 tests asserting against a format nothing produced. |

Net: max reachable score was 80/100, one condition was dead weight, and longs got 20 free points shorts didn't. **Every tier threshold in the system was tuned on top of that distortion**, so the thresholds are themselves suspect.

### What repeatedly failed to work: the score does not rank

Across every timeframe below 1d, bucketing trades by checklist score produced **no monotonic relationship** with expectancy. Higher score was frequently *worse*. This survived: a rewrite from binary to continuous scoring, a 5× increase in data, and nine different exit configurations.

Walk-forward, 8 folds, ~468 bars each (the 4h result):

| fold | n | expectancy |
|---|---|---|
| 1 | 290 | +0.068R |
| 2 | 280 | +0.098R |
| 3 | 284 | +0.086R |
| 4 | 290 | **+0.170R** |
| 5 | 281 | +0.006R |
| 6 | 292 | −0.015R |
| 7 | 285 | **−0.272R** |
| 8 | 287 | +0.011R |

Mean +0.019R, fold-to-fold sd 0.124R — **the spread is 6.5× the mean.** The aggregate is carried by folds 1–4 and nearly erased by fold 7 alone. That is noise, not edge. DSR 0.162 against a 0.95 requirement: our Sharpe is *below* what the luckiest of 21 random strategies would be expected to produce.

### The one result that survived: 1d, long-only

10 coins, 2018-04 → 2026-08 (8.3 years, multiple full cycles):

| route | n | win% | expectancy |
|---|---|---|---|
| TACTICAL_SETUP | 766 | 52.2% | +0.148R |
| SQUEEZE | 176 | 45.5% | −0.019R |
| **ALL** | **942** | **51.0%** | **+0.117R** |

| test | result |
|---|---|
| **Deflated Sharpe** (assumed 40 trials) | **0.972** → PASS (≥0.95) |
| **Fold stability** (8 folds) | 7/8 positive, mean 0.090R vs spread 0.087R — mean ≥ spread for the first time |
| **Survivorship check** (BTC+ETH only — top-2 by 2018 cap, no hindsight selection) | +0.122R, same shape |
| **Random control** | strategy longs +0.2373R vs random longs +0.0577R · Welch t = 2.88, **p = 0.0041** |
| Median modelled cost | 0.006R (negligible at 1d — the stop is wide in % terms) |

The random control is the one we lean on. Crypto rose over the sample, so *any* long-biased strategy looks profitable. Random long entries with identical exit logic earn +0.058R — that is pure market drift. The strategy earns +0.237R. **We are claiming the ~+0.18R difference is signal, not beta.**

**Two hard constraints came out of this:**

**(a) Long-only.** Shorts are exactly zero: −0.008R over 462 trades. The edge does not reverse. We have no short product.

**(b) Cost sets a hard timeframe floor.** Because tighter stops mean the same fee eats a larger share of risk:

| timeframe | median cost | gross | **net** |
|---|---|---|---|
| 1d | 0.006R | +0.123R | **+0.117R** |
| 4h | 0.041R | +0.023R | −0.018R |
| 1h | 0.106R | +0.005R | −0.101R |
| 15m | 0.252R | −0.071R | −0.323R |

**Going faster is strictly worse, and it's worse for two independent reasons at once** — gross edge decays *and* cost rises. Cost engineering (wider stops, maker-only orders) can take 15m from 0.25R to ~0.03R, but it cannot manufacture gross edge that isn't there.

---

## 4. Frequency: our answer to the product requirement

942 trades / 8.3 years / 10 coins ≈ **1 trade per coin every 3.7 weeks**, ≈2/week across the basket.

The user wants more. The only direction that doesn't destroy the edge is **breadth, not speed**:

| universe | approx trades/week |
|---|---|
| 10 coins | ~2 |
| 30 coins | ~6 |
| 100 coins | ~20 |

Same edge per trade, more simultaneous opportunities. This is our answer to "I don't want it saying WAIT all the time": widen the universe, never shorten the bar.

---

## 5. The diagnosis — we built a scanner; the source material describes a level system

After reading the 116-page playbook end to end, we believe we found a **category error in the implementation**, not a tuning problem.

**The 5-point checklist is a confirmation filter, applied *after* you have already located a price zone. We implemented it as a scanner that fires whenever the score crosses 40 on any bar.**

| | Playbook / how discretionary traders actually work | What we built |
|---|---|---|
| Trigger | price **arrives** at a zone marked in advance | score crosses 40 on some bar |
| Entry | resting limit orders inside the zone | market order at the signal bar's close |
| Timeframes | hierarchical: 12h Fib → 4h S/R → 1h micro | one timeframe, everything at once |
| Levels | drawn once, persist for weeks | recomputed every bar on a price-anchored grid |
| Stop | below the zone − ATR (setup **invalidation**) | entry − 1.5×ATR (volatility only) |
| Targets | next resistance, then the next, then major | entry + 2×risk (arbitrary) |
| Position | 3 scaled entries (20/40/40) | one entry, full size |
| Checklist | **confirms** a located trade | **generates** the trade |

### This inversion explains every measurement we took

- **The score doesn't rank** — it was never supposed to. It's a yes/no gate applied *after* location. Asking it to rank is asking the wrong question of it.
- **It fires on ~50% of bars** — we deleted the location requirement, which is exactly what makes setups rare. The playbook author's own frequency is **2–5 trades per month**, not 400.
- **Costs kill low timeframes** — market orders pay taker fees *and* get no price advantage. Resting limits at a pre-marked level pay maker fees *and* fill at a better price. That is the entire 0.25R → 0.03R swing, available for free, and it is only available if you know the level in advance.
- **Stops feel arbitrary** — an ATR multiple has no relationship to whether the setup is invalidated.
- **2R targets underperform** — price stalls at levels, not at multiples of our risk.

### The piece we never built at all: WAITING

Playbook Step 5 is literally *"wait for price to reach the zone."* We have no concept of a zone that exists, sits armed, and triggers later. Every run in our system must decide **now**.

Note that this missing piece is *also* the product spec from §1 — "tell me why not, and when to come back." **The zone is the answer to "when."** It falls out for free.

### Missing in code

Fibonacci from higher-timeframe swings · trend lines (3+ touches, extended forward) · a persistent level store with touch history · cross-timeframe confluence scoring · an armed-zone state machine · level-based stops and targets · scaled entries.

**Already solid:** data plumbing, indicators, the backtest harness, position sizing, risk management.

### Where we think we can beat the playbook

Hand-drawn S/R is subjective — which is also why our grid-based version was unstable (a 0.07% price move swung the score 20 points, because the level grid is anchored to current price and measured from zero). **Order blocks are objective**: the last opposing candle before a break of structure with displacement. Codeable, reproducible, no discretion.

And the thing no human does: **run it across 200 coins every 12 hours, tracking every armed zone simultaneously.** Our edge over a discretionary trader is *coverage*, not better analysis.

---

## 6. What we plan to build next

Ordered. Each step is measurable with the existing harness before the next one starts.

1. **Level engine** — swing detection → higher-timeframe Fibonacci → order blocks → persistent store with touch counts. Replaces the price-anchored grid that caused the instability.
2. **Confluence scoring** — how many *independent* levels agree within a price band, measured across 12h/4h/1h.
3. **Zone state machine** — `ARMED → APPROACHING → TRIGGERED → INVALIDATED`. This is the WAITING concept and the "when to come back" output.
4. **Level-based stops and targets** — stop below the zone − ATR; targets at the next levels up. Replaces 1.5×ATR and 2R.
5. **Backtest head-to-head against the current version** — same harness, same coins, same period, same cost model, same random control.

The claim we are testing: the +0.117R result is a **degraded** version of the intended method — right indicators, wrong entry mechanics. If zone-based entry is genuinely better, that number should improve. If it doesn't, we will have measured it rather than assumed it.

### Methodology rules we now hold ourselves to

These were all learned by getting them wrong first:

1. **Never conclude from a small sample.** A 493-trade result read −0.096R. At 2,353 trades the same strategy read +0.027R. Both were noise, and the first one nearly caused us to rewrite the wrong thing.
2. **Always run the random control.** Crypto rose over 2018–2026. Every long-biased strategy looks profitable. Only the delta versus random longs with identical exits is evidence.
3. **Cost derives from stop distance**, never a flat constant: `cost_R = round-trip% ÷ stop%`.
4. **Correct for multiple testing.** DSR ≥ 0.95.
5. **Do not build on data you cannot backtest.** This is why open interest was dropped despite good theory — 31-day retention makes it permanently unfalsifiable for us.

---

## 7. What we are asking you

1. **Is the §5 diagnosis right?** Is "we inverted a confirmation filter into a scanner" a sufficient explanation for the measurements in §3 — or are we constructing a satisfying narrative around a strategy that simply has no edge, and this is the sunk-cost trap?
2. **Is the plan in §6 the right next move**, or is there a cheaper test that would falsify it faster? We would much rather kill it in an afternoon than build it over two weeks.
3. **Is the 1d result trustworthy enough to build on?** Attack §8 below.
4. **What are we not seeing?** Different data class, different target variable, different structure entirely.

---

## 8. Where we think we are most likely wrong

We would rather you attack these than validate the rest.

**(a) The 942 trades are not 942 independent observations.** They are 10 crypto assets over the same calendar window, and crypto cross-sectional correlation runs ~0.7–0.9 in both directions. The effective independent sample could plausibly be a small multiple of the number of *time periods*, not the number of trades. Our Welch t-test (p = 0.0041) assumes independence across trades and is therefore **optimistic by an unknown factor**. Does p = 0.0041 survive a block bootstrap by time period, or a coin-clustered standard error? We have not run that. *We think this is the single biggest hole in the result.*

**(b) The DSR trial count is a guess.** We assumed 40 trials. The true number of configurations we looked at — across timeframes, routes, directions, exit configs, scoring variants — may be materially higher, and DSR is sensitive to it. At what assumed trial count does 0.972 fall below 0.95, and is that count plausibly one we already exceeded?

**(c) The random control may not be a fair control.** Random longs are drawn uniformly over the sample. Strategy longs are not — they cluster where the indicators fire, which may be systematically in favourable regimes. If so, part of the +0.18R delta is *regime timing*. Regime timing is arguably a real edge, but it is a **different, weaker claim** than "these five indicators predict direction," and it would degrade differently out of sample.

**(d) Our cost model may understate the user's real costs.** We model 0.14% round trip (Kraken *futures* taker + slippage). Kraken **spot** in Canada is closer to 0.25% maker / 0.40% taker → ~0.80% round trip, roughly 5.7× higher. By arithmetic on the published numbers (median 1d cost 0.006R at 0.14% implies a median stop of ~23%), 1d cost would rise to ~0.034R — the +0.117R verdict survives comfortably. But at 15m the same adjustment takes cost from 0.25R to ~1.4R, i.e. from bad to unsurvivable. **Does this change the argument anywhere it matters?** We think not, but we would like it checked.

**(e) The plan in §6 introduces the overfitting risk the current system does not have.** This is the concern we hold most strongly and it cuts against our own plan. The current strategy has **zero fitted parameters** — every threshold is hardcoded from the playbook, which is precisely why it cannot be overfit and why we trust the 1d number at all. The level engine introduces many free parameters: swing lookback, which Fibonacci ratios, order-block definition, displacement threshold, confluence band width, how many levels constitute confluence, ARM distance, trigger distance, invalidation rule. **We would be trading a zero-parameter system for a high-dimensional search space, and the DSR bar gets harder in exactly the same motion.** How would you constrain this? Fix everything from the playbook and fit nothing? Or is that self-deception, since we'd still be selecting *which* playbook readings to encode?

**(f) The maker-fill assumption is doing real work and is optimistic.** The 0.25R → 0.03R cost improvement depends on resting limit orders filling at the level. A backtest will happily record a fill any time price touches the zone. Reality: queue position, wick-only touches that fill you then reverse, and the adverse-selection case where you *only* get filled when price is about to keep going. How much of the claimed cost saving is real?

**(g) "Coverage over 200 coins" has costs we have not modelled.** Kraken listing availability, liquidity and spread on small caps (where the modelled 0.14% is fantasy), and survivorship bias in any coin list we assemble in 2026 and backtest to 2018. Our BTC+ETH check partially addresses the last one, but only for the top of the market.

**(h) The whole thing might be right and still not be a product.** ~2 trades/week at +0.117R, executed manually. Is that worth building, versus the honest alternative of using the pipeline purely as a *state-explanation and risk-sizing assistant* and dropping the prediction claim entirely?

---

## 9. Summary in five lines

1. We built a crypto analysis tool; a first honest backtest showed the core strategy had no edge at 4h/1h/15m.
2. At 1d, long-only, it shows +0.117R over 942 trades and passes DSR, fold stability, a survivorship check, and a random-long control at p=0.0041.
3. We then found that we had implemented a confirmation filter as a scanner — deleting the "wait for price to reach a pre-marked zone" step that makes setups rare and entries cheap.
4. The plan is to build that missing level/zone machinery and measure it head-to-head against the current +0.117R baseline.
5. **We want to know whether that plan is right before spending two weeks on it — and specifically whether §8(a) and §8(e) sink it.**
