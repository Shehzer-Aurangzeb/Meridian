# Phase C — do the weak signals combine into one that pays the fee?

Run 31 August 2026. `pnpm --filter api phase-c`; output in
`test/manual/results/phase-c.csv`. Panel as Phase A, 320,000 rows,
2023-01-02 to 2026-08-27.

**No.** Not marginally, and not for want of tuning.

---

## Pre-registration

```
features   39 of 48
dropped    atrPct (persistence 0.69), qqeUp (coverage 77%),
           openInterest (0.99), longShortRatio (0.58),
           topTraderAccountRatio (0.58), topTraderPositionRatio (0.67),
           bookImbalanceNear (coverage 17%), bookImbalanceNear_z (17%),
           bookDepthNotional (0.97)
model      ridge, lambda 10, scaled by row count
validation 5 contiguous calendar folds, embargo = horizon
book       long top 3, short bottom 3, half capital each leg, non-overlapping
the test   net basis points per trade at a 14 bp and 25 bp round trip
```

## The result

```
horizon  trades  gross bp   net@14   net@25   95% interval on gross   oos IC
     4h   8,000      1.01   -12.99   -23.99           [-0.06, 2.26]  -0.0151
    12h   2,667      0.82   -13.18   -24.18           [-1.75, 3.51]  -0.0100
    24h   1,334     -0.84   -14.84   -25.84           [-5.86, 3.87]  -0.0073
    72h     445      2.73   -11.27   -22.27         [-11.96, 17.88]  -0.0033
```

Every interval straddles zero. The combination is not merely too small to pay
the fee — at three of four horizons it is not distinguishable from no edge at
all.

## Three things that rule out the obvious objections

**It is not a tuning failure.** Ridge lambda from 1 to 10,000 — four orders of
magnitude — moves gross between 0.80 and 1.21 bp at 4h. There is no setting that
changes the answer.

**It is not better than chance.** The shuffled control, which permutes which coin
got which forward return inside each hour, returns 0.98 bp at 4h against the real
run's 1.01 bp.

**It is not a turnover problem, though that was the best remaining hope.** Cost
is charged per trade, so trading a tenth as often is the one lever that can make
a 1 bp edge pay a 14 bp fee. A conviction gate — trade only when the forecast
spread sits in the top slice of its own trailing 30-day distribution — was swept
across six levels and four horizons:

```
conviction   4h gross    72h gross
      0.0        1.21         5.04
      0.5        1.16         8.30
      0.8        1.85         4.49
      0.9        1.95         8.87
     0.95        2.28        19.73   <- net@14 = +5.73
     0.99        7.25         0.25
```

One of 24 cells goes positive after cost. Its neighbours are 8.87 and 0.25, and
its block-bootstrap interval over its 209 trades is **[-1.40, 42.28]**. It is not
significantly above zero, let alone above 14 bp. A single positive cell on a
24-cell sweep with unstable neighbours is what chance looks like, and it is
recorded here so that nobody re-finds it and reads it as a discovery.

## The out-of-sample IC is negative, and that is not a bug

−0.0151 at 4h, stable across every lambda, against ~0 for the shuffled control.
The model's ranking is consistently, mildly wrong out of sample.

Inverting it does not help: the book return of the inverted forecast is exactly
the negative of the book return, so it goes to −1.01 bp. This is the same
rank-versus-money divergence Phase B found, pointing the other way. The ranking
carries a small, stable, wrong signal; the money is not in the ranking either
way.

## Where this leaves the project

RESEARCH_PLAN §2.5 wrote the exit condition in t-stats, and Phase B cleared it.
`PHASE_B_IC.md` restated it in basis points: *"If the combined forecast's
long-short spread does not clear the round trip, that is where the research
stops."*

**It does not clear it.** Best honest figure is 1.01 bp per trade against a 14 bp
round trip, with an interval that includes zero.

What has been ruled out, over Phases A to C: the entry timing (better than
chance, and the geometry gives it all back), the trade geometry (removed
entirely — the panel has no fills, stops, ladder or cooldown), fees as the
explanation (it loses at zero fee), individual features (seven clear |t| > 3.0
and none pays the fee), and their combination (this document).

What has not been tried, and is named here so the decision is informed rather
than tidy:

- **Lower turnover than 72 hours, using THESE features.** Weekly holds pay the
  fee a dozen times a year instead of hundreds. The panel stops at 72h, so the
  Phase B feature set has not been combined at a weekly horizon.

  It should be read against the fact that the weekly horizon is not new ground
  here. `archive/STATE_OF_PLAY.md` §14e and §14f already tested the two
  canonical weekly cross-sectional edges over 166 rebalances, 2023-04 to
  2026-08, on a top-100 universe — and both came back null:

  ```
  momentum (30d formation, weekly hold, corrected for funding cashflow)
      strategy +0.273%/wk   random +0.183%/wk
      delta CI [-0.0065, +0.0078]   P(<=0) = 0.38
      Sharpe 0.45 against random's 0.52 — WORSE risk-adjusted

  funding (7d mean, contrarian, weekly hold)
      strategy +0.037%/wk   random +0.027%/wk
      delta +0.0001, CI [-0.0051, +0.0053], P(<=0) = 0.48 — a coin flip
  ```

  So "hold longer" is not an untested hope. The turnover argument is sound —
  §14f measured a breakeven round trip of 0.205% at weekly rebalance, against
  0.14% actual — but the two signals anyone would put in that slower book have
  been measured here and neither is an edge. What remains untested is narrower
  than it first looks: the Phase B feature set, combined, at a weekly hold.
- **A non-linear combiner.** A tree ensemble can express what ridge cannot —
  "high funding predicts down ONLY when bandwidth is also high" — and on
  financial panel data that is typically worth 10 to 30% over a linear fit.
  The gap here is 1.01 bp to 14 bp, which is 14x. Nothing in the literature
  suggests non-linearity closes a gap of that size, and every extra parameter
  is another way to overfit a sample whose effective n is already one to two
  orders of magnitude below its raw n.
- **More coins.** §14e measured the long tail bleeding 0.436%/week, so this is
  more likely to subtract than add.

The analyst itself is unaffected by any of this. It shows zones, levels and
context correctly, and it never needed an edge to do that. What stops, if the
call is to stop, is the claim that it predicts returns.
