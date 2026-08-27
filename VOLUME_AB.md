# Meridian — volume as a directional input: pre-registration

**Written 27 Aug 2026, before any code. Part A is not edited after seeing a
result.**

## Why this is shaped differently from everything before it

Every previous experiment measured **"did this trade plan work"** — a number that
bundles entry, stop, target, timing and cost into one R-multiple. When that comes
back null you cannot tell which part failed.

Five tests of price shape are now in: zones, confluence, level strength, seven
charts pooled, seven charts hierarchical. All null or anti-predictive. That input
class is finished.

This experiment asks a smaller question, and only that question:

> **Given volume information at a moment, is price higher or lower N hours
> later?**

No entries. No stops. No targets. No ladder. No cost model. If volume cannot
predict direction, no trade design built on it can work, and we find out in a day
instead of a month.

## What is being tested

A swing high is where price *turned*. A volume node is where trading *happened* —
where contracts actually changed hands. Swings are a crude proxy for that; volume
is the direct measure. It is already in every candle and has never been used for
levels.

**Number of inputs to be tested: 4.** Fixed now, so the significance bar is set
before looking.

1. **Volume-weighted price nodes** — price buckets where the most volume traded
   over a lookback. Signed distance from spot to the nearest node.
2. **Relative volume** — current bar's volume against its own recent average.
3. **Volume at the extremes** — whether recent highs/lows came on rising or
   falling volume.
4. **Volume delta proxy** — up-bar volume minus down-bar volume over a window.

## The measurement

Per input, per decision bar: the raw value, **fixed buckets, never sample
percentiles**, and signed forward return at **+4h, +12h, +24h**.

Per bucket: n, mean forward return, median, **share of forward moves that were
up**.

**The headline is directional hit rate, not R.** 55% against a 50% base rate is a
signal; 50.5% is not. The base rate is reported per coin and horizon, because
crypto drifts and 50% is not automatically the null.

## Kill criteria — decided now

| result | verdict |
|---|---|
| No bucket reaches 55% directional (or 45% inverse) at any horizon | **DEAD** — drop it, do not revisit |
| A bucket reaches 55%+ but with n < 100 | **UNPROVEN** — record, do not build on it |
| A bucket reaches 55%+ with n ≥ 100, monotone across adjacent buckets | **LIVE** — carry to holdout |

**Monotonicity matters more than the peak.** A single bucket spiking is what
noise looks like. A signal that strengthens smoothly as the input moves is
structural.

**4 inputs × 3 horizons = 12 comparisons, so roughly one 55% result is expected
from noise alone.** One LIVE input is not a finding. Two or more, or one that is
monotone and holds across coins, is worth the holdout.

## Prediction, on record

**Inputs 2 and 3 are DEAD** — relative volume and volume-at-extremes are on
every retail screen, same category as RSI and ADX.

**Input 1 is the one worth the work**, not because I expect it to predict
direction — I expect DEAD — but because it is the first input tested that
measures something other than price shape. Most likely it says where price
*stalls*, not which way it goes: a magnitude signal, not what we need.

**Input 4 is the dark horse.** Up-volume minus down-volume is the closest thing
spot candles carry to order flow, and flow is the one input class never tested
here.

Overall: **expect all four DEAD.** Going in expecting a null is what makes a real
signal believable.

## Rules

- No trade construction. This measures information, not profit.
- No lookahead. A bar may use only data closed at or before its own close, with a
  test that fails if the invariant is weakened.
- Fixed bucket thresholds. Percentiles leak the future into bucket assignment.
- **TUNE only** — oldest 70% by time. The holdout stays unspent.
- Raw values reported alongside buckets, so bucketing can be revisited without a
  re-run.
- **A shuffled-label control replaces `--random`** for this experiment. The
  existing random control has swung more across revisions than the strategy has
  and should not decide anything until rebuilt. Every bucket in the shuffled
  control must land at the base rate; if one shows 55%, the measurement is broken
  and no result from it means anything.

## If all four come back DEAD

Expected, and not a dead end. It closes price-derived inputs entirely — shape and
volume both — and points at the flow data, the only remaining input class not
visible on a standard retail screen. Funding rate and premium index have roughly
3 years of history and are testable immediately with this same harness. Open
interest, taker buy/sell and long/short ratio need the collector to accumulate.
