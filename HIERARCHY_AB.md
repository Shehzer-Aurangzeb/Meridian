# Meridian — hierarchical timeframes: pre-registration

**Written 27 Aug 2026, before any code. Nothing in Part A is edited after
seeing a result.**

## Why this exists

Seven charts pooled measured worse than three charts pooled: edge over random
+0.064R → −0.066R, 2.6× the bar, wrong direction. The mechanism was measured,
not guessed — planned R fell 2.26 → 1.73 because more zones put the next zone
closer, so every target moved nearer while the stop stayed pinned at one
ATR(4h).

That is not a verdict on multi-timeframe analysis. It is a verdict on **pooling**
— treating a weekly swing high and a 15-minute swing high as two equal votes in
one price-proximity cluster.

They are not the same object. A weekly level is where positions were built and
defended over months. A 15-minute level is where price paused for an hour. No
trader would set a target at a 15m level while trading a 12h setup.

## Primary metric

**Edge over random.** One metric, and every verdict row below is written against
it. The last pre-registration named a primary and then wrote its verdicts
against a secondary; that drafting error is not repeated here.

| config | edge over random | planned R |
|---|---|---|
| 3 charts pooled | +0.064R | 2.26 |
| 7 charts pooled (current) | −0.066R | 1.73 |

## Verdict rows — decided now

| result on edge over random | verdict | action |
|---|---|---|
| ≥ +0.064R | BETTER | keep hierarchical, proceed to volume |
| +0.020R to +0.064R | NEUTRAL | keep hierarchical (structurally sound), proceed to volume |
| < +0.020R | WORSE | revert to 3 charts pooled, proceed to volume anyway |

**Volume comes next regardless.** This experiment decides which level engine to
build it on, not whether to continue.

## Secondary observations — recorded, not deciding

- **Planned R.** Must recover toward 2.2+. If it stays near 1.73, the HTF-target
  rule did not land and the result is uninterpretable — report that rather than
  the verdict.
- Weekly marks per map. Currently ~1 in 50. Should rise materially.
- Trade count, win rate, stopped-out share, bars held, cost per trade.

## Prediction, on record

Planned R recovers to 2.2+. Edge over random lands **NEUTRAL** — roughly the
three-chart number, not better. Better structure, same null.

Reasoning: this fixes how price shape is *organised*, not what class of
information it carries. Swing highs and lows are visible to everyone and have
tested empty four independent ways. A fairer representation of the method should
undo the pooling damage and stop there.

**If it comes back BETTER, be suspicious before being pleased.** Check that the
random control moved too — the control has swung more across revisions than the
strategy has, and it is the weakest instrument in the rig.

## Scope caveat

Three coins, one 80-day window, one seed. Enough to reject a change, not enough
to accept one. A BETTER verdict means "worth carrying forward", not "proven".

---

# Results — 27 Aug 2026

Window 2026-06-04 → 2026-08-23, 1,908 decision bars per coin, BTC/ETH/SOL,
seed 12345, cost 0.25%. Same command, coins, window and seed as the seven-chart
run.

```
npx ts-node --transpile-only test/manual/backtest-plans.ts --coins BTC,ETH,SOL --bars 2000 --random
```

| | 3 pooled | 7 pooled | **7 hierarchical** |
|---|---|---|---|
| **edge over random** (primary) | +0.064R | −0.066R | **−0.136R** |
| planned R (interpretability gate) | 2.26 | 1.73 | **2.21** |
| trades | 176 | 245 | 122 |
| net R / trade (marked) | −0.043 | −0.065 | −0.037 |
| net R / trade (resolved) | −0.124 | −0.099 | −0.205 |
| marking gap | 0.081 | 0.034 | 0.168 |
| win rate | 54% | 47% | 53% |
| gross R / trade | 0.107 | 0.057 | 0.033 |
| cost R / trade | 0.150 | 0.122 | 0.069 |
| risk % of entry | 1.54 | 1.76 | 2.67 |
| bars held | 21 | 16 | 35 |
| stopped out | 30% | 23% | 25% |
| open at end | 7% | 3% | **22%** |

## Verdict: WORSE — revert to 3 charts pooled, proceed to volume

Edge over random −0.136R, against a WORSE threshold of < +0.020R. Not close.
It is also worse than the pooled seven-chart run it was meant to repair.

**The result is interpretable.** Planned R recovered 1.73 → 2.21, clearing the
gate set in Part A. The HTF-target rule landed and did what it was designed to
do. The geometry was fixed and the edge still got worse, so this is a real
answer rather than a failed build.

## The prediction was half right, and the half it missed matters

Predicted: planned R recovers to 2.2+ (**correct**, 2.21), edge lands NEUTRAL
(**wrong**, it landed clearly worse).

Organising the same information better did not leave the result unchanged — it
made it worse. Three things moved together and all three point one way:

- **Stops nearly doubled**, risk 1.54% → 2.67%, because an HTF zone is now
  stopped on ATR(12h) rather than ATR(4h). Cost per trade in R fell 0.150 →
  0.069 as a direct consequence, which is a genuine saving.
- **Gross R collapsed anyway**, 0.107 → 0.033. The cost saving was more than
  spent. Whatever the wider stop bought in survival, it lost in reward.
