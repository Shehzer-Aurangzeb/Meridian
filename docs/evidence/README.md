# The evidence ledger

Every measurement this project has made, and how it landed. Written 30 Aug 2026.

**The pre-registrations are not merged into this file and must not be.** Each one
states a bar before a run and records the result after it, and separating those
two halves is what makes the result mean something. This page indexes them; it
does not replace them.

---

## The tests

| # | document | input class | verdict |
|---|---|---|---|
| 1–5 | *(recorded in `archive/STATE_OF_PLAY.md` §14)* | price shape — zones, confluence, level strength | null |
| 6 | [`CHARTS_AB.md`](CHARTS_AB.md) | seven charts vs three, pooled | worse; **reverted to three** |
| 7 | [`HIERARCHY_AB.md`](HIERARCHY_AB.md) | seven charts, hierarchical | worse; **reverted** |
| 8 | [`VOLUME_AB.md`](VOLUME_AB.md) | volume node distance, relative volume, volume at extremes, volume delta | DEAD |
| 9 | [`FUNDING_AB.md`](FUNDING_AB.md) | funding rate, premium index | fails on effective n, not on direction |
| 10 | [`DECILE_AB.md`](DECILE_AB.md) | all of the above, re-cut at decile resolution | one cell cleared, and it does not survive inspection |
| — | [`HANDOFF.md`](HANDOFF.md) | the trade harness itself | −0.106R per resolved trade |

Roughly **550,000 observations across thirteen directional tests. Nothing has
cleared its pre-registered bar.**

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

## What has never been tested

Not "tested and null" — never measured at all:

- **Cross-sectional.** Every test asked "will this coin go up". None asked "which
  of these ten goes up *more than the others*", which removes the market beta
  that dominates a directional bet on correlated majors.
- **Feature predictivity, separate from trade geometry.** Every test measured an
  R-multiple, which bundles entry, stop, target, timing and cost into one number.
  When that comes back null it does not say which part failed. `VOLUME_AB.md`
  opens by naming this problem and then measures direction in buckets, which is
  closer but still not an information coefficient.
- **The collector's own inputs.** Open interest, taker buy/sell and long/short
  ratio have never been in any test, at any resolution.

All three are the subject of
[`../active/RESEARCH_PLAN_2026-08-30.md`](../active/RESEARCH_PLAN_2026-08-30.md).
