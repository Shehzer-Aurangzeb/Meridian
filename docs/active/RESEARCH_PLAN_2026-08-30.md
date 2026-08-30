# Research plan — 30 August 2026

Two things: what the 10-coin sweep measured on 29–30 Aug, and what to build
next. The findings are the reason the plan changes shape.

Prior state: [`../ROADMAP.md`](../ROADMAP.md) §7 (the resolution constraint) and
§8 (the flow archive). Everything already tested:
[`../evidence/README.md`](../evidence/README.md).

---

# Part 1 — What was measured

## 1.1 The harness can now resolve things it could not

ROADMAP §7 measured a 95% interval **0.318R wide** on edge over random, over 80
days of three coins, straddling zero. Every decision the project had made rested
on a delta inside it.

Re-run over the full archive window — ten coins, 32,000 1h bars each, 3.65 years:

```
resolved trades   plan 9321   control 7932
blocks            95
edge over random  0.0517R  (resolved-only, PRIMARY)
95% interval      [0.0241, 0.0798]   width 0.0556R
P(edge > 0)       100.0%
```

**0.318R → 0.0556R.** Five to six times narrower, on 95 blocks against six.

It is gated by `pnpm --filter api interval`, which exits non-zero when the width
misses a bar named on the command line. At the 0.05R bar — the pre-registered
"better" threshold — it still FAILS, by 0.006R.

Two corrections that landed with it, both preconditions rather than improvements:

- **The random control was drawn from the wrong population.** `allSignals` was
  filled before the `STATES` filter, so the control sampled ACTIONABLE,
  APPROACHING and FAR while the strategy arm took ACTIONABLE only. "Same plans,
  random timing" was comparing two different populations, and the control
  carries 0.301R of the old 0.318R.
- **The interval on a difference is not two intervals subtracted.** Both arms are
  drawn from the same weeks of the same market. `blockBootstrapDiff` draws a
  block and takes *both* arms from it, so the common move cancels.

## 1.2 The interval no longer straddles zero

`P(edge > 0) = 100%`, lower bound `+0.024R`. Across every configuration measured
— seven fee levels, two exit rules, fourteen rows in total — the lower bound
stayed above zero.

**The entry timing is better than chance, and that result is now stable.**

## 1.3 And it does not matter, because the geometry gives it all back

Resolved-only, at **zero cost**:

```
        n      win%    avgWin   avgLose   payoff   expectancy
PLAN    9321   61.1%   +0.560   -1.000    0.560    -0.0476
RANDOM  7932   61.0%   +0.491   -1.000    0.491    -0.0902
```

At a 61.1% win rate, breakeven needs a payoff of **0.637**. The plan has
**0.560**. It is short by 0.077 on the winning side, and it loses money **with no
fees at all**.

Three explanations were tested and eliminated:

| hypothesis | test | verdict |
|---|---|---|
| fees eat the edge | re-scored at 7 fee levels, 0× to 1.5× | **no** — loses 0.048R at zero fee |
| breakeven-after-TP1 caps winners | `--breakeven 0`, full re-run | **no** — expectancy doubles the loss, −0.0958R |
| the entry ladder is broken | fill pattern, per trade | **no** — working as designed |

The fee sweep needs no re-run: cost is `roundTripPct / riskPercent`, charged once
per closed trade, so `netR(k) = r − costR × k` and which trades were taken does
not move with k. `pnpm --filter api cost-sweep`.

## 1.4 The structural fact underneath all of it

```
WINNERS  n=5691   mean filled 0.791   all three legs: 67.3%
LOSERS   n=3630   mean filled 1.000   all three legs: 100.0%
```

**Every one of 3,630 losers filled completely. Not one exception.** A third of
winners never did.

This is not a bug. The ladder fills a deeper leg only when price moves further
against you, and price moving through every leg *is* the road to the stop. Losers
fill completely by construction. ROADMAP §3 recorded this as a suspicion; it is
now a measurement.

It also kills the obvious fix. "Take full size on winners too" is not available,
because the deeper fill and the loss are the same event.

## 1.5 What the two failed hypotheses actually cost

Ten minutes each, and each removed one explanation. That is the instrument
working. But the pattern is worth naming: both were plausible, both were about
*trade geometry*, and both were wrong. A third guess of the same kind has no
better prior than the first two.

---

# Part 2 — The plan

## 2.1 The structural mistake

The trading system was built first, then searched for signal inside it.

Every confound hit this week came from that ordering: cooldown coupled to the
exit rule (so changing the exit changes the trade set — 9,940 trades became
8,796), ladder asymmetry, breakeven interacting with win rate. None of those are
about whether the inputs predict anything. They are geometry noise sitting on top
of the question.

`VOLUME_AB.md` names the same problem in its first paragraph: an R-multiple
"bundles entry, stop, target, timing and cost into one number, and when that comes
back null you cannot tell which part failed." That observation was correct and
the project did not act on it.

## 2.2 What the standard pipeline looks like

```
1. research dataset    rows = (asset, time), columns = features, target = forward return
2. predictivity        does feature X correlate with forward return over horizon h?
3. combination         many weak signals, orthogonalised, into one forecast
4. sizing              forecast strength / volatility = position
5. portfolio + costs   only now: fills, slippage, turnover
```

