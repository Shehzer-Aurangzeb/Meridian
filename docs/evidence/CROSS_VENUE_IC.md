# Cross-venue dispersion — result

Run 4 September 2026, against the bars in
[`CROSS_VENUE_PREREG.md`](CROSS_VENUE_PREREG.md), which was written and
committed before the panel was rebuilt. Nothing below was chosen after seeing a
result.

**Real, and unpayable.** Nine of twenty tests clear the statistical and
persistence bars, at up to |t| = 9.77 — the second-largest t-stat this project
has measured. **None of them clears the money bar.** The best cell earns 5.59 bp
per trade with an interval of [1.40, 10.38] against a 4.79 bp target it has to
beat and a 14 bp fee it has to pay.

---

## What was collected

`pnpm --filter api venue-backfill`, into `FlowSample`, no schema change:

```
metric                rows     coins   window
bybitClose         322,100      10     2023-01-01 -> 2026-09-04
bybitOpenInterest  322,100      10     2023-01-01 -> 2026-09-04
okxClose           322,090      10     2023-01-01 -> 2026-09-04
bybitFundingRate    40,270      10     2023-01-01 -> 2026-09-04
```

1,005,804 rows in 1,609 s. What is *available* was probed, not read from docs:

```
             1h price     funding      open interest
  OKX        2023-01 ok   ~3 months    ~1 month
  Bybit      2023-01 ok   2023-01 ok   2023-01 ok
```

So OKX contributes price only. Its open-interest endpoint deserves the specific
warning: `begin` on its own is **ignored** and it returns the most recent rows
whatever window is asked for. Counting rows says "100 rows, works fine"; reading
the timestamps says all 100 are from today.

## Bars 1 and 2 — statistical, and not a coin label

Nine of twenty. Against **0.054 expected by chance**.

```
feature             H       IC       t  persist  bars 1+2
pxSpreadOkxBp      4h  +0.0239    9.77     0.09    YES
pxDispersionBp     4h  -0.0230   -9.02     0.13    YES
pxSpreadBybitBp    4h  +0.0212    8.46     0.05    YES
pxDispersionBp    12h  -0.0232   -6.37     0.13    YES
pxDispersionBp    72h  -0.0410   -5.65     0.13    YES
pxSpreadOkxBp     12h  +0.0183    5.61     0.09    YES
pxDispersionBp    24h  -0.0246   -5.15     0.13    YES
pxSpreadOkxBp     24h  +0.0184    4.48     0.09    YES
oiShareBybit       4h  -0.0133   -4.13     0.80    no
oiShareBybit      12h  -0.0209   -3.89     0.80    no
pxSpreadOkxBp     72h  +0.0240    3.85     0.09    YES
oiShareBybit      24h  -0.0238   -3.15     0.80    no
fundSpreadBybit   12h  +0.0072    1.66     0.08    no
```

The signs are coherent. A venue trading above Binance precedes a higher forward
return — Binance catches up. Wide dispersion across venues precedes a lower one.

**`oiShareBybit` reached |t| = 4.13 and was rejected by the persistence gate at
0.80.** Bybit's share of open interest in a given coin is a stable venue
preference, not a forecast: the ordering of the ten coins by it barely changes in
a month. This is the same trap that made raw `openInterest` score |t| = 10.05 in
Phase B, caught by the same gate, and it is the clearest evidence so far that
the gate earns its place.

**`fundSpreadBybit` is nothing at all** — every horizon under |t| = 1.7.

## Bar 3 — the money

Zero of nine. Long the top three coins by feature, short the bottom three, half
the capital on each leg, non-overlapping holds — the same book the 4.79 bp
target was measured on.

```
feature             H  trades  gross bp   95% interval     beats 4.79?
pxSpreadOkxBp      4h    8001      1.10   [  0.38,  1.82]      no
pxSpreadOkxBp     12h    2667      2.08   [  0.30,  4.00]      no
pxSpreadOkxBp     24h    1334      5.59   [  1.40, 10.38]      no
pxSpreadOkxBp     72h     445      2.80   [-11.79, 17.39]      no
pxSpreadBybitBp    4h    8001      1.30        —                no
pxDispersionBp     4h    8001      0.34        —                no
pxDispersionBp    12h    2667      1.56        —                no
pxDispersionBp    24h    1334      1.42        —                no
pxDispersionBp    72h     445     -0.57        —                no
```

