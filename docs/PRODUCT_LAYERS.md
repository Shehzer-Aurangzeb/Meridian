# Meridian — the product layers

Written 5 September 2026, the day after the twentieth pre-registered test.
Companion to [`END_STATE_A_DESIGN.md`](END_STATE_A_DESIGN.md), which says what
the product *is*; this document says what order it gets built in and how each
stage proves itself before the next one starts.

---

## The rule this document exists to enforce

**No layer begins until the layer below it has passed its falsification bar,
and every bar is written down before the run that tests it.**

That is not process for its own sake. The project's entire evidence base — 20
tests, ~550,000 observations, a 320,000-row panel — was produced by stating a
bar first and reporting against it after, and the defects that were caught
(a random control drawn from the wrong population, an interval on a difference
computed as two intervals subtracted, a units bug that compared "3 touches" to
a 1–5 score in production) were caught *because* the bar existed beforehand.
The one thing that must not happen now is that a pivot away from prediction
becomes a pivot away from measurement.

### What each layer costs if it fails

Worth knowing before starting, because the layers are not equally survivable.

| layer | if its bar fails | survivable? |
|---|---|---|
| 0 — data foundation | the import is wrong; fix it and re-run | yes, it is a bug |
| 1 — core engine | the only proven skill does not reproduce; **the product has no content** | **no** |
| 2 — calibration | outputs stay descriptive, no probabilities published anywhere | partly — a weaker product |
| 3 — liquidity | depth becomes a display feature, not an input | yes, by design |
| 4 — API and presentation | iterate on the surface | yes |

Layer 1 is the one that can kill this. Everything else is recoverable.

---

## Layer 0 — the data foundation

> **STATUS: PASSED, 5 September 2026.** 19,074,610 `BookProfile` rows across 10
> coins and 1,344 days; reconciliation **99.9999%** on 3,814,922 buckets against
> a 99% bar, with all four disagreements traced to archive files Binance revised
> after the original import rather than to the new code. Result and diagnosis in
> [`evidence/LAYER0_BOOK_PROFILE.md`](evidence/LAYER0_BOOK_PROFILE.md).
>
> The code purge (§0.3 below) was **deliberately deferred to Layer 1**. Its blast
> radius is 26 non-spec files in `src/` plus 9 in `apps/web/` — `plans` and
> `checklists` are fields on `AnalysisRecord`, and `OutcomeScorerService` is built
> on `scorePlans`/`leadPlan`, which is the service Layer 2 repurposes. Deleting
> it here would gut that service before its replacement exists. The plan
> machinery now dies in the same edit that adds what replaces it.
>
> The forward test was ended deliberately: 843 `CoordinatorRun` rows
> (2026-08-09 → 2026-09-06, all scored) were dumped from Neon to
> `~/meridian-archive/coordinator-run-20260905.sql`, and the EventBridge analysis
> rule was removed from the CDK stack. **That removal takes effect on deploy** —
> the rule keeps firing at 00/08/16 UTC until this merges to `main`.

### Goal

One trustworthy substrate, and a `src/` that contains nothing the new product
will not use. Two jobs: **recover the order-book shape that the current import
throws away**, and **purge the directional machinery** so that no later layer
can quietly depend on it.

### Inputs

| source | detail |
|---|---|
| `~/meridian-archive/bookDepth/` | 13,338 day-files, **5.6 GB**, zipped CSV, 2023-01-01 →, 10 coins. **Outside the repo.** |
| `test/manual/results/panel.csv` | 320,000 rows × 78 columns, 32,000 hours × 10 coins, 170 MB |
| `FlowSample` (local `meridian_db`) | 29.4M rows, collector switched off 5 Sept 2026 |
| 1-minute klines on disk | 677 MB, 2023-01 →, used for outcome resolution later |
| `apps/api/scripts/book-depth-import.ts` | the existing importer — its fetch, checksum and unzip are reused; only `transform()` changes |

### The blocker, stated plainly

The 3.8M `bookDepth` rows in `FlowSample` **cannot produce a liquidity map, and
no amount of querying will change that.** The raw archive publishes *cumulative*
resting notional at ±1, ±2, ±3, ±4 and ±5% of mid every ~30 seconds (and ±0.2%
from 2026-01-15). `book-depth-import.ts` keeps the ±0.2% and ±5% bands only and
collapses them into three scalars — `bookImbalanceNear`, `bookImbalanceFar`,
`bookDepthNotional`.

