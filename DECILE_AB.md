# Meridian — the same inputs at decile resolution: pre-registration

**Written 27 Aug 2026, before any code. Part A is not edited after seeing a
result.**

## Why this exists

Fourteen directional tests came back DEAD. An audit then established two things:

1. **The rig works.** A planted 5.0pt edge at n=6,988 — right at the decision
   boundary — was recovered at exactly +5.0. Planted signals at four strengths
   and horizons all came back at their planted values.

2. **The bucket edges hid a result.** V1 (volume node distance) was reported DEAD
   at +4.0pt because everything above +5% fell into a single bucket of 39,022
   observations. Re-bucketed on deciles, the top decile reads **+8.2pt at +24h,
   n=13,476, 10/10 coins, all three time periods, bootstrap CI [5.6, 11.0]**.

The edges were chosen before the distributions were known. That is a resolution
problem, not a data problem, and it applies to every input tested so far.

This run repeats the same measurement at higher resolution.

## Note on what carries over from the audit

**The audit's rig was never committed.** Nothing in the repo contains the plants,
the block bootstrap or the drawdown baseline — only the numbers quoted above,
which came out of a session that left no code behind. All three are rebuilt here
from scratch, which means the plant strengths below are **re-specified, not
recovered**. They are pinned in this document before the code exists, which is
the property that matters; but "P5 through P8 recovered again" cannot mean
"recovered at the audit's exact numbers", because those numbers are not
available to check against. Stated plainly rather than papered over.

## What changes from the previous runs

**1. Deciles replace fixed edges.** Ten equal-count buckets per input **per
coin**, so a decile means "extreme for this coin" and a bucket is not 80% BNB.

**Derive decile boundaries from TUNE only, never the full sample.** Sample
percentiles leak the future into bucket assignment — that has been a standing
rule in this project and it applies with more force here, since the whole point
is that the edges are now data-derived. Print the boundaries with every run and
apply the same fixed boundaries to holdout if it is ever spent.

**2. A confidence interval on every cell, not just a hit rate.** The audit found
the rig has no concept of power: a small-n small-lift cell currently reads
identically to a huge-n small-lift cell, and only one of those is genuinely dead.

Every cell reports lift, effective n, and a bootstrap CI. **A cell is DEAD only
when its CI excludes the 5-point bar.** Otherwise it is UNPROVEN.

Pinned before the run:

- **95% CI, percentile method, 2,000 resamples, 14-day calendar blocks.**
- A block is drawn **with every coin's observations inside it**, so
  cross-sectional correlation is preserved rather than averaged away — the same
  reasoning as the month-block bootstrap in `bootstrap.ts`.
- ~19 months of TUNE is roughly **42 blocks**. That is the real sample size and
  the CIs will be wide because of it. Wide is the honest answer, not a defect.

**3. Effective n, not raw n, for anything published slower than the decision
bar.** Funding is 8-hourly sampled hourly — 8.0× duplication, confirmed. Use the
block bootstrap rather than distinct-publication counting, which is too harsh.

Pinned before the run: **effective n = p̂(1−p̂) / SE²**, where SE is the standard
deviation of the bootstrap distribution of the cell's up-share. It is the
binomial sample size that would produce the spread actually observed. On an i.i.d.
cell it lands near raw n; on funding it should land near raw n / 8 or worse.

