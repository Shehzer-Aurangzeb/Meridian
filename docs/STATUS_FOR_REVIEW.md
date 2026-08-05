# Meridian — Status for Review

**Date:** 4 Aug 2026 · **Purpose:** independent verification of our reasoning and our plan.

This is written to be read cold. You do not need repository access.

---

## 0. If your context on this project is "backend works, endpoints exist"

Your picture of Meridian is probably:

> Monorepo running. Backend: Binance service, indicators service, Claude service, `POST /analysis/analyze` orchestrating the flow and saving every analysis. History/performance endpoints comparing past suggestions to actual price movement to compute a **win rate**. Frontend: dashboard with sidebar, Analysis page functional.

**All of that is still true and still runs.** What changed is that we built a backtest harness and measured whether the thing it produces actually predicts anything. It does not. Five separate hypotheses were tested and all five failed.

**One correction matters more than any other for you:** that **win rate is not a measure of profitability**, and we now have a clean demonstration. One of our tests produced a **63.1% win rate and lost money** — because average reward was 0.25× average risk, so it needed a >80% win rate to break even. A win rate with no reward/risk ratio, no transaction costs, and no random-entry control tells you almost nothing. Every conclusion in the older docs that leans on win rate should be treated as unsupported.

---

## 1. THE GOAL

A **personal, non-commercial** tool for one person who trades manually. Not a product to sell. That matters: we are not being cautious to protect users, we only want to know whether it works and *how well*.

The tool should take a coin and answer one of two ways:

1. **Tradeable now** → **which direction** (long *or* short — deciding direction is the point, not defaulting to long), entry, stop, targets, position size.
2. **Not tradeable now** → *why not*, and **the specific condition that would make it tradeable**, so the user knows when to come back.

Requirements that shape everything:

| requirement | consequence |
|---|---|
| Decide **direction** | long-only is not the product; it must say short when short |
| **Venue-agnostic** | do not design around one exchange's fees or listings; report the *breakeven cost* instead so any venue can be judged |
| Manual execution | signals must survive being acted on hours later; nothing sub-minute |
| Wants **frequent** signals | a tool that says WAIT 95% of the time is a failed product |
| Personal use | correctness over polish; "play right, not safe" |

The second answer — *why not, and when to come back* — is the part the user most wants, and note that it is **not a prediction**. It survives everything below.

---

## 2. What we built to measure things

This is the durable asset and it is why the findings are trustworthy. Four command-line tools, each with a `--self-check` that fails loudly if its own logic breaks:

| tool | what it does |
|---|---|
| `backtest.ts` | replays historical candles through the **real production pipeline** in-process. No server, no database, no LLM calls. ~1s/coin. |
| `zonetest.ts` | tests price-level / zone-based entries with parameters read from the trading playbook |
| `panel.ts` | builds a date-aligned cross-coin panel (399 coins × 1,200 days) for long/short portfolio tests |
| `bootstrap.ts` | **block bootstrap by calendar month** — the inference layer |

### Why the bootstrap matters

A normal t-test assumes trades are independent. Ours are not: crypto assets move together (cross-sectional correlation ~0.7–0.9) and holding periods overlap. Resampling **whole calendar months** preserves both kinds of correlation, so the unit of evidence becomes the *month*, not the *trade*. This one change invalidated our best-looking result (§3.1).

### Cost model

Cost is never a flat constant. It derives from the trade's own risk:

```
cost_in_R = round-trip-cost-% ÷ stop-distance-%
```

So the same fee is trivial on a wide daily stop and fatal on a tight 15-minute stop. For portfolio tests, cost is charged on **measured turnover**, and we report the **breakeven round-trip cost** — the fee level at which the edge dies. That number is venue-independent by construction.

---

## 3. What we tested, and what happened

Five hypotheses. All five negative.

| # | hypothesis | result |
|---|---|---|
| 1 | 5-indicator checklist as a **scanner** | no edge vs random long entries |
| 2 | same checklist as a **confirmation filter** | structurally unreachable — mis-wired |
| 3 | **price-level / zone arrival** entries | **significantly worse** than random |
| 4 | **cross-sectional momentum**, long/short | not significant; worse than random risk-adjusted |
| 5 | **cross-sectional funding** (positioning), contrarian | no edge — a coin flip |

### 3.1 The result we retracted