That was the right call for the study it fed: the bands are cumulative and
therefore heavily correlated, and every extra feature raises the bar its
survivors must clear. It is the wrong shape for a depth profile. The structure
was discarded deliberately and has to be re-derived from the files.

**Nothing in Layer 3 can start until this is done, which is why it sits in
Layer 0 rather than beside the liquidity work it serves.**

### Outputs

**1. `BookProfile` — the reimport.**

```prisma
model BookProfile {
  symbol String
  ts     DateTime   // 5-minute bucket, stamped at bucket END
  shell  Int        // 1..5 = upper bound of the shell, in percent
  bidNotional Float
  askNotional Float
  @@id([symbol, ts, shell])
}
```

Five rows per bucket per coin. Shells are *incremental*, obtained by
differencing consecutive cumulative bands — the notional resting in (1%, 2%],
(2%, 3%] and so on — because that is what a depth profile is.

Two conventions inherited unchanged, both of which are load-bearing:

- **Stamped at the END of the bucket.** A bucket covering 00:00–00:05 is only
  complete at 00:05. Stamping it 00:00 makes it readable five minutes before it
  finished, which is precisely the look-ahead the archive importer already
  exists to remove.
- **Mean of ratios, not ratio of sums.** These are state snapshots, each an
  equally valid reading of how the book looked, so a bucket's value is the
  average reading. Summing notional and dividing once weights the bucket toward
  whichever moments the book happened to be deepest. The same choice on the
  taker ratio moves the number 13.9% at the median.

**2. The feature set that survived, frozen and named.**

43 of 53 candidate columns pass Phase C's coverage (≥ 90%) and rank-persistence
(< 0.50) gates. The 10 rejected, and why, carried forward verbatim so nobody
re-adds them by accident:

```
atrPct                  persistence 0.68
qqeUp                   coverage 77%
openInterest            persistence 0.99
longShortRatio          persistence 0.59
topTraderAccountRatio   persistence 0.57
topTraderPositionRatio  persistence 0.68
bookImbalanceNear       coverage 17%   (band starts 2026-01-15)
bookImbalanceNear_z     coverage 17%
bookDepthNotional       persistence 0.97
oiShareBybit            persistence 0.80
```

**3. A purged `src/`.**

Currently ~8,013 non-spec lines across 13 directories. `risk-management`
(1,300 lines) and `lib/api/generated/schema.ts` were deleted on 5 Sept 2026.
Still to go:

| target | ~lines | why it goes |
|---|---|---|
| `analysis/services/trade-plan.service.ts` | 450 | entry ladders, stops, targets. −0.106R per resolved trade, and the ladder pathology is structural: all 3,630 losers fill every leg, only 67.3% of winners do. The product places no trades and plans none. |
| `analysis/services/checklist.service.ts` | 400 | an uncalibrated weighted score that carried the units bug. Individual conditions worth keeping return later as regime inputs with measured conditional frequencies. |
| `squeeze-breakout/` | 142 | folds into `market-regime` as the compression state; a module for one state is not worth its wiring |
| `CoordinatorRun.grossR / netR / targetsHit / entryFilledAt / outcomeDirection` | — | columns describing trades that will no longer exist. **Migration, not silent abandonment.** |
| the 1–5 `strength` score in `support-resistance.service.ts` | ~40 | the exact construct the product forbids; the swing detection and clustering around it stay |

**One decision this forces, and it should be made consciously rather than
discovered later:** deleting `trade-plan.service.ts` ends the live forward test.
`AnalyzeService` runs three times a day and `OutcomeScorerService` has been
marking its plans since 1 September. That record is now measuring a product
that has been cancelled. Ending it is defensible; ending it by accident is not.
Decide explicitly, and if the record is worth preserving, snapshot
`CoordinatorRun` before the migration.

### The falsification bar

Two checks, and both are reconciliations rather than discoveries — which is the
correct shape for a data layer, because a data layer that "finds" something has
usually broken something.

**Bar 0a — the reimport must reproduce what it replaces.**
`bookImbalanceFar` is recomputable from the new shells: the ±5% cumulative
figure is the sum of shells 1–5 per side, and its bid share must match the
`FlowSample` value already stored for the same (symbol, bucket).

> **Pass:** ≥ 99% of overlapping buckets agree within 0.5% relative, across all
> 10 coins and the full 2023-01 → 2026-08 range. Disagreement above that means
> the differencing, the bucketing or the stamping is wrong.

