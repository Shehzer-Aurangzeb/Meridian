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

---

# Results — 27 Aug 2026

```
npx ts-node --transpile-only test/manual/volsignal.ts --all --bars 20000
npx ts-node --transpile-only test/manual/volsignal.ts --self-check
```

10 coins, 19,999 closed 1h bars each, TUNE = oldest 13,999 per coin
(2024-05-16 → 2025-12-20). ~135,000–140,000 observations per input. Seed 12345.
Holdout untouched.

## Verdict: all four DEAD

**Not one bucket, in any of the four inputs, at any of the three horizons,
reached 55% or 45% on n ≥ 100.** The pre-registered criterion fires on nothing.

| input | best bucket | worst bucket | verdict |
|---|---|---|---|
| 1. volume node | 53.6% (`[5,+inf)%` @ +24h, n=39,016) | 47.7% | **DEAD** |
| 2. relative volume | 51.9% (`[1.6,2.5)x` @ +4h) | 49.0% | **DEAD** |
| 3. volume at extremes | 53.2% (`[-inf,-3)x` @ +24h) | 47.2% | **DEAD** |
| 4. volume delta proxy | 52.2% (`[-0.5,-0.3)` @ +12h) | 48.2% | **DEAD** |

Base rate per coin, +4h/+12h/+24h, ranges 47.9% to 52.7%. It is not 50%, which
is why it was measured rather than assumed — BNB drifts up (52.1/52.3/52.7),
AVAX and ADA drift down (48.3/48.7/48.1 and 49.6/49.2/47.9). Several buckets
that look mildly directional are inside their own coin's drift.

## The shuffled control confirms the measurement is sound

Across all four inputs and all 36 bucket-horizon cells, the shuffled control
sits between **49.2% and 50.9%**, and the flagging code that would have printed
`BROKEN` never fired. Buckets preserved, forward returns randomly reassigned,
nothing directional survives. So the nulls above are nulls in the data, not an
artefact of the rig.

## The most useful thing this run produced is a warning about n

A smoke run of **input 4 on 2 coins and 4,000 bars** — 5,544 observations —
reported:

```
[-0.05, 0.05)  at +24h: 58.3% on n=810
[-0.15, -0.05) at +12h: 58.0% on n=742
[0.5, +inf)    at +24h: 13.7% on n=73
[0.3, 0.5)     at +24h: 42.6% on n=601
```

and even looked monotone in the positive tail: 55.2% → 52.1% → 42.6% → 13.7%.
At 10 coins and 139,720 observations **every one of those vanishes**; the same
buckets read 49.7%, 51.1%, 48.2% and 51.6%.

Two false LIVE verdicts and one apparently monotone gradient, all noise, all
from a sample that was still 5,544 observations. The n ≥ 100 floor in the kill
criteria is far too generous — on this data a bucket needs thousands, not
hundreds, before its hit rate means anything. **Recorded as a methodology
finding: raise the floor before reusing these criteria.**

## The prediction was right, including the reasoning

Predicted: inputs 2 and 3 DEAD (retail-screen indicators), input 1 DEAD but
worth testing as the first non-price-shape input, input 4 the dark horse, all
four DEAD overall. That is exactly what happened.

Input 1 also failed in the specific way predicted — it carries a little
*magnitude* information and no direction. The `[5,+inf)%` bucket (node far above
spot) has the highest mean forward return of any bucket in the run, +0.23% at
+24h, but only 53.6% of moves are up. Larger moves, not more upward ones.

Input 4 as the dark horse got the closest look and came back flattest of all:
its spread from best to worst bucket is 4.0 points, against 5.9 for input 1 and
6.0 for input 3.

## Monotonicity

Not assessed, because nothing cleared the bar to assess. The one gradient worth
naming is input 1's, and it is not monotone: up% by bucket runs
49.9 · 49.9 · 48.3 · 48.7 · 49.6 · 50.2 · 48.6 · 49.6 · 51.9 at +4h — flat with
a lift only in the outermost bucket.

## What this closes

**Price-derived inputs are finished — shape and volume both.** Five tests of
shape (zones, confluence, level strength, seven charts pooled, seven charts
hierarchical) and four of volume, on ~550,000 observations, nothing.

The remaining input class is flow, which is the only one not visible on a
standard retail screen. Funding rate and premium index have ~3 years of history
and are testable immediately with this same harness — the inputs plug into
`INPUTS` and nothing else changes. Open interest, taker buy/sell and long/short
ratio need the collector to accumulate.
