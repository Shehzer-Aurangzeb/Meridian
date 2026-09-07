# Magnitude gate — does trading only the big moves rescue direction?

Run 5 September 2026. `pnpm --filter api magnitude-gate`; output in
`test/manual/results/magnitude-gate.csv`. Panel as Phase A, 320,000 rows,
10 coins, 2023-01 to 2026-09. Holdout: the last 182 days, 2026-03-03 to
2026-09-01, touched once.

**The magnitude model works. It does not help.** Predicted size and realised
size line up — the model reliably picks bigger moves, and the shuffle control
confirms the selection is coin-specific rather than a volatile-hour effect.
The directional signal inside those bigger moves is worth the same nothing it
was worth everywhere else.

---

## Pre-registration

```
features     43 of 53, Phase C's coverage and persistence gates
target       |log return| @4h, winsorised [0.01, 0.99] on TRAIN rows only,
             minus a 30-day per-coin trailing baseline
forecast     baseline + ridge tilt, lambda 10,
             5 purged calendar folds, embargo 4h
holdout      last 182 days, touched once
gate         one flat bet per (coin, hour) with predicted |return| > 40 bp,
             direction = Phase C sign, per-coin non-overlap
the test     net bp = gross − 14; 30-day block bootstrap, 2000 draws
the bar      the gate fails unless the 95% lower bound on NET bp is above zero
```

### One correction to the bar as commissioned

The brief asked for the gate to fail "if the 95% CI lower bound on net bp is
below 14". Net bp is already gross minus the 14 bp round trip, so reading that
literally charges the fee twice and demands 28 bp of gross. The bar used is the
dimensionally consistent one — net must clear **zero** — and both the gross and
net intervals are printed so either reading can be checked against the same
numbers.

### One correction to the model as commissioned

The brief specified the 39 (now 43) cross-sectionally standardised Phase C
features. Standardising within the hour deletes the market-wide level on
purpose, which is right for direction and fatal for magnitude: a design with no
intercept and zero-mean columns can only produce deviations around zero, so its
forecast never reaches an absolute 40 bp threshold at all. Fitted that way the
gate returned **zero trades** — a mis-specified model, not a null result.

Magnitude is therefore decomposed, and the halves are reported separately:

```
predicted |return| = baseline + tilt

baseline   per-coin trailing mean |4h return| over 30 days, using only
           returns already realised at the decision hour
tilt       ridge on the 43 standardised features, fit to
           (winsorised |return| − baseline)
```

Reporting them apart is the point: if the gate works on baseline alone, the
features bought nothing and the finding is "volatility clusters", which is not
a discovery.

---

## The result

```
arm                    trades blocks  gross bp   net@14    95% interval on net  realised |move|
full  high-magnitude   10,827      7      0.74   -13.26       [-14.92, -11.56]            79 bp
full  low-magnitude       125      3      3.41   -10.59        [-47.04, 55.60]            45 bp
baseline only  high    10,815      7      0.43   -13.57       [-15.09, -12.07]            80 bp
ungated (no gate)      10,920      7      0.47   -13.53       [-15.04, -12.04]            79 bp
```

**Gate FAILS.** Net −13.26 bp, 95% lower bound −14.92 bp, against a bar of
zero.

## The 40 bp threshold does not gate anything

The median 4-hour move on this panel is **65 bp** and the mean is **102 bp**.
65.7% of all bars clear 40 bp with no model involved at all. The
pre-registered threshold keeps **99% of the holdout** — it is not a filter, it
is a rounding error, and a single non-binding threshold cannot answer the
question it was asked.

So the same book was re-priced across a ladder:

```
threshold  trades   kept blocks  gross bp   net@14    95% interval on net  realised |move|
    40 bp  10,827    99%      7      0.74   -13.26       [-14.92, -11.56]            79 bp
    60 bp   8,784    80%      7      0.20   -13.80       [-15.56, -11.99]            85 bp
    80 bp   5,611    51%      7      2.78   -11.22        [-14.88, -7.94]            92 bp
   100 bp   2,460    23%      7     -1.38   -15.38        [-19.90, -6.12]            99 bp
   150 bp      17     0%      1     16.62     2.62           [2.62, 2.62]           108 bp
   200 bp       0     0%      0       NaN      NaN             [NaN, NaN]           NaN bp
```

Gross wanders between −1.4 and +2.8 bp as the book shrinks from 10,827 trades
to 2,460. There is no threshold at which selectivity turns into money. Net is
negative at every level that has enough data to be read.

**The 150 bp row is not a pass.** Seventeen trades landing in a single 30-day
block; a block bootstrap over one block resamples that block every draw and
returns a zero-width interval. That is an interval with nothing to resample,
not certainty. The runner prints the block count and refuses a verdict under
four blocks for exactly this reason.

## What the magnitude model genuinely achieved

Realised |move| rises monotonically with the threshold — 79, 85, 92, 99,
108 bp. The model does predict size. That is a real result, and it is the
first thing in this project that has worked as intended on the holdout.

## The shuffle control, which is what makes the above meaningful

`--shuffle` permutes the magnitude forecast among the coins present in each
hour, leaving direction and the realised return where they are. The hour's
volatility environment survives untouched; only the coin-specific mapping
dies.

```
threshold      real gross   real |move|   shuffled gross   shuffled |move|
    40 bp            0.74         79 bp             1.08             79 bp
    80 bp            2.78         92 bp             0.21             81 bp
   100 bp           -1.38         99 bp             1.71             85 bp
```

Two things fall out, and they point in opposite directions:

1. **The size prediction is real and coin-specific.** At the 100 bp threshold
   the real gate selects rows that go on to move **99 bp** against the
   shuffle's **85 bp**. Destroying which coin got which forecast costs 14 bp of
   realised move. The model is not merely detecting volatile hours.

2. **None of that skill reaches the P&L.** The shuffled gate's *gross* is
   +1.71 bp against the real gate's −1.38 bp. Shuffling the magnitude forecast
   made the book slightly better. Whatever the magnitude model knows, it is
   orthogonal to whether the directional signal is right.

---

## What this closes

Size and direction are unrelated on this data. Knowing a 100 bp move is coming
tells you nothing about which way it goes, and the directional signal does not
sharpen inside the moves large enough to pay for it.

This was the last cheap idea. The conditional-selection family — "the signal is
weak on average but strong when X" — has now been tested as conviction
(Phase C, 24 cells, one positive with an interval of [−1.40, 42.28]), as a
cheaper fill (Stage 0, gross negative on the larger sample), and as magnitude
here. Nothing in it survives.

**Nineteen directional tests, now twenty. The constraint has never been
finding information — it is finding information large enough to pay a fee, and
this run adds a sharper version: even correctly forecasting the size of the
move does not make the direction worth trading.**

## Reproduce

```
pnpm --filter api magnitude-gate
pnpm --filter api magnitude-gate -- --shuffle
pnpm --filter api magnitude-gate -- --threshold-bp 100
```