This is worth stating because it is the cheapest possible protection against
the class of defect that has cost this project the most: a publication-embargo
off-by-one made a cross-venue spread 0.995 correlated with the 1-hour return
while reconciliation against the live API passed at 0.000 bp — **the stored data
was right and the reading was wrong.** A reconciliation that only checks values
and never checks alignment would not have caught it, so the check is keyed on
(symbol, bucket) and compares like-for-like buckets, not aggregates.

**Bar 0b — the purge must change no measurement.**
After the deletions and the migration, re-running the magnitude gate must
reproduce today's ladder exactly:

```
threshold   trades   gross bp    realised |move|
    40 bp   10,827       0.74             79 bp
    80 bp    5,611       2.78             92 bp
   100 bp    2,460      -1.38             99 bp
```

> **Pass:** identical to the digit, and `pnpm --filter api test` green.
> Any drift means the purge touched something the measurement depended on.

Also required: **32 days have no bookDepth file at all** (2023-02-08/09 across
every coin — a Binance outage — plus scattered singles). The importer must
record these as *absent*, never as a quiet book with zero depth. A missing file
and an empty book are opposite readings and must not collapse into the same
row.

### Scope

**IN:** the `BookProfile` reimport and its reconciliation; the frozen feature
list; deletion of trade-plan, checklist and squeeze-breakout; the
`CoordinatorRun` migration; deletion of the 1–5 strength score; the forward-test
decision.

**OUT:** any new feature. Any model. Any probability. Any endpoint. Any
frontend change. Any re-enabling of the collector. Any reprocessing of
`aggTrades` (~440 GB, and partly duplicated by `takerBuySellRatio5m` anyway).
The historical shelf map — converting shells to absolute price buckets — is
**Layer 3**, not here; Layer 0 stores shells in percentage terms exactly as the
archive publishes them.

---

## Layer 1 — the core engine (the "when")

> **STATUS: PASSED, 6 September 2026**, through the production services rather
> than the research rig — `pnpm --filter api layer1-service-bars`.
> 1a and 1b clear at all three horizons (+14.2 / +25.6 / +38.1 bp over the
> within-hour shuffle); 1c clears at a 13h median after hysteresis.
> Result and diagnosis in [`evidence/LAYER1_BARS.md`](evidence/LAYER1_BARS.md).
>
> Shipped: `src/expected-move/` (cone, on **eight** indicator features — the
> other 35 were measured and add nothing), hysteresis + age in
> `src/market-regime/`, and `MarketState` on `AnalysisRecord`. Zone geometry
> needed no new service: `LevelMapService` already emits `ConfluenceZone` with
> the 1-5 strength score removed.

### Goal

Produce the market-state description as **raw numbers**: what regime, how long
it has lasted, how big the next move is likely to be. No probabilities yet — a
probability is a claim about frequency and has to be earned in Layer 2.

### Inputs

Layer 0's panel and feature list; `indicators` (RSI, ADX, %B, bandwidth, ATR,
QQE — 569 lines, kept as-is); `market-data` (506 lines, kept as-is); the swing
detection and clustering left in `support-resistance.service.ts`.

### Outputs

For each (coin, hour):

1. **Expected-move quantiles** — `p50`, `p80`, `p90` of |move| at 4h / 12h / 24h.
   Built the way the magnitude gate built them, because that is the construction
   with holdout evidence: a **per-coin 30-day trailing baseline** carrying the
   level, plus a **ridge tilt** on the 43 standardised features carrying the
   coin-specific part. The decomposition is not a detail — a purely
   cross-sectional design has zero-mean columns and no intercept, so it can only
   emit deviations around zero and its forecast never reaches an absolute
   threshold at all. Fitted that way the magnitude gate returned **zero trades**,
   which looked like a null result and was a mis-specified model.
2. **Regime label + age** — trending / ranging / compression, and how many hours
   it has held.
3. **Unscored zones** — geometry only: price band, type, contributing sources,
   distance from spot. No strength, no probability, no plan.

### The falsification bar

**Bar 1a — the magnitude model reproduces its skill on the holdout.**
Rank holdout rows by predicted |move| into quintiles and measure realised |move|.

> **Pass:** realised |move| rises monotonically across the five quintiles, and
> the top quintile exceeds the bottom by **≥ 20 bp**.
>
> Measured today, the ladder ran 79 → 85 → 92 → 99 → 108 bp across thresholds,
> so a 20 bp spread is the observed effect with room to shrink, not an
> aspiration.

