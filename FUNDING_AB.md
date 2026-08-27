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

---

# Results — 27 Aug 2026

```
npx ts-node --transpile-only test/manual/volsignal.ts --flow --bars 20000
npx ts-node --transpile-only test/manual/volsignal.ts --delta --bars 20000   # regression
npx ts-node --transpile-only test/manual/volsignal.ts --self-check
```

10/10 coins covered, none dropped. 13,999 TUNE bars each,
**2024-05-16 → 2025-12-20**, 3,000 funding settlements and 20,000 premium
klines per coin. Seed 12345. Holdout untouched.

## Verdict: all four DEAD

**No bucket reached 5 points of lift with n ≥ 5,000, in any input, at any
horizon.**

| input | largest lift at n ≥ 5,000 | best tail (small n) | verdict |
|---|---|---|---|
| F1 funding rate | +1.8pt (`[-0.01,0)%` @+12h, n=20,676) | −24.7pt on n=200 | **DEAD** |
| F2 funding change | +1.9pt (`[-0.01,-0.003)pt` @+24h, n=22,972) | −4.5pt on n=979 | **DEAD** |
| F3 premium index | +1.8pt (`[-0.09,-0.07)%` @+12h, n=8,849) | +4.8pt on n=826 | **DEAD** |
| F4 funding extremity | +3.7pt (`[-4,-2)x` @+12h, n=3,212)* | −15.1pt on n=568 | **DEAD** |

\* also under the floor; the largest F4 lift at n ≥ 5,000 is +2.6pt.

Six cells cleared 5pt of lift and **every one was UNPROVEN** — n between 200 and
1,036, against a 5,000 floor:

```
F1 [-inf, -0.03)%  @+12h:  +5.5pt on n=1036
F1 [0.05, +inf)%   @+4h:   -6.0pt on n=200
F1 [0.05, +inf)%   @+12h: -24.7pt on n=200 · mean fwd -1.18% · median -1.58%
F1 [0.05, +inf)%   @+24h: -15.2pt on n=200
F4 [4, +inf)x      @+12h: -15.1pt on n=568 · mean fwd -0.28%
F4 [4, +inf)x      @+24h: -13.7pt on n=560 · mean fwd -0.79%
```

## The shuffled control is clean, and it earns its keep twice

**Zero cells over 5pt of lift, at any n.** Largest deviation +3.7pt.

The second thing it shows is more useful: its largest deviations land in exactly
the smallest buckets —

```
F1 [-inf,-0.03)  n=1036   +3.7pt
F1 [-inf,-0.03)  n=1036   +2.8pt
F2 [0.03,+inf)   n=979    +2.8pt
F1 [0.05,+inf)   n=200    -2.7pt
```

Randomly-assigned labels swing a 200-to-1,000-observation bucket by ±3–4 points
on their own. That is direct evidence, from this run, that the small-n cells
above are not to be read.

## Monotonicity — real, and still not enough

This is the honest complication and it is worth stating plainly rather than
burying under the DEAD verdict.

**F1 is monotone across its whole range**, lift at +4h by bucket:

```
+3.8  +1.5  +0.9  +0.6  -0.7  -0.7  -0.8  -6.0
```

Negative funding → mildly more upside; positive funding → mildly more downside;
extreme positive funding → sharply more downside. That is textbook
mean-reversion against crowded positioning, and it has the shape a structural
signal is supposed to have — unlike the volume-delta gradient, which vanished
when n grew.

**F4 shows the same shape**, lift at +24h: `+0.9 +3.3 +2.4 +0.6 +1.0 -1.6 -0.4 -13.7`.

**But in every bucket large enough to trust, the lift is 1–3 points**, and the
bar was 5. The large numbers live only where n is small. So the criterion is not
met and the verdict is DEAD, not "nearly".

## The prediction, scored

**F1 and F3 DEAD — correct.** F3 (premium) is the flattest input in the whole
study: nothing beyond ±1.8pt at any trustworthy n.

**F2 DEAD — correct**, and it was the flattest of the three funding variants at
large n despite being named the dark horse.

**F4 "will show something and it will be the wrong thing" — half right.** It did
show something. But it is *not* a pure magnitude signal: in `[4,+inf)x` at +12h
the hit rate (37.0%) and the mean forward return (−0.28%) and the median
(−0.40%) all point the same way, down. Where it appears, it appears directional.
It simply appears only at n=568.

The same is true of F1's top bucket, more strongly: 25.5% up, mean −1.18%,
median −1.58%. Direction and magnitude agree.

## The n floor is still too generous, for a reason the floor cannot see

**Funding is an 8-hour series sampled once an hour, so every observation is
duplicated eight times by construction.** The 200 bars in F1's top bucket are at
most 25 distinct settlements, and high-funding episodes cluster — so the
effective count is likely under ten independent events, not 200.

Premium is hourly and does not have this problem. Funding and extremity do.

**Recorded as a methodology finding: for any input published on a slower clock
than the decision bar, the n floor must count publications, not bars.** A floor
of 5,000 bars on an 8h input is a floor of 625 settlements, and on a clustered
input far less than that. This is a stronger reason to distrust the tails than
"small n", and it was not in the pre-registration.

## What this closes

**Price-derived and publicly-visible-flow inputs are both closed.** Thirteen
tests now — nine of price shape and volume, four of funding and premium — and
nothing has cleared its pre-registered bar.

The one thing worth carrying forward is not a signal, it is a shape: funding
mean-reversion is monotone and it points the same way in hit rate, mean and
median. It fails on effective sample size, not on direction. If the collector's
inputs (open interest, taker buy/sell, long/short ratio) ever show the same
shape with real n behind it, that is where to look — and those need ~12 months
of accumulation.

Until then the honest position is that **no tested input predicts direction**.
