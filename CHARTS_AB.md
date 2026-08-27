# Seven charts vs three — pre-registration

Written 27 Aug 2026, **before the run**. Nothing below is edited after seeing a
number; results go at the foot, under their own heading.

## The change under test

`LEVEL_TIMEFRAMES` went from `12h/4h/1h` to `1w/1d/12h/4h/1h/30m/15m`. That is
the only change. One change, one measurement.

Every number this project quotes — the −0.369R live figure, the golden set, the
arms file — was measured on three charts and describes a system that is no
longer what runs. This run is what replaces them.

## Commands

Both arms from one binary, so nothing but the chart list differs:

```
pnpm backtest:plans --coins BTC,ETH,SOL --bars 2000 --random --charts 12h,4h,1h
pnpm backtest:plans --coins BTC,ETH,SOL --bars 2000 --random
```

## Primary metric

**Edge over random: mean net R per trade minus its own random control**,
resolved trades only.

Not raw net R. The seven-chart arm produces more trades over the same window,
and more trades in a drifting market moves raw net R for reasons that have
nothing to do with the levels. Each arm is therefore scored against a control
built from its own trade count and its own geometry with random timing. That is
the comparison that survives the trade set changing.

Reported alongside, always: marked, resolved-only, and the gap.

## The bar, decided before the number

| verdict | condition |
|---|---|
| **better** | edge-over-random improves by **≥ +0.05R** AND resolved-only net R does not degrade |
| **worse** | resolved-only net R degrades by **≥ 0.05R** |
| **unchanged** | anything between |

**0.05R is not arbitrary.** The 1h-vs-5m scoring error measured on 26 Aug was
0.059R per trade, and this project treated that as small-but-real. Anything
under it is inside known measurement noise, so it cannot be called a result.

**"Unchanged" means revert to three charts.** Seven charts costs seven fetches
instead of three, a bigger replay, and more surface. A tie is a loss for the
more complicated thing.

## Secondary — reported, not decisive

Recorded because they say *how* it changed, not *whether* it helped. None of
them can promote an "unchanged" to a "better".

- trades produced, and fill rate
- stop-out share
- win rate and payoff (a win rate on its own is not a result — 63.1% lost money
  once already)
- long vs short split

## What would make me distrust a positive result

- It comes from raw net R while edge-over-random is flat → the market drifted.
- It comes from one coin.
- The extra trades are mostly the marginal ones and the stop-out share rose too.

## Predictions on record, before the run

**The user:** roughly unchanged, possibly slightly worse. Seven charts of price
swings is still price swings — the same input class shown empty four separate
ways. More charts is more resolution on the same information, not new
information.

**Me:** same direction, and I expect the trade count to rise faster than
anything else, because 7,838 zones against 4,770 is +64% and most of the new
ones are on faster charts where levels are closer together and weaker.

If it comes back better, the burden is on the result, not on the prediction: it
gets re-run on a second window before it is believed.

## What this run is NOT

Not a matched-trade comparison. It cannot be — changing the level map changes
which trades exist, which is the whole point of the change. The project's rule
that full-run A/Bs are not evidence was written for *scorer* changes, where the
trade set should have stayed fixed and did not. Here the trade set moving IS the
treatment, so the random control does the work the matching normally would.
Stated plainly so nobody later quotes this as a matched comparison.

---

# Results — 27 Aug 2026

Window 2026-06-04 → 2026-08-23, 1,908 decision bars per coin, BTC/ETH/SOL,
seed 12345, everything but the chart list identical.

| | 3 charts | 7 charts | delta |
|---|---|---|---|
| **edge over random** (primary) | **+0.064R** | **−0.066R** | **−0.130R** |
| trades taken | 176 | 245 | +39% |
| net R / trade (marked) | −0.043 | −0.065 | −0.022 |
| net R / trade (resolved only) | −0.124 | −0.099 | +0.025 |
| marking gap | 0.081 | 0.034 | — |
| win rate | 54% | 47% | −7pt |
| gross R / trade | 0.107 | 0.057 | −0.050 |
| cost R / trade | 0.150 | 0.122 | −0.028 |
| **planned R** | **2.26** | **1.73** | **−0.53** |
| bars held | 21 | 16 | −5 |
| stopped out | 30% | 23% | −7pt |
| PARTIAL | 40% | 48% | +8pt |
| eligible plans | 6,495 | 9,212 | +42% |

## Verdict: revert to three charts

**The primary metric moved 0.130R against — 2.6× the bar, wrong direction.**

By the letter of the pre-registered table the verdict is "unchanged": "worse"
was defined on resolved-only net R, and that improved by 0.025R. "Unchanged"
was pre-committed to mean revert, so the decision is the same either way.

**That is a drafting flaw in the pre-registration and it is recorded, not
quietly fixed.** The primary metric was edge-over-random but the "worse" row was
written against a secondary. Had "worse" been defined on the primary, as it
should have been, this would read as a clear "worse" rather than a tie. The
decision does not change, which is luck, not design. Next pre-registration
defines every verdict row on the primary metric.

## Why it got worse — the mechanism is measured, not guessed

**Planned R fell from 2.26 to 1.73.** That is the whole story and it is
structural, not noise:

- more charts → more zones (4,770 → 7,838 in the Q1/Q2 replay)
- more zones → the *next zone up* is closer, so every target moves nearer
- the stop does not move with it: it stays one 4h ATR beyond the zone edge

So the reward side shrinks by 23% while the risk side is pinned by ATR. Every
trade is offered a worse deal before a single bar is scored. The supporting
numbers all point the same way: holds shortened 21 → 16 bars, PARTIAL rose
40% → 48%, and ALL_TARGETS trades earned 0.91R on three charts but only 0.65R
on seven.

**The apparent wins are all the same effect wearing different hats.** Stop-outs
fell 30% → 23% and cost/trade fell 0.150 → 0.122 — but both are consequences of
smaller, closer, faster trades, not of better ones. Resolved-only improving by
0.025R is the same artefact. A trade that risks less and wins less is not an
improvement; it is a smaller trade.

## The user's prediction was right

Recorded before the run: *"roughly unchanged, possibly slightly worse. Seven
charts of price swings is still price swings — the same input class you've
proven empty four ways. More charts is more resolution on the same information,
not new information."*

That is what happened, and the mechanism is more specific than the prediction
needed to be: the extra resolution actively hurt, by compressing target
distance while the ATR-based stop stayed put.

## Read this with care

- The random control itself moved between arms (−0.108R → +0.001R), largely
  because the seven-chart arm's control drew 173 trades against 107 and a
  different long/short mix. The control is doing real work here, which is why
  it is the primary metric — but it is not a fixed yardstick across arms.
- Three coins, one 80-day window, one seed. This is enough to reject a change,
  which needs only a failure to clear the bar. It would not be enough to accept
  one.
- Not a matched-trade comparison, by construction. See the pre-registration.

## What this does NOT say

It does not say more charts is wrong in principle. It says more charts *with an
unchanged 0.5% cluster threshold and an unchanged ATR stop* is wrong, because
those two constants are what turn extra zones into worse geometry. The per-chart
threshold idea is untested and this run says nothing about it — but it is now a
second change on top of a reverted first one, so it starts from three charts.