**Bar 1b — the skill is coin-specific, not a volatile-hour effect.**
Permute the magnitude forecast among the coins present in each hour, leaving
everything else in place. The hour's volatility environment survives; only the
coin mapping dies.

> **Pass:** the real model's top-bucket realised |move| beats the shuffled
> model's by **≥ 8 bp**. Measured today: 99 bp against 85 bp, a 14 bp margin.
>
> **This bar is the one that matters.** Without it, "we predict big moves" means
> "we noticed the market is volatile today", which is true, free, and worth
> nothing.

**Bar 1c — regimes are states, not flicker.**
A regime whose label changes every few hours has no exit rate worth quoting.

> **Pass:** median regime duration **> 12 hours**, and the three regimes show
> materially different 24h exit rates. If the classifier flaps, it is a
> smoothing problem and must be fixed here, not papered over with a probability
> in Layer 2.

**Explicitly not a bar:** anything about direction, hit rate, or return. If a
number in this layer can be read as a directional call, it does not belong in
this layer.

### Scope

**IN:** the magnitude model promoted out of `test/manual/` into a service;
regime classification with age; zone geometry.

**OUT:** every probability (Layer 2). Zone strength (Layer 2). Liquidity
(Layer 3). Crowding (Layer 3). Any endpoint (Layer 4). Any narration.

---

## Layer 2 — calibration

> **STATUS: PARTIAL PASS, 6 September 2026** — the outcome the layer explicitly
> allowed for. `pnpm --filter api layer2-calibrate`; full result in
> [`evidence/LAYER2_CALIBRATION.md`](evidence/LAYER2_CALIBRATION.md).
>
> **Cone PASS** — coverage 51.4/80.4/90.7 at 4h, 50.0/81.5/91.9 at 24h, nine of
> nine inside a 3-point bar. It ships as a calibrated probability.
>
> **Zone bounce FAIL** — ECE 1.13 (honest) but Brier *worse* than the base rate.
> All twelve bucket keys predict between 73.0% and 76.7%: a 3.7-point spread
> against a 75.8% base rate. Zone type, confluence count and regime carry
> nothing. Zones ship as geometry with no probability attached.
>
> **Regime exit FAIL** — ECE 5.06 against a bar of 5.00. It beats the base rate
> on Brier, so it is informative, but every TRENDING bucket under 48h drifted
> 5-11 points between train and holdout. Trends were less persistent in the
> holdout. The bar was not renegotiated after the fact; the open question is
> refit cadence.

### Goal

Turn Layer 1's raw numbers into statements that mean what they say. This is the
layer that makes the product honest, and it is the reason End State A is
reachable where End State B was not:

> **A calibration bar has no fee to clear.** Nineteen directional tests died on
> the same wall — real information, 1–5 bp of it, against a 14 bp round trip.
> "When you say 70%, be right 70% of the time" is a different property
> entirely, and one this data can support.

### Inputs

Layer 1 outputs replayed across history; 1-minute and 1-hour klines for
resolution; `OutcomeScorerService` (already replays bars and scores saved
statements — it is repointed at probabilities instead of R-multiples, not
rewritten); `test/manual/bootstrap.ts`.

### Outputs

**1. Frozen resolution rules**, in code, with constants named after their units,
**before any probability is published.** The units bug — thresholds named
"minimum 3 touches" compared against a 1–5 strength score, affecting ~14% of
levels in production — happened because a word was doing work a number should
have done. So:

```
touch     price trades within 0.15 * ATR(1h) of the zone centre
bounce    within 4h, price moves >= 0.5 * ATR(1h) AWAY from the zone,
          without first closing 0.5 * ATR(1h) THROUGH it
break     the inverse
neither   excluded from the denominator, and its share is PUBLISHED
```

The `neither` share is published because a rule that resolves 60% of the time
and hides the rest reports a number about a minority of cases while implying it
covers all of them.

**2. `CalibrationTable`** — predicted bucket → realised frequency, with counts,
intervals and the date of the fit. Computed offline, read at analysis time,
never computed live.

**3. Reliability curves** for every calibrated output.

### The falsification bar

Same harness throughout: purged folds, embargo, the last 182 days as a holdout
touched once, 30-day block bootstrap, and a shuffle control on every result.
Effective n remains one to two orders below raw n; nothing here is allowed to
quote a naive standard error.

