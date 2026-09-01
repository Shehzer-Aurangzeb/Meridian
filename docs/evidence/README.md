# The evidence ledger

Every measurement this project has made, and how it landed. Written 30 Aug 2026,
extended 1 Sept 2026 with Phases B–D and the fill test.

For the whole picture in one place — what runs in production, what was tested,
and exactly where it fails — read
[`../STATE_OF_MERIDIAN_2026-09-01.md`](../STATE_OF_MERIDIAN_2026-09-01.md)
first. This file is the index of the individual pre-registrations.

**The pre-registrations are not merged into this file and must not be.** Each one
states a bar before a run and records the result after it, and separating those
two halves is what makes the result mean something. This page indexes them; it
does not replace them.

---

## The tests

| # | document | input class | verdict |
|---|---|---|---|
| 1–3 | *(recorded in `archive/STATE_OF_PLAY.md` §14c–d)* | price shape — zones, confluence, level strength | null |
| 4 | *(`archive/STATE_OF_PLAY.md` §14e, `test/manual/panel.ts`)* | **cross-sectional momentum**, long top decile / short bottom | **below its own random control** |
| 5 | *(`archive/STATE_OF_PLAY.md` §14f, `panel.ts --signal funding`)* | **cross-sectional funding** (contrarian on crowding) | null |
| 6 | [`CHARTS_AB.md`](CHARTS_AB.md) | seven charts vs three, pooled | worse; **reverted to three** |
| 7 | [`HIERARCHY_AB.md`](HIERARCHY_AB.md) | seven charts, hierarchical | worse; **reverted** |
| 8 | [`VOLUME_AB.md`](VOLUME_AB.md) | volume node distance, relative volume, volume at extremes, volume delta | DEAD |
| 9 | [`FUNDING_AB.md`](FUNDING_AB.md) | funding rate, premium index | fails on effective n, not on direction |
| 10 | [`DECILE_AB.md`](DECILE_AB.md) | all of the above, re-cut at decile resolution | one cell cleared, and it does not survive inspection |
| — | [`HANDOFF.md`](HANDOFF.md) | the trade harness itself | −0.106R per resolved trade |

### Added 30 Aug – 1 Sept 2026 — the panel, with the geometry removed

| # | document | input class | verdict |
|---|---|---|---|
| 11 | [`PHASE_B_IC.md`](PHASE_B_IC.md) | **every feature on its own**, cross-sectional IC, 192 tests | 7 families over \|t\| > 3.0 — **none pays the fee** |
| 12 | [`PHASE_C_COMBINE.md`](PHASE_C_COMBINE.md) | the seven combined, ridge, purged K-fold | 1.01 bp against 14 bp; same as shuffled |
| 13 | [`PHASE_D_NONLINEAR.md`](PHASE_D_NONLINEAR.md) | gradient-boosted trees, barrier labels, 160 features, holdout | 0.34 bp — real, above noise, a third of the fee |
| 14 | [`STAGE0_MAKER_FILL.md`](STAGE0_MAKER_FILL.md) | would a resting limit order fill, on 1-minute bars | fills 88–92%, **gross is negative**: −8.20 bp over 3.1 years |

Test 14 is the one that closes the fee argument. The orders fill, and fill
favourably rather than adversely. The gross they fill into is negative over the
longer sample, and a cheaper fee multiplies a negative number by one.

Roughly **550,000 observations across the first thirteen tests, plus a 320,000-row
panel across the last four. Eighteen directional tests. Nothing has cleared its
pre-registered bar.**

---

## The three findings that outlived their own experiments

These matter more than any individual verdict, and each one came out of a run
that was nominally about something else.

**1. Most of the early DEAD verdicts were never earned.** `DECILE_AB.md`
established that the rig could not tell a measured null from an unmeasurable
one, so results that should have read UNPROVEN were labelled DEAD. Only V2 is
dead in all thirty cells. Treat every pre-decile DEAD as "not shown", not as
"shown absent".

**2. Effective n is one to two orders of magnitude below raw n.** Cells holding
13,500 observations carry 300–1,500 observations of actual evidence, because
crypto bars inside a week are close to one observation rather than forty. Every
verdict in this project should be read against that. The 5,000-bar floors used
in the earlier runs were counting the wrong quantity.

**3. For an input published on a slower clock than the decision bar, the sample
floor must count publications, not bars.** A 5,000-bar floor on an 8-hourly input
is 625 settlements, and fewer once clustering is taken into account. This is a
stronger reason to distrust the tails of the funding result than "small n" was.

---

## The stale sentence in three of these documents

`VOLUME_AB.md`, `FUNDING_AB.md` and `DECILE_AB.md` all close by saying the last
untested input class — open interest, taker buy/sell, long/short ratio — needs
"roughly 12 months of accumulation", and that the collector running is what buys
that option.

**That wait ended on 28 Aug 2026.** `data.binance.vision` publishes all three at
five-minute resolution from 2021-12-01, and 28,413,765 rows are imported locally.
See ROADMAP §8. The documents are left unedited because they are sealed records;
this note is the correction.

So the class those thirteen tests kept deferring to is now testable immediately,
with 3.65 years behind it rather than none.

---

## What was never tested, and now has been

The three items below were the open list on 30 Aug. **All three were closed
between 30 Aug and 1 Sept** — by Phase A (the panel), Phase B (feature
predictivity separated from trade geometry) and the flow metrics finally
entering a test. They are left here unedited because this section is what the
research plan was written against; the verdicts are tests 11–14 above.

Not "tested and null" — never measured at all *as of 30 Aug 2026*:

- **Cross-sectional, on flow inputs.** The construction itself HAS been tested —
  §14e ran momentum and §14f ran funding, long the top decile against short the
  bottom, and both failed. But both used price-derived or funding inputs, on
  daily bars with a weekly rebalance. Open interest, taker imbalance and
  top-trader positioning have never been ranked across coins at any resolution,
  because they had no history until 28 Aug 2026.
- **Feature predictivity, separate from trade geometry.** Every test measured an
  R-multiple, which bundles entry, stop, target, timing and cost into one number.
  When that comes back null it does not say which part failed. `VOLUME_AB.md`
  opens by naming this problem and then measures direction in buckets, which is
  closer but still not an information coefficient.
- **The collector's own inputs.** Open interest, taker buy/sell and long/short
  ratio have never been in any test, at any resolution.

All three were the subject of
[`../archive/RESEARCH_PLAN_2026-08-30.md`](../archive/RESEARCH_PLAN_2026-08-30.md),
which has now been executed in full.

## What has still never been tested

- **Any venue except Binance.** Every one of the 160 columns in the Phase D
  panel is Binance-only. Cross-exchange price dispersion, funding spread and
  open-interest share are free, reach back to 2023 on OKX and Bybit (OKX funding
  excepted — ~3 months), and have never been measured.
- **Anything forward-looking.** Nothing in the panel is a market expectation.
  Deribit implied volatility and skew are free, and cover BTC and ETH only.
- **Trade-level order flow.** `aggTrades` is free but ~440 GB, and
  `takerBuySellRatio5m` is already a coarse version of it.

## Two numbers from §14e worth carrying

Neither is about edge, and both constrain anything built later.

- **Breakeven round-trip cost is 0.309%** at 48% weekly turnover. Retail spot
  fees run 0.5–0.8% round trip, so a strategy of that turnover is dead before
  its signal is considered.
- **The equal-weight top-100 altcoin universe lost 0.436% per week** over that
  window while majors rose. Breadth into the long tail is not free: more coins
  raises trade count and lowers per-trade quality at the same time.