This project is at step 5 with nothing established at step 2.

The number that reframes it: a **good** single alpha has an information
coefficient of **0.02–0.05** — a 2–5% rank correlation with forward returns.
Nobody has one rule that works. The output is dozens of weak signals combined.

The measured +0.043R edge over random is exactly that scale. It has been traded
as a discrete bet with a stop, which is the wrong instrument for a signal that
size.

## 2.3 Three things this project does that systematic desks do not

**Time-series bets instead of cross-sectional.** "Will BTC go up" is largely a
bet on crypto — the majors correlate 0.7–0.9. Ranking the ten coins against each
other and taking the spread cancels that beta and leaves the signal.

**Correction, 30 Aug: the construction has been tried.** `test/manual/panel.ts`
is 762 lines, ran on 3 Aug 2026, and is recorded in `archive/STATE_OF_PLAY.md`
§14e (momentum) and §14f (funding). Momentum came in *below* its own random
control — delta −0.0010, 95% CI [−0.0085, +0.0064], P(≤0) 0.60. Both failed.

What that leaves is narrower and more honest: those runs used **daily bars, a
weekly rebalance, a 30-day formation, and price or funding inputs**. Open
interest, taker imbalance and top-trader positioning have never been ranked
across coins at any resolution, because they had no history before 28 Aug. The
thesis is now exactly that, and nothing wider.

`panel.ts` is also Phase A's plumbing, already built and already debugged —
universe construction, point-in-time liquidity filtering, a random-direction
control, and `trimToContiguous`, which was added after a 127-day hole in the
date axis made a "30-day" signal span 157 days. Read it before writing anything.

**Stops.** 3,630 losers at exactly −1.000R. A stop converts "the signal was wrong
for now" into a realised loss, and a 61% win rate at 0.56 payoff is the signature
of a stop sitting inside the noise band. Systematic funds mostly size by
volatility and rebalance; risk control is position size, not exit price.

**One split.** TUNE/HOLDOUT once. The standard is purged K-fold with an embargo,
because overlapping trade windows leak future into past and a naive split does
not catch it.

## 2.4 Phases

### Phase A — the panel

One table. Rows `(coin, 1h timestamp)`. Columns: every feature already computed —
RSI, ADX, %B, QQE, zone distance — plus the six flow metrics. Targets: forward
return at 4h, 12h, 24h, 72h.

Ten coins × 32,000 hours ≈ **320,000 rows**. Every feature read through
`flowAsOf` and `completedAsOf`, which is what those two guards exist for.

**No fills, no stops, no ladder, no cooldown.** The entire geometry layer is
removed from the question, and with it every confound in Part 1.

### Phase A inputs — settled 30 Aug, all free

No paid data. The question was asked and the answer is that money is not the
constraint: `FlowSample` holds 28,413,765 rows with **zero consumers anywhere in
the codebase**, and §14e/§14f killed two hypotheses in one day for $0.

Every feature tested also raises the bar the survivors must clear, and effective
n here is one to two orders of magnitude below raw n. A wider net does not find
more signal — it raises the threshold and the false-positive count.

| input | source | history |
|---|---|---|
| `openInterest` | archive + collector | 2021-12-01 |
| `longShortRatio` | archive + collector | 2021-12-01 |
| `takerBuySellRatio5m` | archive + collector | 2021-12-01 |
| `takerBuySellRatio1h` | collector | ~30d live, forward |
| `topTraderAccountRatio` | archive + collector *(added 30 Aug)* | 2021-12-01 |
| `topTraderPositionRatio` | archive + collector *(added 30 Aug)* | 2021-12-01 |
| `premium` | collector | years |
| `fundingRate` | collector *(added 30 Aug)* | ~3 years |
| **book depth imbalance** | `data.binance.vision` bookDepth | **2023-01-01** |
| cross-sectional rank / z-score / spread vs BTC | derived | — |

**Three of those were not being collected forward.** `topTraderAccountRatio` and
`topTraderPositionRatio` were in the archive and in no `MetricSpec`, so both
series ended at the archive's last day — a feature built on either could have
been measured over history and then never run live. `fundingRate` was fetched
live by `FUNDING_AB.md` and stored nowhere. Fixed 30 Aug, with a test that fails
if an archive metric is ever dropped from the collector again.

`openInterestValue` is deliberately *not* collected: it is open interest times
price, and every consumer already holds the price.

**bookDepth is the one new dataset, and it is free.** The same
`data.binance.vision` bucket the metrics archive comes from publishes order book
depth at ±1% to ±5% of mid, one snapshot every 25 seconds, from 2023-01-01:

```
timestamp,percentage,depth,notional
2026-08-20 00:00:06,-5.00,8477.61700000,577185276.20310000
```

566 KB/day compressed for BTC — about 6.7 GB for ten coins over the full
history, against 33 MB/day for `aggTrades`, which would be ~440 GB. Book
imbalance is genuine microstructure, is not on a retail screen, is orthogonal to
everything tested so far, and its 2023-01-01 start matches the boundary the 2022
coverage hole already forces.