| output | bar |
|---|---|
| expected-move cone | coverage within **3 points of nominal** at 50/80/90% on the holdout |
| zone bounce | **ECE < 5 points**, and Brier **beats the base-rate-only baseline** |
| regime exit | **ECE < 5 points** |

The Brier condition on zone bounce is the one that carries weight. A model that
only ever emits "7%, the base rate" is perfectly calibrated and completely
useless; beating the base rate is what separates informative from merely
honest.

> **If the cone passes and zone bounce fails:** ship the cone, publish no zone
> probabilities, and say so on the calibration page. A zone with no measured
> probability renders as geometry with `null`, which is exactly what the API
> contract in Layer 4 already specifies. **A partial pass is a legitimate
> outcome of this layer, not a failure to be worked around.**

### Scope

**IN:** resolution rules; the calibration job; reliability curves; Brier and
ECE; the `n < 200 → null` policy.

**OUT:** liquidity as a calibration input — the shelf hypothesis is Layer 3 and
must not be smuggled in here. Crowding. Any endpoint. Any narration.

---

## Layer 3 — the liquidity and crowding mapper

> **STATUS: BOTH BARS FAILED, 6 September 2026 — the survivable outcome this
> layer was designed for.** Full result in
> [`evidence/LAYER3_LIQUIDITY.md`](evidence/LAYER3_LIQUIDITY.md).
>
> **3a FAIL** — shelf thickness does not predict whether a support zone holds.
> Top tercile 75.6% vs bottom 76.3%: a gap of **-0.75 points** against a bar of
> +8, interval [-7.93, 5.51]. The upper bound is below the bar, so an 8-point
> effect is excluded rather than merely unproven. Also structural: **75% of
> support zones sit further than 5% from spot**, where the archive publishes
> nothing.
>
> **3b FAIL** — conditional adverse rate 11.7% against an 11.1% base rate,
> interval [7.5%, 19.4%] containing the base rate. 103 matches over 6 blocks, so
> the sample condition passed and the lift simply is not there.
>
> Shipping as display only: depth percentiles, the shelf map, and a crowding
> score that carries the no-lift finding on every reading. Shelf thickness never
> becomes an input to zone probability.

### Goal

Describe where resting size sits and how stretched positioning is — and settle
the one genuinely new question this project has left.

### Inputs

`BookProfile` from Layer 0; `FlowSample` funding, premium and OI; Layer 2's
calibration harness.

### Outputs

1. **Depth profile** — resting notional per shell, each with its percentile
   against that coin's own trailing 90 days. Thin and thick are relative to the
   coin, never absolute dollars.
2. **Historical shelf map** — shells converted to absolute prices using the mid
   at each snapshot, accumulated into price buckets. Answers "how much resting
   size has historically sat at $61,200", which the rolling percentage view
   structurally cannot.
3. **Crowding score** — percentile composite of funding, OI change and
   top-trader positioning. A description of how stretched positioning is, never
   a contrarian signal: Phase B priced the contrarian version at 1.83 bp against
   a 14 bp fee.
4. **Unwind sensitivity** — the observed conditional frequency of a ≥5% adverse
   move within 24h, always beside its unconditional base rate.

### The falsification bar

**Bar 3a — the shelf study. Run this first, before any Layer 3 product code.**

> Does a support zone with a thick resting bid shelf behind it bounce more often
> than one without?
>
> **Pre-registered:** a **≥ 8 percentage point** difference in bounce rate
> between the top and bottom terciles of shelf thickness, surviving a 30-day
> block bootstrap on the holdout, with a shuffle control.
>
> **If it fails:** the liquidity map is a display feature and never becomes an
> input to zone probability. §1.3 of the design shrinks to a chart. That is a
> real and acceptable outcome — the depth percentiles are still *facts about the
> book* and need no calibration to be worth showing.

This question has never been asked here, is answerable entirely from data
already on disk, and is a question about conditional frequency rather than
return — which is what makes it askable at all.

**Bar 3b — unwind lift is real.**

> The conditional ≥5% adverse rate must exceed the base rate by an interval that
> **excludes zero** under a 30-day block bootstrap, with **≥ 100 matches spread
> over ≥ 4 distinct blocks**.

The block condition is not decoration. In today's magnitude gate, 17 trades
landing inside a single 30-day block produced a bootstrap interval of
`[2.62, 2.62]` — zero width, resampling one month against itself, and it looked
exactly like certainty.

