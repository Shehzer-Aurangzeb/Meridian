# Phase D — the non-linear attempt

Run 31 August 2026. `../../.venv-research/bin/python research/phase_d.py`;
output in `apps/api/test/manual/results/phase-d.csv` and `-shuffle.csv`.

**0 of 8 holdout rows clear the bar, and 0 of 8 clear it under the shuffled
control either.** Best real holdout row is 8.15 bp gross against a 14 bp round
trip, on 61 trades, with an interval of [-9.51, 27.81].

---

## Pre-registration

```
features   160 (39 screened base + 4h/24h deltas + cross-sectional ranks + context)
dropped    9: atrPct (persistence 0.66), qqeUp (coverage 77%),
           openInterest (0.99), longShortRatio (0.60),
           topTraderAccountRatio (0.58), topTraderPositionRatio (0.68),
           bookImbalanceNear (coverage 17%), bookImbalanceNear_z (17%),
           bookDepthNotional (0.97)
targets    fwdVol{H}h (return / own ATR, winsorised at +-5 for TRAINING only)
           tb{H}h     (triple barrier: +1 up one ATR first, -1 down first, 0 neither)
model      HistGradientBoosting, depth 3, lr 0.03, l2 1.0, early stopping
validation 5 contiguous calendar folds, embargo = horizon
holdout    last 182 days, 4,369 hours, touched once
book       long top 3, short bottom 3, half capital each leg, non-overlapping
the bar    net@14 > 0 on the HOLDOUT with a bootstrap interval excluding zero
```

## The result

```
    target  horizon    split  trades  gross bp   net@14         95% interval
  fwdVol4h       4h  HOLDOUT   1,093     -0.35   -14.35        [-1.44, 0.91]
      tb4h       4h  HOLDOUT   1,093      0.14   -13.86        [-0.46, 0.96]
 fwdVol12h      12h  HOLDOUT     365     -0.56   -14.56        [-2.82, 2.85]
     tb12h      12h  HOLDOUT     365      0.60   -13.40        [-2.85, 4.45]
 fwdVol24h      24h  HOLDOUT     183      5.82    -8.18        [0.99, 11.48]
     tb24h      24h  HOLDOUT     183      2.78   -11.22        [-2.48, 8.31]
 fwdVol72h      72h  HOLDOUT      61      3.62   -10.38       [-8.08, 18.28]
     tb72h      72h  HOLDOUT      61      8.15    -5.85       [-9.51, 27.81]
```

The single best row, `fwdVol24h`, has an interval that excludes zero: [0.99,
11.48]. So something is there. It is 5.82 bp against a 14 bp fee, on 183 trades.

## Against the shuffled control

The control permutes which coin got which outcome inside each hour, leaving the
market move and every feature's distribution untouched.

```
           sign flips   dev-holdout corr   max holdout   mean holdout
real            6 / 8             -0.293       8.15 bp       +2.53 bp
shuffled        2 / 8             +0.540       2.19 bp       -3.97 bp
```

**The real run beats noise on the holdout** — +2.53 bp mean against -3.97, and a
max of 8.15 against 2.19. Phase D is not measuring nothing. It is measuring
something worth roughly a third of its fee.

**And a statistic that looked decisive is not.** The dev-to-holdout sign flips
and their correlation were quoted at first as the damning finding: 6 of 8 flips
and a *negative* correlation, dev performance anti-predicting holdout
performance. The shuffled control scores better on exactly that statistic — 2
flips and +0.540 — and it is pure noise by construction. At n = 8 the
sign-flip count and the dev-holdout correlation carry no information about
whether a model is real, and reading them as if they did was an error. Recorded
here because the reasoning was persuasive and wrong.

Note also that the shuffled run produced a holdout row whose interval excludes
zero (`fwdVol12h`, 1.00 bp, [0.20, 1.90]). "The interval excludes zero" is
reachable by noise. The clause of the bar doing the work is `net@14 > 0`.

## What non-linearity actually bought

```
Phase C, ridge, 4h        1.01 bp
Phase D, trees, 4h        0.34 bp (fwdVol) / 0.27 bp (tb)
```

Nothing, at the horizon with the most trades. The estimate written before the
run was 10-30% improvement against a 14x gap. Measured is approximately zero,
which points the same way as the estimate and further.

## What was actually built, so "we did not try hard enough" is not available

Every item in the plan was implemented and is verified by
`research/test_phase_d.py`, which plants an oracle, recovers it at 125.9 bp, and
returns -0.6 bp on noise:

- **The target was changed first**, because that was the largest expected gain.
  Raw forward return became return-over-ATR and a triple-barrier label.
- **The features were changed second.** 39 became 160: 4h and 24h deltas so
  trees can see time at all, cross-sectional ranks beside z-scores, and four
  market-context columns.
- **Overlapping labels were thinned**, not weighted. The textbook 1/concurrency
  weight is a constant on an evenly sampled hourly panel and therefore a no-op.
- **The embargo is asserted in a test**, not assumed.
- **The holdout was touched once.**

Three defects in the first draft, all found before the run and all worth
recording:

1. The sample weighting described above did nothing and looked like rigour.
2. A market-context column was built from the cross-sectional spread of `fwd4h`
   and lagged four hours to stay legal. It was legal, and it was one refactor
   from being the target.
3. Market-context columns were being cross-sectionally standardised. They are
   identical across coins by construction — that is what makes them context —
   so it was 0/0 and each column became entirely NaN. sklearn reported this as
   `window shape cannot be larger than input array shape`. There is now a guard
   that names the empty column instead.

One data finding worth keeping regardless of the verdict: **dividing the forward
return by ATR made the tail worse, not better** — kurtosis 27 becomes 243. It is
not a small-ATR artefact. The 27 rows responsible, out of 320,000, have a normal
ATR and a median absolute 4-hour move of **19.7%**. Real crashes. The training
target is clipped at +-5; the P&L is not, and pays every one of them.

## Where this leaves the project

Four phases, one question, and it has now been asked every way this data
supports:

| | asked | answer |
|---|---|---|
| A | can the geometry be removed | yes — 320,000 rows, no fills or stops |
| B | does any single feature predict | 7 families over \|t\| > 3.0, none pays the fee |
| C | do they combine | 1.01 bp against 14 bp, same as shuffled |
| D | does non-linearity help | 0.34 bp; whisper above noise, third of the fee |

Also already ruled out, earlier: entry timing (better than chance, geometry
takes it back), fees as the explanation (loses at zero fee), cross-sectional
momentum at a weekly hold (§14e, worse than random risk-adjusted), and
cross-sectional funding at a weekly hold (§14f, a coin flip).

The honest reading is that there is a real but very small amount of information
in this feature set — Phase D's holdout beats its own shuffle — and it is
roughly a third of the size needed to survive a retail fee. Closing that gap
needs either a fee an order of magnitude lower than 14 bp, or information this
panel does not contain.

The analyst is unaffected. It shows zones, levels and context correctly and
never needed an edge to do so. What has been tested to exhaustion is the claim
that it predicts returns.
