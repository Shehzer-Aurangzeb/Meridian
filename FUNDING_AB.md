# Meridian — funding & premium as directional inputs: pre-registration

**Written 27 Aug 2026, before any code. Part A is not edited after seeing a
result.**

Same harness as `volsignal.ts`, same measurement, new inputs. Nothing about the
method changes — that is the point.

## Why this matters more than the last one

Every input tested so far has been **derived from price**: swing highs, zones,
confluence, level strength, chart hierarchy, volume nodes, relative volume,
volume at extremes, volume delta. Nine tests, ~550k observations, all null.

Funding rate and premium index are the first inputs that are **not price**. They
measure what traders are *paying* to hold a position, which is positioning, not
shape. A crowded long book pays to stay long. That is information about who is
exposed and how badly — a different class of thing entirely.

They are also the only flow inputs testable today. Open interest, taker buy/sell
and long/short ratio are capped at ~30 days by Binance and need the collector to
accumulate. Funding and premium have roughly 3 years.

**Funding was tested once before** (`STATE_OF_PLAY` §14f) as a positioning signal
and it nulled. This is not a re-run — that was a different measurement, and this
is direction-only, bucketed, at fixed horizons. The prior is recorded so a null is
not a surprise and a hit gets extra scrutiny rather than excitement.

## Criteria changes carried from the volume run

**1. The n floor rises to 5,000.** The volume smoke run produced two false LIVE
verdicts and a convincing monotone gradient (55.2 → 52.1 → 42.6 → 13.7) on 5,544
observations. At 139,720 those same buckets read 49.7%, 51.1%, 51.6%. An n ≥ 100
floor is not merely generous, it is actively misleading on this data.

**2. Every bucket is judged against its own coin's base rate**, not 50%. Measured
base rates run 47.9%–52.7% (BNB drifts up, AVAX and ADA down). A 53% bucket on
BNB is nothing; a 53% bucket on ADA is a 5-point lift. **Report the lift, not the
raw rate.**

**3. Monotonicity is worthless below the n floor.** Do not report a gradient as
evidence on a small bucket.

## What is being tested

**Number of inputs: 4.** Fixed now.

1. **Funding rate** — the periodic payment between longs and shorts. Positive
   means longs pay shorts, which means the book is crowded long.
2. **Funding rate change** — the delta over a window. A rapidly rising funding
   rate is positioning building fast, which is different information from the
   level.
3. **Premium index** — perpetual price against spot index. Direct measure of how
   far the derivative has detached from the underlying.
4. **Funding extremity** — the current rate against its own recent distribution,
   with **fixed thresholds, never sample percentiles**.

These are futures-only, so the mismatch is noted: the analysis universe is spot,
and not every coin has a USDT perpetual with full history. Coverage is reported
and uncovered coins are dropped rather than substituted.

## The measurement — unchanged

At each decision bar, per input: raw value, a **fixed-threshold** bucket, and
signed forward return at **+4h, +12h, +24h**. Per bucket: n, mean, median,
directional hit rate, **and lift over that coin's base rate at that horizon**.

## Kill criteria

| result | verdict |
|---|---|
| No bucket reaches **±5 points of lift** over its coin's base rate | **DEAD** |
| ±5 points but n < 5,000 | **UNPROVEN** — record, do not build |
| ±5 points, n ≥ 5,000, monotone across adjacent buckets, holds on 6+ of 10 coins | **LIVE** — carry to holdout |

4 inputs × 3 horizons = 12 comparisons. Roughly one hit is expected from noise.
**One LIVE input is not a finding.** Two or more, or one that is monotone and
holds across most coins, is worth the holdout.

## Prediction, on record

**Inputs 1 and 3 are DEAD.** Funding rate and premium index are on every
derivatives dashboard and in every funding-arbitrage bot. Whatever they say is
priced in before we could act. Same reasoning that has been right nine times.

**Input 2 (funding change) is the one worth the work.** The *level* of funding is
public and static; the *rate of change* is closer to positioning being built or
unwound in real time, and less commonly watched. Still expect DEAD.

**Input 4 (extremity) will show something and it will be the wrong thing.** The
project has already found that extremity separates — but as a magnitude signal
telling you when to stay out, not a directional one. If input 4 shows a lift,
check the mean forward return before believing it is directional.

**Overall: expect all four DEAD.**

## Rules

- No trade construction. No entries, stops, targets, cost model.
- **No lookahead, and funding is where this is easiest to fake.** An 8-hour
  funding value may inform a decision only after it has been *published*, not
  from the start of the period it covers. Asserted, with a deliberately-peeking
  function proving the check can fail.
- Fixed bucket thresholds, never sample percentiles.
- **TUNE only** — the holdout stays unspent.
- Raw values reported alongside buckets; bucket edges and window printed per run.
- **Shuffled-label control** — every bucket-horizon cell must land at the coin's
  base rate. If any shows a lift, the rig is broken and no result counts.

## Either way, what comes next

**If all four are DEAD:** price and public flow are both closed. The remaining
untested class is the collector's — open interest, taker buy/sell, long/short
ratio — which need roughly 12 months of accumulation, and the collector running
is what buys that option. The honest position then is that no tested input
predicts direction, and saying so plainly is worth more than another experiment
on the same material.

**If something is LIVE:** do not build a strategy on it. Run it to holdout first,
once. Then build.