We first measured the checklist on daily bars and got **+0.117R per trade over 942 trades, p = 0.0041** against a random-long control. It looked real. It was not, for three reasons:

- **Unreproducible.** The exact command was never recorded. Re-running and sweeping the stop width gives +0.065R (default), +0.194R, +0.147R, +0.160R — nothing lands on the recorded number. Its configuration is lost.
- **"No fitted parameters" was false**, and that claim was the whole reason we believed it. Stop width alone swings expectancy 3×. Timeframe was also chosen *after* three others failed.
- **The p-value assumed independence.** Month-clustered: the delta vs random longs is **+0.003R (P(≤0) = 0.61)** at default settings, and **+0.189R, CI [−0.026, +0.368], P(≤0) = 0.055** at the best of four swept stop widths — and that 0.055 is before correcting for having swept to find it.

**No configuration beats random long entries.**

### 3.2 The zone test — a clean negative

Our leading theory was that we had inverted the strategy: the checklist is meant to *confirm* a trade after price arrives at a pre-marked level, and we had turned it into a *scanner* firing whenever a score crossed a threshold. Every prior measurement was consistent with that story.

**Run 1** applied the playbook's 3-of-5 confirmation gate and produced **zero trades from 1,101 zone arrivals.** Instrumenting each stage showed why, and it was not the hypothesis:

- 1,393 zones armed; 1,101 (79%) reached by price — the mechanism worked
- **735 of 839 arrivals were evaluated as `short` setups while price was arriving at a *support* zone**
- Because a short tests `RSI ≥ 60` and the *upper* Bollinger band, those two conditions passed **0 out of 839 times**
- The checklist's own support/resistance condition passed **1.2%** of the time *while price stood inside a multi-level confluence zone*

The checklist derives its own direction and disagreed with the zone 88% of the time. **A confirmation filter must be told the direction of the setup it is confirming; ours decides for itself and then vetoes.** Also: two different level systems coexist in the code and contradict each other almost totally.

**Run 2** removed the gate and tested the location claim alone — does arriving at a pre-marked zone beat a random entry with identical exits?

| | n | win% | median reward/risk | expectancy | 95% CI |
|---|---|---|---|---|---|
| zone arrival | 886 | 63.1% | 0.25 | **−0.180R** | [−0.231, −0.115] |
| random entry | 623 | 75.0% | 0.21 | −0.059R | [−0.109, −0.005] |
| **delta** | | | | **−0.121R** | **[−0.166, −0.046]** |

**The delta excludes zero on the negative side.** Zone entries are significantly *worse* than random. Both arms lose because the exit rule needs an >80% win rate, but that is shared by both arms and therefore cannot explain the delta — the delta isolates entry location, and location hurt.

### 3.3 Momentum and funding — market-neutral, so drift cannot fake it

Tests 4 and 5 rank 399 coins and go **long the top decile, short the bottom decile**, weekly, equal capital per leg. The market-neutral construction is deliberate: every earlier test was ambiguous because "did the signal work" was entangled with "did crypto go up." Here the book is half long and half short at all times, and shorts get judged on relative weakness rather than on fighting an uptrend.

Two bars, both pre-registered: beat a **random-direction** control (same position count, sides shuffled) *and* beat **always-long**.

| | strategy | random direction | delta | 95% CI | P(≤0) |
|---|---|---|---|---|---|
| momentum (30d return) | +0.273%/wk | +0.183%/wk | +0.0009 | [−0.0065, +0.0078] | 0.38 |
| funding (contrarian) | +0.037%/wk | +0.027%/wk | +0.0001 | [−0.0051, +0.0053] | 0.48 |

Momentum's point estimate is above random but nowhere near significant — **and risk-adjusted it is worse**: Sharpe 0.45 vs random's 0.52, because its volatility is 1.7× higher (4.35% vs 2.52% per week). For a book anyone would actually run, that is the comparison that matters and momentum loses it. Funding is a coin flip.

---

## 4. Bugs we found in our own tests (why we trust the numbers)

Each of these was caught *before* reporting a result, and each would have produced a wrong conclusion:

1. **Three mis-wired checklist inputs.** The 20-period moving average was passed as "current price," making the Bollinger condition compute **exactly 50.0% every single run** against a 10% threshold — structurally incapable of passing. And an RSI z-score was computed against the *price* series, giving values like −66, which handed every long a free 20 points that shorts could never get. Every threshold in the system had been tuned on top of that distortion.
2. **A non-contiguous panel date axis.** We built dates as the *union* across coins, but every horizon was expressed in array steps. The leading 179 slots were covered by exactly **one delisted coin (FTT)**, followed by a **127-day hole** — so a "30-day" signal actually measured 157 days and a "7-day" hold spanned months.
3. **A funding strategy that never collected funding.** The contrarian funding test ranked on funding but did not apply the funding *cashflow*, and shorting the crowded-long decile **receives** that funding. It read −0.593%/week; corrected, it read +0.037%/week. **The entire result was the omission.**
4. **Baskets silently dropping positions** with no price on the exit date — which removes exactly the positions most likely to have collapsed, biasing every basket upward and hitting the short leg hardest.
5. **An assumed cost model.** We charged the always-long control a full round trip per period when it only turns over as membership changes. Overcharging a control flatters the strategy, so cost is now *measured* from turnover.
6. **Our own reporting bug:** a wholly-negative confidence interval printed "includes zero." That would have understated finding 3.2.

We also found we had **misread the source playbook** in three places: its Fibonacci levels are quarter-based (0/0.25/0.5/0.75/1.0), not the standard 0.236/0.382/0.618; scaled entries are 20/20/60; the stop is **level − 1.0×ATR**, anchored to the level rather than `entry − 1.5×ATR`; and its minimum entry requirement is **3 of 5 conditions (60/100)** — meaning the tier we had been trading at (40/100) was *below the playbook's own threshold all along*.

---

## 5. Two findings that are not about edge but constrain everything

1. **Breakeven round-trip cost.** Momentum at 48% weekly turnover breaks even at ~0.71% round trip including funding cashflow (~0.31% excluding it — and the gap itself is driven by rare funding episodes). Retail spot fees of 0.5–0.8% straddle that range. **Any high-turnover strategy is cost-bound before its signal is even considered.**
2. **The long tail decays.** The equal-weight top-100 altcoin universe lost **~0.4% per week** across 2023–2026 while majors rose. This directly undermines our earlier plan to solve the "it says WAIT too often" problem by widening the universe: **breadth adds decay along with opportunity.** More coins raises trade count and lowers per-trade quality simultaneously.

An unexpected fact worth recording: momentum **winners** carried *negative* mean funding (−0.0138%/day) while losers were slightly positive. Coins that had rallied were the ones with crowded *shorts paying longs* — the opposite of the naive assumption.

---

## 6. Methodology rules we now hold ourselves to

Learned by getting each one wrong first:

1. Never conclude from a small sample — a 493-trade result read −0.096R; the same strategy at 2,353 trades read +0.027R. Both noise.
2. Always run a random control **at matched parameters**. Crypto rose over the sample, so any long-biased strategy looks profitable.
3. Cost derives from stop distance, never a flat constant.
4. **Cluster-resample before believing any p-value.** The unit of evidence is the month.
5. **Record the exact command with every result.** A number whose configuration is lost is not a result.
6. Never claim "no fitted parameters" without listing them. Harness defaults are choices; sweeping them is fitting.
7. An edge that exists at only one parameter value is drift until shown otherwise.
8. **Instrument the funnel before believing a zero** — "no signals" and "broken wiring" look identical without per-stage counters.
9. A defect shared by both arms cannot explain a delta.
10. **Compare risk-adjusted, not just mean.** Momentum beat random on mean while losing on Sharpe.
11. If a strategy ranks on a cashflow, the backtest must pay or receive that cashflow.
12. A correctness fix can invalidate an earlier *decision*, not just an earlier number — re-check premises after any correction.

---

## 7. What we plan to do

### The pivot: from systematic trader to systematic analyst

We are dropping **one specific claim** — that this system can predict direction. Not "technical analysis is useless," not "no edge exists in crypto." Just that we tested five ways and found nothing, and continuing to guess costs real money.

What we keep, because none of it requires forecasting:

| capability | answers | status |
|---|---|---|
| **Level engine** — swing structure, Fibonacci, levels that held repeatedly, confluence zones | "what do I see?" | partial; has a P0 bug |
| **Regime description** — compression / trending / mean-reversion | "what is the market doing?" | built, works |
| **Position sizing and risk** — 1–2% rule, stop placement, R-multiples | "how much?" | built; most defensible code in the repo |
| **Journal and replay** — log the plan taken, replay real candles against it | "how did I do?" | replay exists, needs pointing at user-entered plans |