### The permanent limits, restated so no later layer forgets them

- **±5% of mid is the entire published range.** Nothing about a 10% move is
  answerable from this archive. The API must refuse such a query rather than
  extrapolate one.
- **No liquidation feed exists** — Binance removed the free endpoint. The system
  never asserts a cascade *will* happen. It reports what was observed: on
  occasions matching this state, OI fell a median X%, which is the footprint of
  forced deleveraging after the fact.
- **`bookImbalanceNear` has ~7 months of history.** Live reading: fine.
  Multi-year base rate: disqualified.

### Scope

**IN:** the shelf study; depth percentiles; the shelf map; crowding composite;
unwind sensitivity.

**OUT:** any claim about liquidation cascades. Any use of the ±0.2% band in a
multi-year base rate. Any endpoint. Any extrapolation beyond ±5%.

---

## Layer 4 — the API and presentation

> **STATUS: 4b PASS, 4c PASS, 4d FAIL (upstream), 4a NOT RUN — 6 September 2026.**
> Full result in [`evidence/LAYER4_SURFACE.md`](evidence/LAYER4_SURFACE.md).
>
> **4b PASS** — 22 contract assertions in the normal suite: `n < 200` returns
> null, every probability carries its `n`, beyond ±5% is a 400 and not a clamp,
> and the conditional endpoint warns on clustered evidence.
>
> **4c PASS** — enforced twice. The prompt forbids directional language;
> `assertNoDirection` discards prose that states one anyway. 19 tests, of which
> 12 assert it does NOT fire on correct writing.
>
> **4d FAIL** — assembly p50 ~400ms, but the p95 is time inside a Binance
> retry after a tight loop provoked rate limiting. Recorded as failed rather
> than renegotiated. The bar earned its keep: it caught `forUniverse` fetching
> ten coins sequentially, now parallel.
>
> **4a NOT RUN** — the misreading test needs a human subject and cannot be
> self-certified. An automated proxy reported as a pass would be precisely the
> kind of authoritative-looking wrong number this product exists to avoid.

### Goal

Deliver the weather report in one request, and make it structurally hard to
misread as a trade idea.

### Inputs

Layers 1–3 outputs; `CalibrationTable`; the existing Next.js dashboard and
`ai` narration service (635 lines).

### Outputs

```
GET  /map/:symbol                 everything for one coin, one call
GET  /map/:symbol/zones
GET  /map/:symbol/liquidity
GET  /map/:symbol/regime
GET  /map/:symbol/crowding
POST /map/:symbol/condition       historical analogues, not simulation
GET  /calibration                 reliability curves for every output
GET  /calibration/:output
```

One aggregate endpoint because the Lambda has a **120 s timeout** and ten round
trips to build one screen is how a cold start becomes a failure.

Response shape is specified in [`END_STATE_A_DESIGN.md`](END_STATE_A_DESIGN.md)
§4.1. Two properties of it are contractual rather than cosmetic: **`bounce` is
`null` when analogues are thin**, and **every probability carries its `n`**. A
client cannot render a confident number the backend does not have.

### The falsification bar

A presentation layer resists statistical falsification, so its bars are
behavioural and structural instead.

**Bar 4a — the misreading test.** Show the screen to someone who has not read
this document and ask what it tells them. If they state a direction, a target
or an entry, **the layer has failed** and the design is at fault, not the
reader. The design's own standard: *if a screenshot could be mistaken for a
trade idea, the design has failed.*

**Bar 4b — contract tests.** `n < 200` returns `null`; every probability field
carries `n`; a query beyond ±5% returns an error rather than an extrapolation;
the conditional endpoint sets `warning` when matches span fewer than 4 blocks.

**Bar 4c — the narrator states no direction.** The prompt keeps its audience
constraint — **a non-trader reading in a second language** — and gains an
explicit negative instruction. A test asserts no directional verbs appear in
generated output. The narration must not reintroduce in prose the call the
numbers refuse to make.

**Bar 4d — latency.** `GET /map/:symbol` p95 well inside the 120 s ceiling on a
warm Lambda.

### Scope

**IN:** the endpoints; the map screen; the regime strip; the crowding panel;
the calibration page; state-change alerts.

**OUT:** any alert phrased as an action. Anything resembling a trade plan.
`strategies` and `alerts` pages in their current form retire with the plans.

---

## The shape of the whole thing

