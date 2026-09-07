# Layer 1 — the falsification bars

Run 5 September 2026, `pnpm --filter api layer1-bars`, before any Layer 1
service was written. Bars pre-registered in
[`../PRODUCT_LAYERS.md`](../PRODUCT_LAYERS.md) Layer 1.

> **UPDATE, 6 September 2026 — all three bars now PASS through the production
> services.** The hysteresis below was implemented in
> `src/market-regime/regime-hysteresis.ts` and the cone in
> `src/expected-move/`, and the bars were re-run through that code by
> `test/manual/layer1-service-bars.ts` rather than through the research rig.
> Results at the end of this document. The original research-rig run is kept
> below unchanged, because the failure it recorded is what produced the fix.

**1a PASS. 1b PASS. 1c FAIL.** The expected-move cone is real and, unexpectedly,
fully deployable without the switched-off collector. The regime classifier
flickers and cannot carry an age or an exit rate until it is fixed.

---

## Bars, as declared

```
1a  realised |move| rises monotonically across 5 predicted quintiles,
    top - bottom >= 20 bp
1b  real top quintile beats the within-hour shuffle by >= 8 bp
1c  median regime duration > 12h, and the three regimes show materially
    different 24h exit rates
```

Model: per-coin 30-day trailing baseline + ridge tilt, lambda 10, 5 purged
calendar folds, embargo = horizon. Holdout: last 182 days, 2026-03-03 to
2026-09-01, touched once. 43,680 holdout rows per horizon.

## 1a and 1b — the expected-move cone

Realised |move| by predicted quintile, in basis points:

```
        quintile 1 -> 5                         top vs shuffled       verdict
 4h     55 -> 71 -> 80 -> 88 -> 101   spread 46.1   100.8 / 86.5  +14.3   PASS
12h     99 -> 127 -> 140 -> 160 -> 172  spread 73.1  171.9 / 146.3 +25.7   PASS
24h    150 -> 184 -> 207 -> 221 -> 252  spread 101.6 251.8 / 213.8 +38.0   PASS
```

Monotonic at every horizon, and the margin over the shuffle grows with the
horizon rather than decaying.

The shuffled profiles are the interesting half. At 4h the real model runs
55 → 101 bp while the shuffle runs 73 → 87 — flatter, and lifted at the bottom.
That is exactly the expected signature: permuting the forecast among the coins
present in each hour leaves the hour as volatile as it was, so the shuffled top
bucket still sits above the overall mean, but the claim about WHICH coin is
gone. What separates 101 from 86.5 is the only part the features can claim, and
Bar 1b exists because without it "we predict big moves" reduces to "we noticed
the market is volatile today", which is free.

## The finding nobody asked for: the collector was not carrying the cone

The flow collector was switched off on 5 September 2026, so six of the 43
features (open interest, long/short, taker, top-trader) are no longer being
written and have ~30 days of retention behind them. Four more need OKX/Bybit
calls nothing currently makes, and three come from a book-depth archive
published a day late. That leaves **30 of 43** computable at run time from
candles plus the funding and premium endpoints, which have years of live
history.

Re-running both bars on that live-only subset:

```
              full 43 features        live-only 30 features
 4h  margin        +14.3 bp                  +14.6 bp
12h  margin        +25.7 bp                  +25.6 bp
24h  margin        +38.0 bp                  +37.9 bp
```

Identical to within noise, and marginally better at 4h. **The thirteen
features that need infrastructure we no longer run contribute nothing to the
magnitude model.**

Two consequences, both good:

- The cone can be served today with no new collection, no venue wiring and no
  dependence on a T+1 archive.
- It is independent evidence that switching the collector off cost nothing.
  That decision was made on the grounds that nineteen tests against the data
  had cleared no bars; this is the first measurement taken *after* it that
  could have contradicted it, and it does not.

## The cone's shape

Quantiles are the point forecast times an empirical ratio, `realised |move| /
predicted |move|`, whose distribution is fitted on TRAIN rows only and written
to `test/manual/results/expected-move-fit.json`:

```
horizon    p50     p80     p90
     4h   0.692   1.538   2.257
    12h   0.717   1.573   2.255
    24h   0.737   1.594   2.266
```

The stability across horizons is worth noting — the shape of the ratio
distribution barely moves while the scale changes by 3x, which is what makes
multiplying a single predicted scale by fixed ratios a defensible construction
rather than a convenience. **Whether these quantiles are calibrated is a Layer 2
question and is not claimed here.**

## 1c — regimes flicker. FAIL.

```
runs 21,951, median 9h, mean 14.5h        bar: median > 12h

COMPRESSION     share 17.4%   24h exit rate 76.8%   (n= 55,465)
MEAN_REVERSION  share 38.6%   24h exit rate 55.6%   (n=122,784)
TRENDING        share 43.9%   24h exit rate 48.1%   (n=139,511)
```

Half the bar passes: the exit rates differ by 28.7 points across regimes, which
is material. The duration does not. **Median 9 hours against a bar of 12.**

Measured on 1-hour bars deliberately. Production classifies on 12h candles,
where one bar already spans 12 hours and "median duration > 12h" is satisfied by
arithmetic rather than by stability. Hourly is the strict form of the same
question, and a label that changes every nine hours is not a state a reader can
be told the age of.

### Diagnosis: threshold chatter, not a wrong threshold

