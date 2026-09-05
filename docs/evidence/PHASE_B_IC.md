# Phase B — does anything predict anything?

Run 30 August 2026. Panel: `test/manual/results/panel.csv`, 320,000 rows,
2023-01-02 to 2026-08-27, ten coins hourly. Reproduce with
`pnpm --filter api phase-b`; raw output in `test/manual/results/phase-b.csv`.

Answer: **seven families clear the bar, and none of them is tradeable as it
stands.** The ICs are real and survive a shuffle control and a persistence gate.
They are also three to five times too small to pay the fee, and for two of the
seven the IC's sign is the opposite of the direction the money actually goes.
Read §"From IC to money" before treating any line here as a signal.

---

## Pre-registration, printed before any result

```
features   48
horizons   4h, 12h, 24h, 72h
tests      192
bar        |t| > 3.0   (Harvey/Liu/Zhu)
expected false passes at that bar: 0.52
t-stat     Newey-West, lag = horizon
interval   30-day block bootstrap, 2000 draws, seed 12345
persistence gate: 30-day rank persistence must be under 0.50
```

## What survived

39 of 192 tests, and they are not 39 findings — they are seven ideas measured at
several horizons each.

| family | tests | best | IC | t |
|---|---|---|---|---|
| level distance / shape | 19 | `sup_1h_distPct` @4h | +0.0190 | 6.43 |
| volatility compression | 4 | `bandWidth` @24h | −0.0513 | −6.42 |
| mean reversion | 3 | `percentB` @4h | −0.0186 | −6.00 |
| funding rate | 4 | `fundingRate` @12h | −0.0245 | −5.14 |
| trend strength | 4 | `pdi` @4h | −0.0154 | −4.85 |
| top-trader positioning | 2 | `topTraderPositionRatio_z` @4h | −0.0133 | −4.27 |
| order book | 3 | `bookImbalanceFar` @72h | −0.0309 | −3.33 |

The signs are coherent and all point the same way: **short-horizon mean
reversion.** High RSI, high %B, wide bands, high funding, crowded top-trader
longs and a bid-heavy book all precede lower forward returns; distance below a
support precedes higher ones. That is one story told seven ways, not seven
independent edges, and Phase C has to treat it as such.

Distance to a level is the project's original thesis and it carries the largest
t-stat in the run. It is also, on the numbers in the next section, the one with
no usable gradient at all — see below before reading that as a win.

## The gate that changed the answer

The first run reported 63 passes and the largest was raw `openInterest` at
|t| = 10.05. It was wrong, and the way it was wrong is worth keeping.

`openInterest` ranks the ten coins in almost exactly the same order thirty days
later — rank persistence **0.99**. It never times anything. It says BTC and ETH
sit at the top of the ordering, and over this particular sample the top of that
ordering underperformed. That is one bet on one 3.6-year window, with an
effective n near 1, wearing 32,000 observations.

A cross-sectional IC cannot separate *"this feature times the market"* from
*"these coins beat those coins"*. So any feature whose ranking survives a month
is now reported apart and not counted:

```
openInterest        persist 0.99   |t| 10.05   REJECTED
bookDepthNotional   persist 0.97   |t|  9.11   REJECTED
atrPct              persist 0.69   |t|  9.05   REJECTED
topTraderAccountRatio persist 0.58 |t|  6.05   REJECTED
longShortRatio      persist 0.58   |t|  5.46   REJECTED
```

24 of the 63 went. Note which survivors are the z-scored versions:
`openInterest_z` has persistence −0.06 and does not pass, while raw
`openInterest` had 0.99 and "passed" enormously. The normalisation was the
difference between a finding and an artefact.

## Negative control

`--shuffle` permutes which coin got which forward return **within each hour**,
so the market-wide move and every feature's own distribution are untouched and
only the pairing is destroyed.

```
             max |t|    max IC    passes    expected
real           6.43     +0.0190      39        0.52
shuffled       3.11     +0.0058       2        0.52
```

Two shuffled passes against 0.52 expected is within noise (Poisson, P(≥2) ≈ 0.10)
and hints the Newey-West lag slightly under-corrects at the 4h horizon. The real
ICs are three to four times larger and the t-stats roughly double.

