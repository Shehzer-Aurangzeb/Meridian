# Layer 2 — calibration

Run 6 September 2026. `pnpm --filter api layer2-calibrate`; tables in
`src/calibration/tables.json`, coverage in
`test/manual/results/layer2-cone-coverage.csv`. Bars pre-registered in
[`../PRODUCT_LAYERS.md`](../PRODUCT_LAYERS.md) Layer 2.

**Cone PASS. Zone bounce FAIL. Regime exit FAIL.**

A partial pass was declared a legitimate outcome before the run, and this is
one. The expected-move cone ships as a calibrated probability. Nothing else
does.

---

## Bars, as declared

```
expected-move cone   coverage within 3 points of nominal at 50/80/90%
zone bounce          ECE < 5 points AND Brier beats the base-rate baseline
regime exit          ECE < 5 points
min sample           200 per bucket, else the table says null
```

Tables fitted on TRAIN rows only, scored on the last 182 days touched once,
intervals from a 30-day block bootstrap.

## The cone — PASS, and not marginally

```
      band   nominal   actual   off by        n
 4h   p50       50%     51.4%    1.4 pts   43,640
 4h   p80       80%     80.4%    0.4 pts   43,640
 4h   p90       90%     90.7%    0.7 pts   43,640
12h   p50       50%     50.6%    0.6 pts   43,560
12h   p80       80%     81.1%    1.1 pts   43,560
12h   p90       90%     91.1%    1.1 pts   43,560
24h   p50       50%     50.0%    0.0 pts   43,440
24h   p80       80%     81.5%    1.5 pts   43,440
24h   p90       90%     91.9%    1.9 pts   43,440
```

Nine of nine inside a 3-point bar, worst 1.9. **"There is a 90% chance BTC
stays inside ±180 bp over the next 4 hours" is now a statement Meridian can
make and defend.**

The bands run slightly wide — every deviation above 50% is positive, so the
cone is a touch conservative at the tails. That is the safer direction to err
and it is inside the bar, so it is reported rather than tuned away.

## Zone bounce — FAIL, and the reason is the interesting part

```
touches 55,294:  bounce 29,477   break 9,908   neither 15,749   ambiguous 160
UNRESOLVED SHARE 28.8%
train 33,356 resolved, holdout 6,029, base rate 75.8%

ECE   1.13 pts  (bar < 5)                              ok
Brier 0.18375 vs base-rate 0.18369                     FAIL
Brier advantage -5.854e-5, 95% block bootstrap [-4.294e-4, 3.570e-4], 7 blocks
```

ECE of 1.13 points is excellent. The forecast is **honest**. It is also
**useless**, and Brier is the condition that caught it:

```
predicted probability by bucket key
  resistance|src2|COMPRESSION        75.5%     support|src2|COMPRESSION      76.3%
  resistance|src2|MEAN_REVERSION     74.1%     support|src2|MEAN_REVERSION   74.2%
  resistance|src2|TRENDING           74.2%     support|src2|TRENDING         75.6%
  resistance|src3+|COMPRESSION       74.8%     support|src3+|COMPRESSION     74.7%
  resistance|src3+|MEAN_REVERSION    73.0%     support|src3+|MEAN_REVERSION  74.7%
  resistance|src3+|TRENDING          73.4%     support|src3+|TRENDING        76.7%

spread across all twelve keys: 3.7 points
```

Every bucket says "about 75%". Zone type, confluence count and regime carry
**nothing** about whether a zone holds — the model has learned the base rate
twelve times over. The whole holdout collapses into a single reliability bucket
(70-80%, n=6,029), which is what a model that never commits looks like.

This is precisely the failure mode the Brier condition exists to catch, written
down before the run: *a model that only ever emits the base rate is perfectly
calibrated and completely useless.*

Shuffle control, permuting outcomes across the training set:

```
real      Brier advantage -5.854e-5
shuffled  Brier advantage -3.456e-4
```

Both negative. The real bucketing is marginally less bad than a random one and
neither beats the base rate, which is the same answer twice.

**Consequence: no zone probability is published.** Zones ship as geometry — a
price band, a type, its contributing sources, its distance from spot — and the
calibration page says why there is no number attached.

This also independently reconfirms tests 1-3, which found zones, confluence and
level strength null against forward returns. Layer 2 asked a different question
— conditional frequency, not return — and got the same answer.

### One number worth keeping

The unconditional bounce rate is **75.8%**, over 39,385 resolved touches, with
**28.8% of touches unresolved** inside the 4-hour window. That is a real,
publishable fact about the market — price near a level usually wanders half an
ATR away before it closes half an ATR through. It just is not a *conditional*
fact, so it cannot be dressed as "this zone is strong".

## Regime exit — FAIL by 0.06 points, and it is drift

```
train 274,320 rows, holdout 43,440, base rate 57.8%
ECE   5.06 pts (bar < 5)                     FAIL
Brier 0.2416 vs base-rate 0.2440             beats base — it IS informative
```

Unlike zone bounce, this output knows something: it beats the base rate. It
misses on calibration, by six hundredths of a point, and the per-bucket table
says exactly why.

```
key                      train    holdout    drift
TRENDING|12-24h          46.3%     57.4%    +11.1 pts   n=4,537
TRENDING|24-48h          47.6%     57.7%    +10.0 pts   n=3,564
MEAN_REVERSION|48h+      54.0%     62.9%     +8.9 pts   n=1,035
TRENDING|48h+            51.6%     43.2%     -8.3 pts   n=2,086
TRENDING|0-6h            44.8%     51.5%     +6.7 pts   n=3,365
COMPRESSION|24-48h       80.7%     74.4%     -6.3 pts   n=1,144
MEAN_REVERSION|12-24h    57.4%     51.1%     -6.2 pts   n=4,312
```

**Trends were markedly less persistent in the holdout than in training.** Every
TRENDING bucket under 48 hours exited 5 to 11 points more often than the fitted
table expected. COMPRESSION drifted the other way, holding longer than fitted.

That is not a defect in the pipeline. It is the market changing character
between the training period and March-September 2026, and it is the exact risk
`PRODUCT_LAYERS.md` names under Limits: *"Calibration decays. A 2023 base rate
need not hold in 2026. Refit on a schedule, publish the fit date, and alert
when the live curve drifts."*

**The bar is not renegotiated after seeing the result.** 5.06 > 5.00 is a fail.
Regime exit probabilities are not published, and the open question — what refit
cadence would keep this inside the bar — is a decision to be made deliberately,
not a reason to move the line retroactively.

## What ships

| output | status | published as |
|---|---|---|
| expected-move cone | **PASS** | calibrated p50/p80/p90 at 4h/12h/24h |
| zone bounce | FAIL | geometry only — no probability, ever, until this passes |
| regime exit | FAIL | label and age only — no exit probability |

The `n < 200 → null` policy is in force: `fitTable` refuses to quote a bucket
thinner than 200, and `lookup` falls back to the base rate while telling the
caller that is what it got.

## Reproduce

```
pnpm --filter api layer2-calibrate
pnpm --filter api layer2-calibrate -- --shuffle
```

Zone replay rebuilds the map as it stood via `LevelMapService.buildFrom` with
candles sliced by `completedAsOf`, at the production 8-hour cadence, taking only
the FIRST touch of each zone per window — the same zone touched three times in
an afternoon is one fact about that zone, not three.