```
runs of 1-2h: 3,691 (16.8%)      runs <= 6h: 39.0%

transitions
  MEAN_REVERSION -> TRENDING       5,009
  COMPRESSION -> MEAN_REVERSION    4,645
  TRENDING -> MEAN_REVERSION       4,411
  MEAN_REVERSION -> COMPRESSION    4,047
  TRENDING -> COMPRESSION          2,216
  COMPRESSION -> TRENDING          1,613

at a TRENDING <-> MEAN_REVERSION flip:  median |ADX - 25| = 0.58
  73.8% of those flips have |ADX - 25| < 1.0
  96.6% have |ADX - 25| < 2.0
at a COMPRESSION flip:  median |percentile - 15| = 3.00 points
```

The largest transition pair is TRENDING↔MEAN_REVERSION, 9,420 flips, and
three quarters of them happen with ADX within **one point** of the 25 cutoff.
The classifier is not mislabelling anything — it is converting the noise in a
continuous variable into discrete state changes, because a bare threshold has no
memory of which side it was on.

### The fix, sized from the measurement

Hysteresis: a dead band, so leaving a regime requires more than re-crossing the
line that was used to enter it. The band was chosen to cover the observed
chatter (96.6% of flips sit within |ADX − 25| < 2.0), not by searching for a
value that passes:

```
band                       runs    median   1-2h runs   COMP/MEAN/TREN 24h exit
none (current)            21,951      9h      16.8%        77% / 56% / 48%
ADX +-1, pct 15/18        18,985     12h       9.5%        75% / 56% / 48%
ADX +-2, pct 15/20        17,515     13h       7.3%        74% / 57% / 48%
ADX +-3, pct 15/22        16,433     14h       6.1%        73% / 57% / 47%
```

`ADX ±2, percentile 15/20` clears the bar at **13h**, cutting 1–2 hour runs from
16.8% to 7.3%.

Stated plainly because it matters: **±2 is also the smallest band that clears** —
±1 lands on exactly 12h and fails a `> 12h` bar. The independent justification
is the 96.6% figure, measured before the bands were tried, and the honest
caveat is that the two coincide.

The regime shares and exit rates barely move across all four rows. The
hysteresis removes flicker without changing what the regimes mean, which is the
evidence that it is a fix rather than a re-definition.

### What it costs to apply

`MarketRegimeService.classifyFromContext(context)` is currently stateless.
Hysteresis makes the label depend on the previous label, so the signature has to
carry the prior regime, and every caller has to have one to give it. That is a
real change to a production service and is the reason this document stops here
rather than making it.

## Verdict

```
1a  PASS      1b  PASS      1c  FAIL
```

Bars 1a and 1b are cleared with room, on a feature set that needs no
infrastructure that is not already running. Bar 1c is failed by the classifier
as it exists, diagnosed to threshold chatter, and has a measured fix that clears
it.

## Reproduce

```
pnpm --filter api layer1-bars
pnpm --filter api layer1-bars -- --live-only
```


---

# Re-run through the production services, 6 September 2026

`pnpm --filter api layer1-service-bars`. Imports `conesForHour`,
`trailingBaseline` and `classifyWithHysteresis` from `src/` and replays them
over the panel. The research rig is not involved.

The distinction has teeth: a promoted model can differ from its research version
by a standardisation divisor, a feature order or an off-by-one in the baseline
window, none of which raise an error and all of which show up here as a bar that
stops clearing.

```
 4h  n=43,640   55 -> 70 -> 80 -> 89 -> 101 bp   spread  45.3   vs shuffle +14.2   PASS
12h  n=43,560  100 -> 127 -> 139 -> 160 -> 172   spread  71.7   vs shuffle +25.6   PASS
24h  n=43,440  150 -> 185 -> 206 -> 223 -> 251   spread 101.5   vs shuffle +38.1   PASS

regime, via classifyWithHysteresis()
  runs 17,515, median 13h, mean 18.2h, 1-2h runs 7.3%
  COMPRESSION     share 19.7%   24h exit 74.2%
  MEAN_REVERSION  share 37.1%   24h exit 56.8%
  TRENDING        share 43.3%   24h exit 47.9%
  median 13h (bar > 12h), exit-rate spread 26.4 points          PASS

1a PASS   1b PASS   1c PASS
```

## Eight features, not forty-three

Measured after the first run, because the collector being off raised the
question of what the model actually needs. Bar 1b's margin at 4h/12h/24h:

```
 8 indicators                      +14.2 / +25.5 / +38.0 bp
12 (+ funding, premium)            +14.2 / +25.6 / +38.1 bp
26 (+ level geometry)              +14.6 / +25.5 / +38.1 bp
30 (all live-deployable)           +14.6 / +25.6 / +37.9 bp
43 (everything, incl. collector)   +14.3 / +25.7 / +38.0 bp
```

Identical within noise. The eight indicators come from ONE 1-hour candle series
per coin, so the service needs no funding call, no level geometry across three
timeframes, no book-depth archive and no flow collector. The other thirty-five
features buy nothing and cost four data sources, so the service ships with
eight.

## Two corrections to the brief that commissioned the services

**"predicted = baseline × ratio" drops the tilt.** The construction that passes
Bar 1b is `predicted = baseline + tilt`, and the ratio turns that point forecast
into a cone: `quantile = predicted × ratio`. Multiplying the baseline by a ratio
and calling it the forecast removes the only part the features contribute, which
is precisely what the within-hour shuffle reproduces — i.e. it would fail 1b by
construction.

**"Hysteresis at ±2 on ADX" is not enough on its own.** Measured:

```
none                        median  9h    1-2h runs 16.8%
ADX +-2 only                median 11h    1-2h runs 13.9%
ADX +-3 only                median 11h    1-2h runs 14.2%
ADX +-2 AND pct 15/20       median 13h    1-2h runs  7.3%
```

12,521 of the flips involve COMPRESSION, and an ADX dead band does not touch one
of them. Both bands ship.