## From IC to money

An IC is a rank correlation. It says the ordering carries information; it does
not say the information is worth the fee, and it does not say the direction of
the money matches the direction of the correlation. Both turn out to matter.

Mean forward return by cross-sectional rank, in basis points, rank 1 = lowest
feature value, all 32,000 hours:

```
sup_1h_distPct  @4h    2.1  0.7 -0.2  0.8  0.3  0.6  0.3  0.6  1.2  0.2
percentB        @4h   -1.0 -0.1 -0.8 -0.1  0.7  0.8  1.1  0.9  1.6  3.3
pdi             @4h   -0.3  0.3 -0.3 -0.1  0.5  1.0  0.2  0.3  1.7  3.4
bandWidth      @24h    4.8  5.6  4.5  4.7  5.1  1.8  5.8 -0.3  6.8 -1.4
fundingRate    @12h    1.1  4.9  6.9  5.9  3.8  1.8  0.9  2.2 -5.9 -2.5
bookImbalanceFar@72h  29.5 15.9 18.1 15.7 10.3 10.2  1.2  3.6  6.9 -6.3
```

Two things fall out of that table.

**`sup_1h_distPct` has no gradient.** It carries the largest t-stat in the run,
|t| = 6.43, and its return profile is flat across all ten ranks. The rank
information is real and it is not information about the size of the move.

**`percentB` and `pdi` have the sign backwards.** Both measured a negative IC at
|t| = 6.00 and 4.85. Both have a monotonically *rising* return profile: the
highest-ranked coins earn the most. Spearman correlates the RANK of the forward
return, and a coin that wins rarely but enormously ranks the same as one that
wins slightly. In crypto that difference is where the return lives, so a
rank-based IC can point one way while the money goes the other. Trading the IC
sign on either of these loses.

The three whose direction does hold — `bandWidth`, `fundingRate`,
`bookImbalanceFar` — priced as long the top three coins, short the bottom three,
half the capital on each leg, non-overlapping holds:

| feature | hold | gross per trade | trades/yr | gross/yr |
|---|---|---|---|---|
| `bookImbalanceFar` | 72h | 4.79 bp | 122 | 5.8% |
| `bandWidth` | 24h | 4.12 bp | 365 | 15.0% |
| `fundingRate` | 12h | 1.83 bp | 730 | 13.4% |

Against a round trip of **14 bp** (`panel.ts` `ROUND_TRIP_PCT`) or **25 bp**
(`backtest-plans.ts`). The best single feature earns 4.79 bp per trade against a
14 bp cost. Every one of them is three to eight times underwater, and it is not
close enough that a better execution assumption rescues it.

## What this does NOT say

- **No single feature pays its fee.** See above. Phase C exists to find out
  whether seven weak, partly independent signals combine into one that does;
  that is a real question, and it is not answered here.
- **Seven families, one story.** They will be heavily correlated. Orthogonalising
  them is Phase C's job and may leave far less than seven.
- **One sample, no holdout.** Everything above is in-sample over 2023–2026.
  Purged K-fold with an embargo has not been run.
- **`bookImbalanceNear` is absent from all of it.** Binance began publishing the
  0.2% band on 2026-01-15, so it has 7 months against everyone else's 3.6 years
  and cannot clear a |t| > 3 bar on its own window.

## Where this leaves the exit condition

RESEARCH_PLAN §2.5: *"if Phase B produces no feature with |t| > 3.0 at any
horizon, the research stops."* It produced seven families, so on the letter of
the condition **the research continues**.

The condition was written to catch a total null, and this is not one. But it
was written before anyone had seen an IC that clears |t| > 3 and still cannot
pay a 14 bp fee, so it is worth saying plainly what the pass is worth: Phase C
now has one job, and it is not "combine seven edges". It is to find out whether
seven signals that are individually three to eight times underwater on cost
combine into one that is not. If the combined forecast's long-short spread does
not clear the round trip, that is where the research stops, and the exit
condition should be restated in those terms rather than in t-stats.
