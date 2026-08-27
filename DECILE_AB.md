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
