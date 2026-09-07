# Layer 3 — liquidity and crowding

Run 6 September 2026. `pnpm --filter api layer3-bars`. Bars pre-registered in
[`../PRODUCT_LAYERS.md`](../PRODUCT_LAYERS.md) Layer 3.

**Bar 3a FAIL. Bar 3b FAIL.**

Both failures were declared survivable in advance, and both are. The liquidity
map becomes a display feature: depth percentiles and the shelf map are facts
about the book and ship as facts. Nothing here feeds a probability, and the
crowding score makes no claim about what stretched positioning means.

---

## Bar 3a — does a thick bid shelf make a support zone hold?

The one genuinely new question this project had left. Twenty tests had asked
whether something predicts the RETURN; this asked whether resting size predicts
a conditional FREQUENCY.

```
pre-registered:  >= 8 percentage point gap between the top and bottom terciles
                 of shelf thickness, interval excluding zero, on the holdout

resolved touches with a shelf reading   19,151   (holdout 2,792)
skipped: 58,311 zones beyond +-5% of mid, 533 with no usable book history

bottom tercile bounce   76.3%   (n=930)
top tercile bounce      75.6%   (n=930)
gap  -0.75 points, 95% block bootstrap [-7.93, 5.51] over 6 blocks

3a: FAIL
```

The gap is **negative** — thicker shelves bounced very slightly less — and the
interval straddles zero. Resting bid depth behind a support zone carries no
information about whether that zone holds.

**The test had the power to see the effect it was looking for.** The interval's
upper bound is 5.51 points, below the 8-point bar, so a pre-registered effect of
that size is excluded rather than merely unproven.

### The shuffle control is a warning about the interval, not about the result

```
real       gap -0.75, interval [-7.93, 5.51]
shuffled   gap +2.15, interval [ 0.10, 5.76]
```

Permuting thickness across touches produced a *larger* gap than the real data,
with an interval that nominally excludes zero. That is a caution about
**6 blocks being thin** — at that block count the bootstrap can manufacture a
nominally significant gap from noise — and it is exactly why the bar demanded a
magnitude as well as an interval. Both runs sit far below 8 points, so the
conclusion holds either way.

### The limit that shrinks this question regardless

**58,311 of 77,462 support zones — 75% — sit further than 5% from spot**, where
the archive publishes nothing at all. Even had 3a passed, the liquidity map
could only ever have spoken about a quarter of the zones the system finds. That
is structural: Binance's bookDepth feed ends at ±5% of mid, and no amount of
processing extends it.

## Bar 3b — is the unwind lift real?

```
crowded = funding >= 90th percentile (trailing, per coin)
          AND 24h open-interest change >= +5%
          AND %B >= 0.95
adverse = a fall of 5% or more within 24h

matches 103 over 6 distinct 30-day blocks       (bar: >= 100 over >= 4)
conditional adverse rate   11.7%
base rate                  11.1%
conditional 95% block bootstrap [7.5%, 19.4%]

3b: FAIL
```

The sample-size condition passes — 103 matches over 6 blocks. The lift does
not exist: 11.7% against 11.1% is six tenths of a point, and the interval
[7.5%, 19.4%] contains the base rate with room on both sides.

On the twelve adverse occasions, open interest moved a median **−2.6%** over
the window. That is the footprint of forced deleveraging and it is consistent
with the story — but n=12 is not evidence of anything, and it is reported here
only so nobody later finds the number and mistakes it for a result.

**Consequence: the system never claims crowded positioning predicts a drop.**
It reports the percentiles and stops.

## What ships

| output | status | basis |
|---|---|---|
| depth profile (shells 1-5, percentiles) | **ships** | a measurement, needs no calibration |
| historical shelf map | **ships** | a measurement |
| crowding score | **ships as description** | percentiles only, carries the no-lift finding |
| unwind sensitivity as a forecast | **does not ship** | Bar 3b found no lift |
| shelf thickness as an input to zone probability | **never** | Bar 3a failed |

Built: [`depth.math.ts`](../../apps/api/src/liquidity/depth.math.ts) — shells,
percentiles against the coin's own history, and a `shellForDistance` that
returns null beyond ±5% rather than extrapolating.
[`shelf-map.math.ts`](../../apps/api/src/liquidity/shelf-map.math.ts) — shells
converted to absolute prices, notional spread uniformly across each band rather
than spiked at its midpoint.
[`crowding.math.ts`](../../apps/api/src/liquidity/crowding.math.ts) — a
percentile composite that averages over the components actually present, and
carries `CROWDING_NOTE` on every reading so no consumer can present it as a
forecast.

### Still to wire

The crowding composite needs a live open-interest reading, and nothing
currently fetches one — the flow collector was switched off on 5 September and
`/futures/data/openInterestHist` has ~30 days of retention (enough for a 24-hour
change, but not currently called). The arithmetic ships and is tested; the fetch
is a Layer 4 decision, and given Bar 3b found no lift there is no urgency to it.

## Reproduce

```
pnpm --filter api layer3-bars
pnpm --filter api layer3-bars -- --shuffle
```

The shelf replay rebuilds each map as it stood via `LevelMapService.buildFrom`
with candles sliced by `completedAsOf`, takes the first touch of each support
zone per 8-hour window, and reads the bid notional in the shell containing that
zone, scored against 90 days of that shell's own history.
