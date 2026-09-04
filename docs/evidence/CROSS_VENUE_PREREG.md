# Cross-venue dispersion — pre-registration

Written 4 September 2026, **before the panel was rebuilt and before Phase B was
re-run.** Nothing below was chosen after seeing a result.

## The question

Every one of the 160 columns in the Phase D panel is Binance-only. That set was
measured at roughly a third of a retail fee, with a gross that goes negative
over 3.1 years (`STAGE0_MAKER_FILL.md`). So the question is not whether a better
fit to the same data helps. It is whether a **different phenomenon** — the gaps
between venues trading the same contract — carries anything.

## What is being tested

Five features, added to the panel and nothing else changed:

```
pxSpreadOkxBp      (okx - binance) / binance, basis points
pxSpreadBybitBp    (bybit - binance) / binance, basis points
pxDispersionBp     sd across reporting venues, bp of the mean
fundSpreadBybit    bybit funding - binance funding
oiShareBybit       bybit notional OI / (binance + bybit)
```

Four horizons: 4h, 12h, 24h, 72h. **20 tests.**

Expected false passes at |t| > 3.0: **20 × 0.0027 = 0.054.**

## The bars, in order. All three must hold.

**1. Statistical.** |t| > 3.0 (Harvey/Liu/Zhu), Newey-West at lag = horizon,
AND the 30-day block bootstrap interval must agree in sign. A pass supported by
only one of the two is reported as such and does not count.

**2. It must be timing, not a coin label.** 30-day rank persistence below 0.50.
This is the gate that killed raw `openInterest` at |t| = 10.05 in Phase B, and
these features are built in basis points and ratios specifically so a coin's
price level cannot become the signal.

**3. It must be about the size of the move, not just its rank.** A monotone-ish
mean-forward-return profile across the ten cross-sectional ranks, and a
top-3/bottom-3 long-short spread that **beats 4.79 bp per trade** — the best
single Binance feature (`bookImbalanceFar` @72h).

Bar 3 exists because Phase B's largest t-stat, `sup_1h_distPct` at 6.43, had a
completely flat return profile and a spread of −0.02 bp, and because `percentB`
and `pdi` both had significant ICs pointing the OPPOSITE way to the money. A
t-stat alone has already fooled this project twice.

## The kill

**If no feature clears all three bars, cross-venue dispersion is dead on this
dataset and road 2 moves to Deribit implied volatility or stops.**

A feature that clears bars 1 and 2 but fails bar 3 is recorded as "real and
unpayable", which is the same verdict the seven Binance families got, and does
not on its own justify a Phase C or D re-run.

## What would justify continuing

Two or more features clearing all three bars, or one clearing them with a spread
above 14 bp. Only then are Phases C and D re-run with the cross-venue columns
included.

## Controls that run regardless

- The shuffle control, permuting which coin got which forward return inside each
  hour.
- Coverage stated per feature before any verdict, because a feature present on
  40% of rows is not measured on 320,000 observations.
- Reconciliation of the stored venue series against a live fetch, so a wrong
  timestamp convention cannot be read as signal.
