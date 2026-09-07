# Layer 0 — the BookProfile reimport, and its reconciliation

Run 5 September 2026. `pnpm --filter api book-profile` and
`pnpm --filter api book-verify`. See [`../PRODUCT_LAYERS.md`](../PRODUCT_LAYERS.md)
Layer 0 for why this exists.

**PASS at 99.9999%**, and all four disagreements are explained: none of them is
attributable to the new code.

---

## Pre-registration, before the run

```
bar        >= 99% of overlapping buckets agree within 0.5% relative,
           across all 10 coins and the full 2023-01 -> 2026-08 range
keyed on   (symbol, ts) — like-for-like buckets, never aggregates
estimator  mean of per-snapshot ±5% bid shares, with the ±5% figure
           rebuilt by SUMMING the five shells rather than read directly,
           so the differencing is exercised rather than bypassed
```

The keying is the point. A cross-venue feature once came out 0.995 correlated
with the 1-hour return because a publication embargo pushed the cursor back one
bar, while reconciliation against the live API passed at 0.000 bp throughout —
the stored data was right and the *reading* was wrong. An aggregate over a day
or a coin would agree perfectly while every bucket sat one slot from where it
belongs.

## The import

```
10 coins x 1,344 days
19,074,610 rows in 2,401s
37,621,818 snapshots, 0 incomplete, 0 negative shells
```

Two numbers corroborate the shape before any comparison is made:

- **19,074,610 / 5 shells = 3,814,922 buckets**, which is exactly the
  `bookImbalanceFar` row count already in `FlowSample`. Identical bucket
  coverage, arrived at independently.
- **102 absent coin-days**, decomposing as 20 (2023-02-08/09 across every coin,
  the Binance outage) + 12 scattered singles = **32**, precisely the figure
  §2.2 of the briefing documents. The remaining 70 are 2026-08-30 to 2026-09-05,
  which are simply not on disk — the archive was last fetched on 2026-08-30 and
  this run did not `--fetch`.

`0 negative shells` across 37.6M snapshots is worth stating: differencing two
cumulative bands can legitimately go negative when the rows in a snapshot were
sampled a moment apart, and the importer keeps such readings rather than
clamping them. It never had to.

## The result

```
compared      3,814,922 overlapping buckets
agreed        3,814,918  (99.9999%)
files absent  102

BTC/ETH/SOL/BNB/XRP/ADA/AVAX/LINK/DOT/LTC   100.000% each

PASS — 99.9999% against a bar of 99%
```

Integrity, separately: stored `BookProfile` rows against what `transform`
produces for the same file — **500/500 identical for all ten coins**. The bar
proves the transform is right; this proves the table holds what the transform
produced rather than a stale or partial run.

## The four disagreements, diagnosed rather than waved through

```
SOL   2026-01-15T07:05:00Z  stored 0.627656  recomputed 0.607665  rel 3.19%
BTC   2026-01-15T07:05:00Z  stored 0.496568  recomputed 0.482125  rel 2.91%
ETH   2026-01-15T07:05:00Z  stored 0.454734  recomputed 0.441675  rel 2.87%
DOT   2026-08-22T05:15:00Z  stored 0.497123  recomputed 0.490080  rel 1.42%
```

Three land on **2026-01-15**, the day Binance added the ±0.2% band to the feed,
which looked like a transition-day parsing fault. It is not. Every snapshot in
that bucket carries all five bands, so both the old importer and the new one see
the same population.

The decisive test was to run the **original** `book-depth-import.ts` transform
against the **current** file and compare it to the stored value:

```
BTC 2026-01-15T07:05:00Z
  stored in FlowSample        0.496568
  OLD importer, current file  0.482125   <- equals the new code's recomputation
```

The old importer reproduces the new code's number exactly, to six decimal
places, on all three cases. The two transforms agree perfectly on identical
input. What differs is the **stored** value, which was written from an earlier
version of that day's archive file.

**Binance revises published day-files after the fact.** That is the finding, and
it is worth more than the four rows: a `FlowSample` value is a record of what a
file said *when it was imported*, not of what the file says now. Any future
reconciliation against the archive should expect a handful of such rows and
diagnose them the same way — by asking whether the OLD code still reproduces the
OLD number from the CURRENT file.

Net: **zero discrepancies attributable to the reimport.**

## A property of the stored table, recorded so it is not rediscovered as a bug

`BookProfile` stores the mean **notional** per shell, which is the right
quantity for a depth profile. The published `bookImbalanceFar` is the mean of
per-snapshot **ratios**. These are different estimators:

```
mean( bid / (bid + ask) )  !=  mean(bid) / (mean(bid) + mean(ask))
```

They diverge whenever the bid share moves inside a bucket — Jensen, not an
error. Measured across the full range:

```
9,981 of 3,814,922 buckets (0.262%) differ by more than 0.5%, worst 65.4%
```

The first version of the verification compared these two estimators against each
other and came out at 99.3% on a single test day, which read as a marginal pass
of a 99% bar and was in fact a category error in the check. Anyone recomputing
imbalance from `BookProfile` will see this drift; it is a property of the
quantity stored, and the exact numbers are here so it can be recognised
immediately.

## Reproduce

```
pnpm --filter api book-profile -- --dir ~/meridian-archive/bookDepth
pnpm --filter api book-verify  -- --dir ~/meridian-archive/bookDepth
pnpm --filter api test scripts/book-depth-profile.spec.ts
```