What we delete: the 5-point score, the tier labels (`TACTICAL_SETUP` / `STRATEGIC_TRADE` / `APEX_SETUP` — `APEX` fired **0 times** in every run ever), the entry-signal generation, the checklist's contradicting support/resistance, and the prediction claim.

**The key asymmetry:** a *descriptive* claim is cheap to verify — a level either held or it didn't, a 1% risk cap either capped the loss at 1% or it didn't. A *predictive* claim needs hundreds of independent observations and survives almost nothing. We spent a day proving the second half of that sentence.

**And the goal in §1 survives.** "Why not, and when to come back" was never a prediction:

> **AVAX — $22.40.** Nearest confluence zone $19.80–20.10 (0.5 Fib + 4h support held 3× + trendline), 11.6% below spot. Next resistance $23.40, then $24.90. Market: trending (ADX 31), bandwidth 42nd percentile. If you take a long there: stop $19.20 (zone low − 1×ATR), risk 4.4% of entry; at 1% account risk that is 0.23 units; first target = 1.9R. **Come back within 2% of $20.10, or if it closes below $19.20.**

Every line is checkable afterwards. None claims to know what happens next.

### The immediate next step, and a reordering

Our own migration plan had "do levels actually attract price reactions?" as step 5. **That is wrong, and it is the premise of the entire product.** If marked confluence zones do not attract reactions more than arbitrary price bands, the level engine is decoration and the tool shrinks to regime description + sizing + journal.

So:

**Step A — test the level premise.** *Success: month-clustered CI on the reaction-rate difference vs distance-matched random bands excludes zero.* No new data needed. Two traps to pre-register around:
- Zones are built *from* swing highs and lows, so price reversed there **by construction**. The test must measure *future* reactions at a zone marked only from prior data.
- The random control must be **distance-matched** — bands near spot get touched far more than distant ones, so unmatched controls would rig the comparison in our favour.

**Step B — delete the score, tiers, and contradicting S/R.** *Success: typecheck clean, tests green, no route can emit a numeric setup score.* Independent of A and safe either way.

**Then, conditional on A:** if levels pass, unify the level engine — one implementation, swing-clustered, touch-counted, anchored to a **fixed reference rather than to current price**, with a stability test asserting a sub-0.1% price move cannot change the marked set. (Today a **0.07% price move** once flipped the nearest level from "support, 4 touches" to "resistance, 1 test." That was noise inside a signal we didn't trust; now the levels *are* the product, so it is a correctness bug.)

---

## 8. What we want you to check

1. **Is the pivot justified by the evidence, or is it premature?** Five families failed. Is that enough to drop the prediction claim, or is the space of untested ideas large enough that stopping is the wrong call?
2. **Is Step A the right next move**, and is our control design (distance-matched random bands, future-only reactions) actually fair — or is there a way it still flatters us?
3. **Where is our inference still wrong?** The month-block bootstrap is our main defence. 39 month-blocks in the panel tests is a small number — how much should that lower our confidence in *negative* results specifically? A low-power test failing is weak evidence of absence.
4. **The biggest bias we have not solved is survivorship**: our coin universe is pairs listed *today*, so delisted coins are absent entirely — which inflates the long side and removes short opportunities. How much does that threaten the *negative* findings (as opposed to a positive one)?
5. **Is the reduced product actually worth building?** It is honest, but it is also unvalidated: we have not shown a human trades better with it. Is "a systematic analyst that never predicts" a real tool, or a consolation prize?
6. **What would you test that we have not?** Untouched so far: order flow / microstructure, cross-exchange basis, on-chain flows, volatility as a target rather than direction, and funding *slope* rather than level.

## 9. Summary in six lines

1. The tool runs end to end and always did; what was missing was any evidence it predicts anything.
2. We built a measurement stack — real-pipeline replay, matched random controls, cost derived from risk, month-clustered bootstrap, self-checks — and it is the only thing here with demonstrated value.
3. Five hypotheses tested, five negatives, including one that came out **significantly worse than random**.
4. Six bugs in our own tests were caught before reporting, and three misreadings of the source playbook corrected — including that we had been trading a tier *below* the playbook's own minimum.
5. The plan is to drop the prediction claim, keep level identification / regime description / risk sizing / journalling, and **test the level premise before building on it**.
6. The original goal — *"tell me why not, and when to come back"* — survives intact, because it was never a prediction.