**4. A drawdown control, in addition to the shuffled control.** V1's entire
effect reproduces with a plain 500-bar drawdown and no volume input at all
(+4.2 / +6.9 / +8.0 against V1's +5.4 / +8.5 / +9.6). So the volume machinery was
contributing nothing — the finding was mean reversion after a drawdown wearing a
volume costume.

Pinned before the run: the baseline input is **the signed percent change from the
close 500 bars ago to the current close** — same lookback as the volume node,
no volume in it at all — decile-bucketed by exactly the same machinery.

**Every new hit must beat the drawdown baseline, not just beat random.** Report
both side by side for any cell that clears the bar. Without this, the project
will keep rediscovering mean reversion in different clothes.

## Inputs

The same 8 already registered — 4 volume, 4 flow — re-bucketed. **No new inputs.**
This is a resolution change on tested material, and adding inputs would confound
the comparison and inflate the multiple-comparison count.

Plus the drawdown baseline, which is a control rather than a candidate, and is
excluded from the multiple-comparison count for that reason.

## The positive control, specified before it is built

Four synthetic inputs, each constructed so that a **known** lift sits in a
**known** decile at a **known** horizon. The plant is built per coin against that
coin's own base rate, and the observations recruited into the planted decile are
drawn at random in time, so the plant carries no time structure of its own.

| plant | decile | horizon | planted lift |
|---|---|---|---|
| **P5** | top (10th) | +24h | **+8.0pt** |
| **P6** | top (10th) | +12h | **+5.0pt** — sits exactly on the decision boundary |
| **P7** | top (10th) | +4h | **+2.0pt** — must NOT clear the bar |
| **P8** | bottom (1st) | +12h | **−5.0pt** — checks the inverse direction |

**Recovery tolerance: ±0.5pt.** P6's CI must also exclude neither side by
construction — it is planted at the bar, so a rig that calls it confidently DEAD
or confidently LIVE is a rig that is lying about its own precision.

**If P5–P8 do not recover, nothing else in the run counts.** The plants validated
fixed bucketing; they have not validated decile bucketing, and decile bucketing
is where the boundaries are now derived from the data itself.

## Kill criteria

Per input, TUNE only:

| result | verdict |
|---|---|
| Every cell's CI excludes +5pt lift | **DEAD** |
| A cell clears +5pt but its CI includes it, or effective n is below floor | **UNPROVEN** |
| CI excludes 5, holds on 6+ of 10 coins, holds across all three time periods, **and beats the drawdown baseline** | **LIVE** |

8 inputs × 10 deciles × 3 horizons is a large surface. **Deciles are exploratory
by construction** — the more cells, the more noise clears any bar. So:

- Report the number of cells that clear, against how many would be expected by
  chance. Chance is measured two ways: the nominal 2.5% tail of the 240 cells,
  and the empirical count of clearing cells in the shuffled controls.
- A single clearing cell is not a finding.
- **Monotonicity across adjacent deciles is required**, not optional. A signal
  that strengthens smoothly is structural; one decile spiking alone is noise.

## Prediction, on record

**Most inputs stay DEAD.** The resolution change fixes a measurement flaw, not
the inputs.

**V1's top decile will replicate** — it is already measured — **and will not beat
the drawdown baseline.** Expected outcome: V1 is a rediscovery of post-drawdown
mean reversion, which is the most-watched pattern in markets and priced in.

**F1's tails may move from DEAD to UNPROVEN** on effective-n and CIs. The middle
is genuinely flat and its gradient was absent in period 1, so it is a 2025
phenomenon rather than a structural one.

**Overall: expect no LIVE verdict.** If something does come back LIVE, check the
drawdown baseline first, then per-period stability, before believing it.

## Rules

- **No trade construction.** Direction only. No entries, stops, targets, cost
  model.
- **No lookahead.** Reuse the existing publication-lag machinery, which the audit
  verified independently.
- **Decile boundaries from TUNE only**, printed every run.
- **TUNE only.** Do not touch the holdout.
- Report raw values alongside deciles.
- Same coins, same window, same seed as the previous runs, so results are
  comparable.

## Load-bearing checks

- **Positive control, re-run under deciles.** P5 through P8 must recover at the
  strengths tabled above.
- **Shuffled control** on every input, and this time preserve the coin↔base-rate
  pairing (the audit found the previous shuffle did not, worth ≤0.56pt) and run
  more than one shuffle. Pinned: **shuffle within each coin, three seeds.**
- Decile boundaries printed, and each decile confirmed to hold ~10% of
  observations.
- Effective n reported beside raw n on every cell.

## Report

1. **Positive control under deciles** — planted vs recovered. This section first.
2. Decile boundaries per input, and observation counts per decile.
3. Per input: cell table with lift, raw n, effective n, CI, at all three
   horizons.
4. Verdict per input against the criteria. DEAD / UNPROVEN / LIVE.
5. **Cells clearing the bar vs cells expected by chance.**
6. For any clearing cell: monotonicity across adjacent deciles, per-coin
   consistency, per-period stability, and **the drawdown baseline beside it**.
7. Shuffled control numbers.
8. Tests.
9. What was NOT done — plainly.

## What comes next, either way

**If nothing is LIVE:** price-derived and publicly-visible-flow inputs are closed
at higher resolution as well as fixed. The remaining untested class is the
collector's — open interest, taker buy/sell, long/short ratio — which needs
roughly 12 months of accumulation. The collector running is what buys that
option.

**Also outstanding:** five of the thirteen earlier tests (HIERARCHY_AB,
CHARTS_AB) ran through `backtest-plans.ts`, which has never had a positive
control. Those verdicts rest on an unvalidated rig and should be treated as
provisional until it gets one.

---

# Results — 27 Aug 2026

```
npx ts-node --transpile-only test/manual/volsignal.ts --deciles --all --bars 20000
npx ts-node --transpile-only test/manual/volsignal.ts --all --bars 20000   # fixed-edge regression
npx ts-node --transpile-only test/manual/volsignal.ts --self-check
```

10/10 coins, none dropped. 13,999 TUNE bars each, **2024-05-16 → 2025-12-20**,
seed 12345, ~135,000 observations per input. Holdout untouched. Two minutes wall
clock. Full output at `apps/api/test/manual/results/deciles-20260827.txt` — that
directory is gitignored, as every results artefact in this repo is, so the file
is local and the first command above regenerates it.

## Verdict: no LIVE. One cell cleared, and it is the drawdown.

| input | verdict | cells measured flat | biggest lift |
|---|---|---|---|
| V1 volume node | **UNPROVEN** | 16/30 | D10 @+24h **+9.7pt** CI [6.2, 14.3] |
| V2 relative volume | **DEAD** | **30/30** | D9 @+12h +1.1pt CI [−0.9, 3.1] |
| V3 volume at extremes | **UNPROVEN** | 22/30 | D1 @+24h +3.6pt CI [−2.4, 9.6] |
| V4 volume delta | **UNPROVEN** | 27/30 | D2 @+4h +2.2pt CI [0.7, 3.7] |
| F1 funding rate | **UNPROVEN** | 19/27 | D1 @+12h +3.3pt CI [0.5, 6.2] |
| F2 funding change | **UNPROVEN** | 26/30 | D5 @+12h +4.9pt CI [−3.6, 13.5] on n=646 |
| F3 premium index | **UNPROVEN** | 28/30 | D1 @+24h +1.6pt CI [−1.2, 4.8] |
| F4 funding extremity | **UNPROVEN** | 20/30 | D1 @+12h +3.6pt CI [0.6, 6.5] |
| *DD drawdown (control)* | *not a candidate* | *13/30* | *D1 @+24h +10.2pt CI [4.7, 15.0]* |

**Read the UNPROVEN column carefully — it is mostly a downgrade, not an upgrade.**
Under fixed edges these inputs were DEAD. Most of those verdicts were never
earned: the cells were too imprecise to exclude a 5-point effect, and the old rig
had no way to say so. Only V2 is now genuinely dead in all thirty cells.

## 1. Positive control under deciles

Every plant recovered at its planted strength, to the printed digit.

```
plant  decile  horizon  planted  recovered  n      n_eff  95% CI          result
P5     D10     +24h     +8.0     +8.0       14000  1807   [5.8, 10.2]     OK
P6     D10     +12h     +5.0     +5.0       14000  3037   [3.3, 6.9]      OK
P7     D10     +4h      +2.0     +2.0       14000  5871   [0.8, 3.3]      OK
P8     D1      +12h     -5.0     -5.0       13990  3218   [-6.7, -3.2]    OK
```

Three things to note rather than skip past.

**P6 behaves exactly as a rig sitting on its own decision boundary should.**
Planted at the bar, it recovers at the bar and its interval [3.3, 6.9] straddles
it. A rig that had called P6 confidently DEAD or confidently LIVE would have been
lying about its own precision, and the CI machinery exists to stop that.

**P7 is the negative half of the control.** Planted at +2.0pt — under the bar —
it recovers at +2.0 and its interval excludes 5. The rig can also say *no*.

**The plants run offline too**, in `--self-check`, on synthetic random-walk bars
with no network. Tighten the tolerance to 0.001pt and the check fails with
`P5: planted 8pt, recovered 8.00pt` — so it is measuring something, not passing
on a NaN.

## 2. Decile boundaries and counts — and where deciles do not work

Boundaries are printed per coin per input in the saved output. Counts:

```
DD, V1, V2, V3, V4, F3     every decile 9.98%-10.03%      as intended
F4 funding extremity       D8 15.2%, the rest 8.8%-10.1%   mild
F2 funding change          D5 0.5%, D7 21.0%, D8 14.6%     bad
F1 funding rate            D8 0.0% (EMPTY), D10 37.9%      broken
```

**The resolution fix does not work on funding, and this is the most useful thing
the run produced.** Binance clamps the funding rate at 0.010% for long stretches,
so the input is a spike at a cap, not a distribution. Ten equal-count buckets
cannot be cut through a spike: F1's top decile holds 53,008 observations — 37.9%
of the sample — which is a *worse* pooling of the tail than the fixed edges it
replaced, and D8 has no observations at all.

So the pre-registration's claim that deciles raise resolution holds for every
volume input and for premium, and **fails for the funding family**. F1's tail is
still unresolved. It is unresolved for a different reason than before, and no
amount of re-bucketing fixes a capped series — that would need conditioning on
"is at the cap" as its own state, which is a new input and out of scope here.

## 3–4. Per-input cells and verdicts

Full tables at all three horizons are in the saved output. The one worth printing
is V1, because it is the reason this run exists:

```
V1 +12h
cell   raw range          n       n_eff   up%     base    lift    95% CI          verdict
D1     [-61.09, -8.82]    13489   599     48.4%   50.4%   -2.0    [-6.4, +1.5]    UNPROVEN
D2     [-16.36, -4.79]    13500   660     49.5%   50.4%   -0.9    [-4.8, +2.7]    DEAD
D3     [-8.63, -2.61]     13490   789     48.7%   50.4%   -1.7    [-5.1, +1.7]    UNPROVEN
D4     [-4.81, -0.41]     13500   946     50.0%   50.4%   -0.4    [-3.7, +2.7]    DEAD
D5     [-1.69, 1.28]      13476   1127    49.0%   50.4%   -1.4    [-4.6, +1.3]    DEAD
D6     [-0.20, 3.81]      13489   864     49.3%   50.4%   -1.1    [-4.5, +2.2]    DEAD
D7     [0.59, 6.88]       13495   1529    49.2%   50.4%   -1.3    [-3.7, +1.3]    DEAD
D8     [1.80, 11.29]      13469   971     49.1%   50.4%   -1.3    [-4.4, +2.0]    DEAD
D9     [3.93, 17.83]      13472   888     52.1%   50.4%   +1.7    [-1.4, +5.1]    UNPROVEN
D10    [7.01, 65.81]      13500   1287    58.7%   50.4%   +8.2    [+6.0, +11.3]   CLEARS
```

**The audit's +8.2pt reproduces exactly, at n within 24 observations of the
quoted figure.** It reproduces at **+12h**, not at the +24h the audit reported;
+24h reads +9.7pt on n=13,500 with a wider interval. The audit's rig is not in
the repo, so which horizon its 8.2 belonged to cannot be checked. Both cells
exist and both are large.

**Look at the n_eff column against n.** Every cell holds ~13,500 observations and
almost none of them carry 1,000 observations' worth of independent evidence. That
is the block bootstrap saying what raw n never could: hourly bars measured over a
24-hour forward window, across ten coins that move together, are not 13,500
pieces of evidence.

**The effective-n floor is load-bearing, and it is close.** Two cells were held
back by it alone:

- **V1 D10 @+24h: +9.7pt, CI [6.2, 14.3] — the interval excludes 5 — but
  n_eff = 541.** On the CI rule alone this would have been a second clearing
  cell.
- **DD D1 @+12h — the drawdown control itself — +8.4pt, CI [5.4, 11.6],
  n_eff = 970 against a floor of 1,000.** Had the floor been pinned at 900, the
  *control* would have cleared the bar. That is the strongest available argument
  that the bar is measuring an artefact of persistence rather than an edge, and
  it is luck that the floor landed where it did rather than judgement.

## 5. Cells clearing versus cells expected by chance

```
cells clearing the bar:                  1 of 237 candidate cells
shuffled controls over the same cells:   0, across all 24 shuffles
largest |lift| under shuffle:            2.3pt
nominal reference (2.5% of 237):         5.9 cells
```

The shuffle is the number to use. The nominal 5.9 assumes an independence this
data does not have, and the shuffle is a true null with this data's exact n,
decile structure and block structure — it says the surface produces **zero**
false clears, not six.

That cuts both ways. It means the one clearing cell is not multiple-comparison
noise. It also means the one clearing cell has to survive everything below.

## 6. The clearing cell, taken apart

```
V1 D10 @+12h: +8.2pt CI [6.0, 11.3] n=13,500 n_eff=1,287

lift by decile:  -2.0 -0.9 -1.7 -0.4 -1.4 -1.1 -1.3 -1.3 +1.7 +8.2
monotone:        rho=0.60, at an end=true            -> NO  (needs |rho| >= 0.7)
per-coin:        BTC +12.2  ETH +6.6  SOL +5.1  BNB +9.5  XRP +13.8
                 ADA +7.1  AVAX +5.6  DOT +6.3  LINK +7.1  LTC +9.2
                 same sign 10/10                     -> YES (needs 6+)
per-period:      +10.2  +7.6  +7.5   3/3 same sign   -> YES (needs 3)
drawdown, same decile+horizon:  -1.5pt CI [-7.6, 2.3] -> YES, it beats it
```

**It fails on monotonicity, which the pre-registration made required rather than
optional.** Nine deciles sit between −2.0 and +1.7 and the tenth jumps to +8.2.
That is not a gradient, it is a step at the edge of the range — the shape of a
threshold or of a different regime, not of an input that carries more information
as it grows. The per-coin and per-period consistency is genuinely strong, and it
is not enough on its own.

**And the drawdown comparison as pre-registered is too weak a test, which the
data made obvious.** Same decile, same horizon, the control reads −1.5pt, so V1
"beats the baseline". But V1's top decile means *the heavy-volume price is far
above spot* — which is another way of saying price has fallen away from where it
traded. So the two can be the same bars while their deciles do not line up.

Asking where this cell's bars actually sit in the control's deciles:

```
D1 37.1%  D2 26.6%  D3 14.6%  D4 8.1%  D5 4.6%  D6 3.2%  D7 2.9%  D8 1.3%  D9 1.2%  D10 0.3%
```

**63.7% of the clearing cell is in the drawdown control's bottom two deciles.**
Remove those bars and re-measure what is left:

```
+2.7pt  CI [-1.7, +7.8]  n=4,901  n_eff=415  -> UNPROVEN
```

The effect falls from +8.2 to +2.7 and the interval covers zero. The honest
statement is not "the residual is dead" — n_eff 415 cannot exclude a real
residual either — it is that **the effect is not shown to survive removal of the
drawdown, and two thirds of it was drawdown to begin with.** The prediction on
record was that V1 would replicate and would be post-drawdown mean reversion
wearing a volume costume. That is what it is.

**This test was added after seeing the result, and that is worth flagging.** It
is not in Part A. It only ever makes a verdict stricter, and the cell was already
UNPROVEN on monotonicity before it ran, so it changed nothing — but it is
post-hoc, and a post-hoc test that had *rescued* a cell would not have been
allowed to.

## 7. Shuffled control

Within each coin now, three seeds per input, 24 runs total.

```
zero cells cleared the bar in any shuffle
largest |lift| in any cell of any shuffle: 2.3pt (F2)
per-input largest: V1 0.9  V2 1.2  V3 1.1  V4 1.3  F1 1.6  F2 2.3  F3 0.9  F4 0.9
```

Shuffling within coin rather than across the pool matters for a reason the audit
found: the old shuffle also reassigned which coin's base rate an observation was
judged against, so it was measuring a second thing worth up to 0.56pt on top of
the one it was for. Deciles stay put, outcomes move, and every cell lands on its
own base rate.

## 8. Tests

`--self-check`, no network, ~1 second:

- The **lookahead invariant on all nine inputs** including the new drawdown
  control: recompute on a bundle truncated at bar *i* and demand the identical
  number.
- **Two deliberate cheats** — the next candle, and funding that settles after the
  bar closes — must both be caught, or the invariant test proves nothing.
- Publication lag as a concrete case; `nthBefore` counting settlements backwards
  and refusing to wrap; bucket totality; volume-input semantics; median.
- **Decile cutting**: nine cut points on known percentiles, ten buckets each
  holding exactly a tenth, and a two-coin case where BIG's values are 10× SMALL's
  and both still fill all ten deciles — the per-coin property, which a pooled cut
  would fail.
- **The four plants, offline**, on synthetic random-walk bars. Each recovers
  within 0.5pt, and the decile that was *not* planted in must stay flat, so a
  plant that leaked across buckets fails the check.
- **Effective n must come out below raw n** on overlapping forward returns.

Regression: `--all --bars 20000` on the untouched fixed-edge path reproduces its
published numbers — V1 `[5,+inf)%` @+24h at 53.6% / +4.0pt on n=39,028 against
the 39,016 published on 27 Aug, and F1 `[-inf,-0.03)%` @+12h at +5.5pt on
n=1,036 exactly.

**How to check this run rather than believe it:**

1. `--self-check --plant-tol 0.001` must FAIL, printing the recovered value. If
   it passes, the plants are not being measured.
2. Change the bar and the count must move with it. Measured on V1:
   `--lift 3` gives 2 clearing cells, `--lift 12` gives 0. A bar that does not
   move the answer is not being applied.
3. `--neff-floor 900` must make the drawdown control's D1 @+12h clear. If the
   floor does not decide that cell, the floor is not wired in.
4. `--shuffles 10` must still produce zero clears. Measured on V1: ten seeds,
   zero clears, largest |lift| 1.1pt. If a shuffle ever clears, stop reading the
   run.
5. Every interval must be **several times wider than the binomial one raw n
   implies**. V1 D10 @+12h on n=13,500 at 58.7% gives a binomial 95% interval of
   ±0.8pt, i.e. [7.4, 9.0]; the block bootstrap gives [6.0, 11.3], ~3× wider. If
   an interval ever matches the binomial one, the bootstrap is resampling
   observations rather than blocks and every CI here is too narrow.
6. `--block-days` must move the intervals. It does, and **not in the direction
   the textbook suggests** — see the sweep below.
7. The counts line must read ~10% per decile for V1–V4. If it does not, the
   boundaries are not being applied to the coin they were cut from.

### Block width: the one place the rig behaves unintuitively

14 days was pinned in Part A. It is not obviously long enough — V1's input has a
500-bar (~21-day) lookback and the forward window is another 24h — so the cell
was re-measured across block widths:

```
block-days   V1 D10 @+12h                       n_eff   verdict
7            +8.2pt  CI [+5.5, +11.0]           1180    CLEARS
14           +8.2pt  CI [+6.0, +11.3]           1287    CLEARS
28           +8.2pt  CI [+5.9, +11.5]           1160    CLEARS
42           +8.2pt  CI [+5.9, +11.5]           1193    CLEARS
56           +8.2pt  CI [+5.9, +12.4]            985    UNPROVEN
```

**The interval is stable from 7 to 42 days**, so the clearing verdict is not an
artefact of the width that happened to be pinned. At 56 days it flips — on the
effective-n floor again, by 15 observations, with an interval that still excludes
5. That is the third time in this run that the floor rather than the evidence
decided a verdict.

Two things worth knowing about effective n as a quantity:

**It does not fall monotonically as blocks get longer**, which is what the naive
reading expects. At `--block-days 1` the same cell reads n_eff 717 with a *wider*
interval than at 14 days. The cause is occupancy, not dependence: a decile's
members are clustered in time, so at one-day blocks most days hold none of them
and a few hold all 24, and the ratio estimator inherits that lumpiness. Blocks
have to be long enough to contain a representative slice of the cell, not just
long enough to contain the dependence.

**So n_eff is the fuzzier of the two numbers.** The interval moved by 1.4pt
across an eight-fold change in block width; n_eff moved by 30%. Where the two
disagree, trust the interval — which is an argument that the effective-n floor
should be a backstop and not a decision rule, and it decided three cells in this
run.

## 9. What was NOT done

- **The holdout was not touched.** No input reached LIVE, so there was nothing to
  spend it on.
- **No trade construction.** No entries, stops, targets or cost model. Direction
  only.
- **No new inputs.** The same eight, re-bucketed, plus the drawdown control.
- **The audit's rig was not recovered** — it was never committed. The plants,
  block bootstrap and drawdown baseline here are rebuilt from scratch, so
  "P5–P8 recovered again" means "recovered at the strengths pinned in Part A of
  this document", not "matched the audit's numbers".
- **Three definitions were pinned after Part A was committed**, because Part A
  left them open. All three are in the code and all three make the LIVE criterion
  *harder*, not easier: the effective-n floor at 1,000; "holds across all three
  periods" as same sign in all three; monotonicity as |rho| ≥ 0.7 with the
  clearing cell at an end of the range.
- **The same-bars drawdown test is post-hoc**, as flagged in section 6.
- **F1's cap was not worked around.** Conditioning on "funding is at the cap" as
  its own state would be a new input, and this run was pre-registered as a
  resolution change on tested material.
- **The two queued items are still open**: the 7-chart hierarchy is still live in
  `LEVEL_TIMEFRAMES` with a measured WORSE verdict, and the golden set is still
  red for the `tier` schema reason.
- **`backtest-plans.ts` still has no positive control**, so HIERARCHY_AB and
  CHARTS_AB remain provisional.

## What this closes

**Price-derived and publicly-visible-flow inputs are closed at decile resolution
as well as at fixed edges.** The one cell that cleared the bar in 237 is
two-thirds drawdown, fails the monotonicity requirement, and sits beside a
control that itself misses clearing by 30 effective observations.

The re-run was still worth its two minutes, for three results that are not the
headline:

1. **Most of the old DEAD verdicts were not earned.** They were UNPROVEN wearing
   a DEAD label, because the rig could not tell a measured null from an
   unmeasurable one. Only V2 is dead in all thirty cells.
2. **Effective n is one to two orders of magnitude below raw n on this data.**
   Cells of 13,500 observations carry 300–1,500 observations of evidence. Every
   future verdict in this project should be read against that, and the 5,000-bar
   floor in the earlier runs was measuring the wrong quantity.
3. **Deciles cannot resolve a capped series.** F1 is a spike at 0.010%, and
   re-bucketing pooled 37.9% of it into one cell.

The remaining untested class is still the collector's — open interest, taker
buy/sell, long/short ratio — and still needs roughly 12 months of accumulation.
The collector running is what buys that option.