One point estimate cleared. It does not survive its own interval — [1.40, 10.38]
contains 4.79 — and its neighbours across horizons are 1.10, 2.08, **5.59**,
2.80, which is a spike rather than a pattern. Its rank profile is flat from rank
2 to 9 with only the ends moving:

```
pxSpreadOkxBp @24h, mean forward return by rank, bp
  -2.6   2.9   5.1   3.7   3.8   4.5   2.7   2.3   3.9   6.1
```

This is the shape Phase C's conviction sweep produced at [-1.40, 42.28], and it
is why bar 3 was written before the run.

## Verdict

**Cross-venue dispersion is dead on this dataset**, by the pre-registered kill
clause. Price dislocation between venues is genuine information — |t| = 9.77
survived a bug that would have inflated it, a shuffle control, and the
persistence gate — and it is worth one to two basis points against a fourteen
basis point fee.

Nothing here justifies re-running Phases C or D. That needed two features
clearing all three bars, or one clearing with a spread above 14 bp.

Road 2 moves to Deribit implied volatility and skew, or stops.

---

## Two defects found before the verdict, and one after

**The spread was the one-hour return.** Caught by the coverage check, before
Phase B ran. Coverage read 100% on all five columns and looked fine; the numbers
underneath did not — a standard deviation of 81 bp where a venue spread on
liquid majors is single digits. So each column was compared against a quantity
it must not resemble:

```
corr(|pxSpreadOkxBp|, |1h return|) = 0.995
mean |1h return|      = 51.1 bp
mean |pxSpreadOkxBp|  = 51.3 bp
```

`FLOW_EMBARGO_MS` is five minutes and models Binance's publication delay on
`/futures/data/`. Venue rows are stamped at bar close, which **is** the decision
bar's `asOf`, so `ts + 5min <= asOf` was false and the cursor fell back an hour.
The panel compared Binance at T against OKX at T−1h and called the difference a
spread. A bar close carries no publication delay — it is known at the close,
which is the same instant the panel already reads Binance's own close at.

After the fix, median |pxSpreadOkxBp| is **3.09 bp** and the correlation with
|1h return| is **0.074**.

It would not have looked like a bug in a result table. It would have looked like
a strong, stable, brand-new signal.

**The reconciliation passed at 0.000 bp throughout**, which is the part worth
keeping: the stored data was always right. The defect was entirely in how the
panel read it, so a live-API check could not find it. Only comparing the feature
against something it should not resemble could.

**The Phase D targets were being tested as features.** Found after the first
cross-venue run. `NOT_A_FEATURE` excluded targets with `/^fwd\d+h$/`, which
matches `fwd4h` and misses `fwdVol4h` and `tb4h`, so the eight volatility-scaled
returns and barrier labels added for Phase D were measured as features.
`fwdVol4h` "predicted" `fwd4h` at |t| = 571.8 — a target predicting itself.

Scope, because it decides what can still be quoted: the original Phase B run of
192 tests predates those columns, so `PHASE_B_IC.md` is unaffected.
`phase_d.py` has always used prefix matching, so Phase D was never affected.
Only this run's summary line was wrong — 32 of 244 tests were leaked targets.
Per-feature results are computed independently, so **every cross-venue number
above is unchanged between the contaminated and clean runs**, which is what
confirms it. The clean run is 53 features, 212 tests, 0.57 expected by chance,
74 over the bar, 26 static tilts, 48 surviving.

## A correction to the staleness claim in the state document

`STATE_OF_MERIDIAN_2026-09-01.md` said each flow metric's median age is "exactly
half its own publication interval". That is right for the 5-minute and hourly
metrics and wrong for funding. Funding settles 8-hourly on the hour, so with the
5-minute embargo the age at a bar closing at hour H cycles

```
480, 60, 120, 180, 240, 300, 360, 420    as H mod 8 runs 0..7
```

the 480 being the settlement hour itself, correctly held back. The median of
that cycle is 270, not 240. Binance also stamps `fundingTime` about 29 ms off
the hour, so 35.7% of ages are not whole minutes. The cycle is now asserted
directly in `scripts/venue-check.py`, which is a stronger statement than any
median — it IS the embargo.