- **Trades fell 176 → 122** while eligible plans fell much harder (6,495 →
  3,811). Restricting entries to HTF zones removed two thirds of the
  opportunity set and the third that survived was not better.

## Read this with heavy care — the control is weak here

**The random control is the shakiest instrument in the rig and this run shows
it.** It drew only 55 trades against the strategy's 122 despite being
matched-count by construction, because more of its sampled entries never
filled. Of those 55, **15 were still open** and its headline +0.099R leans on
random longs at +0.200R with 12 of 26 unresolved in a rising market.

So −0.136R is the difference between a well-resolved negative and a
poorly-resolved positive. The direction is not in doubt — resolved-only is
−0.205R for the strategy against +0.087R for the control, a wider gap, not a
narrower one — but the magnitude should not be quoted precisely.

**The open share tripled to 22%** and holds ran 35 bars against 21. Wider stops
take longer to resolve inside a 72-bar cap, so this arm is marked to market far
more than the others. That is why resolved-only (−0.205R) is so much worse than
marked (−0.037R): the gap of 0.168 is the largest of the three arms by double.

## B3 worked: the weekly chart now speaks

Marks per chart across the whole run, 340k marks:

| 1w | 1d | 12h | 4h | 1h | 30m | 15m |
|---|---|---|---|---|---|---|
| 14.6% | 9.6% | 12.4% | 14.9% | 16.3% | 16.2% | 16.1% |

The weekly went from about **one mark in fifty to one in seven**. The per-chart
ATR band did exactly what it was for. It did not help the result.

## Load-bearing checks — all pass, and none pass vacuously

Run over every plan the walk produced, not over fixtures:

```
PASS  entries at a non-HTF zone              0 / 9345
PASS  targets at a non-HTF zone              0 / 24452
PASS  stop ATR not the zone tier's           0 / 9345
PASS  targets matching no zone (vacuity)     0 / 24452
plans by zone tier: {"HTF":9345}
```

The fourth row exists because the second could have passed for the wrong
reason: if targets had stopped resolving to any zone, "0 non-HTF targets" would
be true and meaningless. 0 unmatched of 24,452 means every target really did
land on a zone edge, and every one of those zones was HTF.

## The golden set went red for a reason that is NOT the timeframes

35/35 trades became `NO_PLAN` and **nothing errored**. The frozen fixture
predates `tier`, so `zone.tier` was `undefined`, every zone failed the HTF
filter, and the run reported "no setups" instead of "this data is the wrong
shape".

Part B said to confirm the timeframes explained it before re-freezing. They did
not, so **it has not been re-freezed** — re-freezing would have written 35
NO_PLANs in as the new baseline and destroyed the only instrument that notices
scoring drift.

`buildPlans` now throws when every zone lacks a tier. This is the third silent
degradation-to-null found this session, after `TIMEFRAME_MS` missing 15m/30m
and `completedAsOf` returning zero candles on a NaN duration. The pattern is
the same each time and it is the exact failure mode this project has already
had to retract a result over.

---

# Appended 27 Aug 2026 — what the instrument can actually resolve

Nothing above is edited. This records what was learned about the harness AFTER
these numbers were produced, and it changes how they should be quoted.

**The harness measures correctly.** `backtest-plans.ts` had never had a positive
control. It has one now: the harness was copied to a scratch location with only
its import paths changed, and edges of known strength were planted into the
trade outcomes by exact quota. All four recovered to the digit — a strong plant
(+0.1977R planted, +0.1977R recovered), a weak one at the scale this project
argues about (+0.0395R planted, +0.0395R recovered), a plant present in the
trailing arm only (+0.1957R recovered on `C_trail_10` while `BASE_check` stayed
at exactly 0.0000R), and a negative plant (-0.1073R planted, -0.1073R
recovered). **Miss on every one: 0.00e+0R.** The harness does not attenuate,
lose, or invent an edge.

**But it cannot resolve differences of this size.** A 14-day block bootstrap —
the project's own `holdout.ts:blockBootstrap`, seed 12345, 2000 draws — puts a
**95% interval 0.318R wide** on edge over random for this window, straddling
zero. Six blocks over 80 days is a coarse resample base, and that is a limit of
the window rather than of the code.

**The delta this document rests on is 0.200R — inside that interval** (+0.064R
for three pooled against -0.136R here). The pre-registered rows at +0.064R and
+0.020R are further inside still.

**So this result is directional and unreplicated, not a measurement.** The
verdict stands — WORSE, revert — because a revert needs only a failure to clear
a bar, and this arm failed to clear it by a wide margin in the recorded
direction. But -0.136R must not be quoted as though it were resolved.

**Nearly all the uncertainty is in the control**, which the "read this with
heavy care" section above already argued from its trade count and can now be
given a number: the PLAN arm's own interval is 0.098R wide, the RANDOM arm's is
0.301R.

**The printed metric was MARKED, not resolved-only.** The pre-registration above
defines the primary metric as "resolved trades only", and this arm is where that
matters most: 22% open and a marking gap of 0.168R, double the other arms.
Fixed 27 Aug: the harness now prints both, always, from the same `aggregate`.
For this arm the resolved-only edge IS recoverable from the numbers recorded
above — -0.205R for the strategy against +0.087R for the control is **-0.292R**,
against the marked -0.136R. Resolved-only makes this arm look **worse**, not
better, so the WORSE verdict is reinforced rather than weakened.