```
Layer 4   API, map screen, calibration page, state alerts
             ^ needs trustworthy probabilities
Layer 3   liquidity shells, shelf map, crowding, unwind
             ^ needs BookProfile + the calibration harness
Layer 2   resolution rules, CalibrationTable, reliability curves
             ^ needs raw outputs to calibrate
Layer 1   expected-move cone, regime + age, unscored zones
             ^ needs a clean panel and a purged src/
Layer 0   BookProfile reimport, frozen features, dead code purged
```

Layers 0 and 2 decide whether this is a product. Neither needs a line of
frontend, and neither needs the collector running.

---

## Next step

Layer 0. Copy the prompt below to start it.

```
Build Layer 0 of Meridian, per docs/PRODUCT_LAYERS.md. Read that document's
Layer 0 section first, plus docs/END_STATE_A_DESIGN.md §3.

Do these in order, and stop at any point where a check fails rather than
working around it.

## 0.1 — The BookProfile reimport

Write `apps/api/scripts/book-depth-profile.ts`. Reuse the fetch, checksum
verification and unzip from the existing `scripts/book-depth-import.ts` —
only the transform changes.

- Source: ~/meridian-archive/bookDepth/ (13,338 zipped day-files, 5.6 GB,
  10 coins, 2023-01-01 onward). Do not re-download what is already there.
- The archive publishes CUMULATIVE resting notional at +-1, +-2, +-3, +-4,
  +-5% of mid every ~30s, and +-0.2% only from 2026-01-15.
- Difference consecutive bands into incremental shells: (1%,2%], (2%,3%],
  (3%,4%], (4%,5%], plus shell 1 = the 1% band itself.
- Bucket to 5 minutes, STAMPED AT THE END of the bucket, and average the
  readings in the bucket (mean of ratios, not ratio of sums). Both
  conventions are inherited from the existing importer — read its comments
  before changing anything about timestamping.
- Write to a new Prisma model:

    model BookProfile {
      symbol String
      ts     DateTime
      shell  Int
      bidNotional Float
      askNotional Float
      @@id([symbol, ts, shell])
    }

- 32 days have no file at all (2023-02-08/09 across every coin, plus
  scattered singles). Record these as ABSENT. A missing file and an empty
  book must never produce the same row.

## 0.2 — Reconcile it (this is the falsification bar, do not skip)

Write a check that recomputes `bookImbalanceFar` from the new shells — the
+-5% cumulative figure is the sum of shells 1-5 per side, and the metric is
the bid share of that — and compares it to the value already stored in
FlowSample for the SAME (symbol, 5-minute bucket).

Bar: >= 99% of overlapping buckets agree within 0.5% relative, across all
10 coins and the full range. Compare like-for-like buckets keyed on
(symbol, ts) — never aggregates. A publication-embargo off-by-one once made
a cross-venue feature 0.995 correlated with the 1h return while a
value-only reconciliation passed at 0.000 bp, so alignment is the thing
being tested here, not just magnitude.

Report the pass rate and the worst offenders. If it fails, diagnose whether
it is the differencing, the bucketing or the stamping before changing code.

## 0.3 — Purge the directional machinery

Delete, and unwire from AnalyzeService's pipeline:
  - apps/api/src/analysis/services/trade-plan.service.ts
  - apps/api/src/analysis/services/checklist.service.ts
  - apps/api/src/squeeze-breakout/  (fold compression into market-regime)
  - the 1-5 `strength` score in support-resistance.service.ts, keeping the
    swing detection and clustering around it

Write a Prisma migration dropping CoordinatorRun.grossR, netR, targetsHit,
entryFilledAt and outcomeDirection.

STOP AND ASK ME before running that migration. It ends the live forward
test that has been recording since 1 September, and I want to decide
deliberately whether to snapshot CoordinatorRun first.

## 0.4 — Prove the purge changed no measurement

Re-run `pnpm --filter api magnitude-gate` and confirm the ladder is
identical to the digit:

    threshold   trades   gross bp   realised |move|
        40 bp   10,827       0.74            79 bp
        80 bp    5,611       2.78            92 bp
       100 bp    2,460      -1.38            99 bp

Then run `pnpm --filter api test` and `npx tsc --noEmit` in apps/api.

Report: reconciliation pass rate, BookProfile row count and date range,
lines deleted, and whether the magnitude ladder reproduced exactly. Do not
start Layer 1.
```
