# Phase B — does anything predict anything?

Run 30 August 2026. Panel: `test/manual/results/panel.csv`, 320,000 rows,
2023-01-02 to 2026-08-27, ten coins hourly. Reproduce with
`pnpm --filter api phase-b`; raw output in `test/manual/results/phase-b.csv`.

Answer: **yes, seven families of feature clear the bar.** The effect sizes are
small and gross of cost, and nothing here is a strategy yet — but this is the
first positive result the project has produced that survives its own controls.

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

Distance to a level is the project's original thesis, it carries the largest
t-stat in the run, and this is the first time it has measured positive.

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

## What this does NOT say

- **These are gross.** An IC of 0.02 is the bottom edge of the 0.02–0.05 band
  the literature calls a usable alpha, and no cost has been applied. Phase D.
- **Seven families, one story.** They will be heavily correlated. Orthogonalising
  them is Phase C's job and may leave far less than seven.
- **One sample, no holdout.** Everything above is in-sample over 2023–2026.
  Purged K-fold with an embargo has not been run.
- **`bookImbalanceNear` is absent from all of it.** Binance began publishing the
  0.2% band on 2026-01-15, so it has 7 months against everyone else's 3.6 years
  and cannot clear a |t| > 3 bar on its own window.

## Where this leaves the exit condition

RESEARCH_PLAN §2.5: *"if Phase B produces no feature with |t| > 3.0 at any
horizon, the research stops."* It produced seven families. **The research
continues.** Phase C is next: orthogonalise, weight, one forecast per coin
per hour.