Considered and rejected: Glassnode and CryptoQuant (the predictive metrics sit on
expensive tiers), social/sentiment feeds (timestamp integrity is the hard part —
a row stamped when it was scraped rather than published is a look-ahead machine),
Coin Metrics Community (daily only), Tardis.dev (made redundant by bookDepth
being free), more timeframes (`CHARTS_AB` and `HIERARCHY_AB` both answered this),
and more coins (§14e measured the long tail bleeding 0.436%/week).

Revisit paid data only if Phase B finds something and a second orthogonal source
is needed to confirm it.

### Constraints

Carried over from ROADMAP §8, and not to be re-derived:

- `topTraderAccountRatio`, `topTraderPositionRatio` and `takerBuySellRatio5m`
  start **2023-01-01**. 2022 is 87.2% blank for the first two and 35.0% for
  taker; a split straddling it compares two datasets, not two periods.
- `openInterest` and `openInterestValue` have zero blanks anywhere.
- Never build a 1h taker feature by averaging 5m ratios — 13.9% off at the
  median, 67.3% at worst.
- Archive rows are stamped in the live convention. Feeding raw archive
  timestamps to `flowAsOf` embargoes them one bar early, which is the look-ahead
  it exists to stop.

### Phase B — does anything predict anything

Per feature, per horizon: Spearman IC, and IC computed **cross-sectionally**
(rank the ten coins at each timestamp). Report mean IC, standard error, t-stat.

**The bar is |t| > 3.0**, not 2.0, following Harvey/Liu/Zhu on factor discovery —
because many features are being tested at once. Write down the feature count and
the bar before running, as every pre-registration here has.

Read the result against finding 2 in the evidence ledger: effective n on this
data is one to two orders of magnitude below raw n. 320,000 rows is not 320,000
observations.

This is a correlation, not a backtest. It is cheap, and it is where the question
"is there anything at all" finally gets asked directly.

### Phase C — combine

Only if Phase B produces two or more features clearing the bar. Orthogonalise —
they will be correlated — weight, and produce one forecast per coin per hour.

### Phase D — portfolio

Cross-sectional, volatility-targeted, rebalanced. Costs applied on turnover. This
is where the existing cost model finally belongs, and the first point at which an
R-multiple is the right unit.

**Phase A + B is about a week.** It either finds something or it produces a clean,
defensible negative — which is worth more than further geometry tuning.

## 2.5 The exit condition

This project has never had one, which is the actual reason the work feels
open-ended.

**Written down now: if Phase B produces no feature with |t| > 3.0 at any horizon,
the research stops.** The analyst stays as a tool that shows zones, levels and
context — which it does correctly — and stops being a thing that claims an edge.
The collector gets switched off and its 764 MB/year reclaimed.

## 2.6 Honest expectation

The documented, surviving crypto edges are funding-rate carry, cross-sectional
momentum, and basis trades. All are heavily arbitraged. Public technical
indicators on ten liquid majors is the most crowded corner available, which is
what thirteen null tests have been saying.

The flow data is the best remaining shot precisely because it is *not* a public
indicator — open interest, taker imbalance and top-trader positioning are
positioning data, and positioning is closer to a real edge than RSI ever was.
There are 3.65 years of it at five-minute resolution and **nothing has ever read
it**. `FlowSample` has no consumer anywhere in the codebase.

That is the whole remaining thesis. Phase A + B is how it gets settled in a week
rather than another quarter.

---

## Reading

Ordered by usefulness to this project specifically.

- **Marcos López de Prado, _Advances in Financial Machine Learning_ (2018).**
  The most relevant single source. Triple-barrier labelling, meta-labelling,
  purged K-fold CV with embargo, and a chapter on why backtests lie. Chapters 3,
  7 and 11 address the exact problems in Part 1.
- **Harvey, Liu & Zhu, "…and the Cross-Section of Expected Returns" (2016).**
  Why t > 2 is not enough when many things are tested. Short, and it is the
  formal version of the pre-registration instinct already used here.
- **Robert Carver, _Systematic Trading_.** Forecast scaling and position sizing
  without stops. The closest description of what this system should become.
- **Moskowitz, Ooi & Pedersen, "Time Series Momentum" (2012)**; **Asness,
  Moskowitz & Pedersen, "Value and Momentum Everywhere" (2013).** Read for
  method — how a factor is tested and reported — more than for the factors.
- **Ernie Chan, _Algorithmic Trading_.** Mean reversion and cointegration,
  practical.
- **Hudson & Thames** publish Python implementations of López de Prado's methods,
  useful when building Phase B.

---

## Commands from this session

```
# the full sweep, ~10 minutes
pnpm --filter api backtest:plans -- \
  --coins BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC \
  --bars 32000 --random --csv test/manual/results/interval-10coin.csv

# the resolution gate; exits non-zero on FAIL
pnpm --filter api interval -- --csv test/manual/results/interval-10coin.csv

# fee sensitivity, no re-run needed
pnpm --filter api cost-sweep -- --csv test/manual/results/interval-10coin.csv
```
