# End State A — a calibrated regime and liquidity mapper

Design, 5 September 2026. Nothing here is built yet.

This is the successor to the directional programme, written the day the
twentieth pre-registered test failed. It describes a system that **describes**
the market instead of forecasting it, and whose every published number is
checkable against what actually happened.

---

## 0. Why this shape, and why it can work when B did not

### What the magnitude gate just established

`docs/evidence/MAGNITUDE_GATE.md`, run today, tried the last cheap directional
idea: predict the size of the next 4-hour move and trade direction only when
the move is big. Two results came out of it, and End State A is built on both.

**The size model worked.** Realised |move| in the selected bucket rose
monotonically with the threshold — 79, 85, 92, 99, 108 bp — and the shuffle
control showed the selection is coin-specific, not a volatile-hour effect: at
the 100 bp threshold the real gate picked rows that went on to move 99 bp
against the shuffle's 85 bp. **This is the first thing in the project's history
to show real skill on a holdout it had not touched.**

**It bought no money.** Gross wandered between −1.4 and +2.8 bp as the book
shrank from 10,827 trades to 2,460, and the shuffled gate's gross (+1.71 bp)
beat the real one's (−1.38 bp). Knowing how far price will move says nothing
about which way.

That split is the whole thesis of End State A:

> **This data supports statements about magnitude, dispersion and state. It
> does not support statements about direction. Build only the first kind.**

### Why calibration is a reachable bar where edge was not

Every directional test failed on the same wall: information exists but is
smaller than the fee. Nine tests at |t| > 3 worth 1–2 bp against a 14 bp round
trip.

Calibration has no fee. The bar is not "beat the market", it is "when you say
70%, be right 70% of the time". A statement can be perfectly calibrated and
carry no tradeable edge at all — those are independent properties, and the
project has spent nineteen tests proving it has the second without the first.
The magnitude gate shows it has the raw material for the first.

The measurement discipline transfers unchanged: purged folds, an embargo, a
holdout touched once, block bootstraps, shuffle controls, and every claim
stated before the run. §5 of `BRIEFING_FOR_REVIEW.md` still governs.

### The three rules this system obeys

1. **No output is a return forecast.** No direction, no entry, no target, no
   stop, no "bias". A user cannot read a trade off this screen, and that is
   deliberate.
2. **Every probability is measured, never assigned.** "Strong support" is not a
   score of 4 out of 5. It is *"of the 1,847 times a zone looked like this,
   price bounced within 4 hours 71% of the time (95% CI [67%, 75%])"*. If a
   number cannot be backed by a count, it is not published.
3. **The reliability curve ships with the product.** Every calibrated output
   has a live page showing predicted probability against realised frequency.
   The system's own accuracy is a first-class feature, not an appendix.

---

## 1. What the system outputs

Four outputs. Each is a distribution or a probability, never a point forecast
of return.

### 1.1 Expected move cone

*"BTC over the next 4 hours: 50% chance of staying inside ±62 bp, 90% inside
±180 bp. That is the 78th percentile of its own last 90 days — unusually
wide."*

The direct descendant of the magnitude model, and the output with the most
evidence behind it. Per coin, per horizon (4h / 12h / 24h), the predicted
**distribution of |move|**, published as quantiles, not a mean.

- Backbone: the per-coin 30-day trailing baseline that carried the magnitude
  gate, plus the ridge tilt on the standardised features (which measurably
  added 14 bp of realised move at the 100 bp threshold).
- Published with its own percentile-of-history, because "is this wide or
  narrow *for this coin*" is the question a reader actually has.
- Calibrated as a quantile forecast: the 50% band must contain the outcome 50%
  of the time. See §2.2.

### 1.2 Regime classification with transition probabilities

*"SOL is in COMPRESSION (day 3). Historically 62% of compressions this old
resolve within 48h; when they resolve, the 24h move averages 3.1% — direction
was a coin flip (51/49)."*

The existing three-way regime (trending / ranging / squeeze) survives, but
stops being a label and becomes a **conditional distribution with an explicit
directional disclaimer**.

Every regime carries:
- `age` — how long the market has been in it
- `P(exit within 24h / 48h)`, calibrated against history
- the |move| distribution on resolution
- **the measured directional split on resolution, which will be near 50/50**,
  published *precisely because* it is near 50/50. Showing the coin flip is what
  stops a reader inventing a bias the data does not support.

### 1.3 Liquidity map

*"Resting bid notional between −2% and −3% is $47M, the 12th percentile of the
last 90 days. That shelf is unusually thin."*

Built from the `bookDepth` archive: cumulative resting notional at ±1, ±2, ±3,
±4, ±5% of mid, every 30 seconds, since 2023-01-01.

**This needs a new import.** The current one
(`scripts/book-depth-import.ts`) deliberately collapses ten bands into three
scalars — `bookImbalanceNear`, `bookImbalanceFar`, `bookDepthNotional` — because
it was feeding a cross-sectional feature study where correlated bands were a
liability. Those 3.8M `FlowSample` rows **cannot produce a heatmap**; the shape
was thrown away on purpose. The raw material is intact: **13,338 day-files,
5.6 GB, at `~/meridian-archive/bookDepth/`**.

Reprocessing keeps the band structure and differences consecutive bands into
*shells* — the incremental notional in (1%, 2%], (2%, 3%] and so on — which is
what a depth profile actually is. Two views:

- **Current profile** — resting notional per shell, each with its percentile
  against that coin's own trailing 90 days. Thin and thick are relative to the
  coin, never absolute dollars.
- **Historical shelf map** — each snapshot's shells converted to absolute
  prices using the mid at that instant, then accumulated into price buckets.
  This answers "how much resting size has historically sat at $61,200", which
  the rolling percentage view cannot.

Two limits stated up front, because both are permanent:

- **±5% is the whole world.** The archive publishes nothing beyond it. Any
  question about a 10% move is unanswerable from this data and the API must
  refuse it rather than extrapolate.
- **The ±0.2% band starts 2026-01-15.** Seven months against everyone else's
  3.6 years. It is reportable live and must be excluded from any calibration
  that claims a multi-year base rate.

### 1.4 Crowding and unwind risk

This is the output the brief's example asks for — *"funding is 0.1%, OI is
rising, price at the upper band; a 5% drop will trigger cascading
liquidations"* — and it is the one that needs its claim trimmed to fit the
data.

**Binance's liquidation feed is gone** (`BRIEFING_FOR_REVIEW.md` §2.2, the free
endpoint was removed). There is no liquidation series to calibrate against, so
the system must never assert that a cascade will happen. It would be an
uncheckable claim, which rule 2 forbids.

What *is* measurable, from data already held: **open interest is the footprint
of forced deleveraging.** When leveraged longs are liquidated, OI falls. So the
honest output conditions on the crowding state and reports outcomes that were
actually observed:

*"Funding 0.09% (94th percentile), OI +12% over 24h, price at the upper band.
This state occurred 214 times since 2023. Within 24 hours: a 5% adverse move
followed 18% of the time against a 7% base rate, and on those occasions open
interest fell a median 9.4% — the signature of forced unwinding. Direction was
not predictable; what changed was the size and the asymmetry of the tail."*

Every clause there is a count from history. Note what it does not say: it does
not say price will fall.

- **Crowding score** — a percentile composite of funding, OI change and
  top-trader positioning, framed as "how stretched is positioning" and never as
  a contrarian signal. Phase B priced the contrarian version of this at 1.83 bp
  against a 14 bp fee; it is a description, not a trade.
- **Unwind sensitivity** — the observed conditional frequency of a ≥5% adverse
  move within 24h, alongside the unconditional base rate, so the reader sees
  the lift rather than a scary number in isolation.

---

## 2. How each output is calibrated

### 2.1 The general method

Same harness for every output. The rig in `test/manual/` already does most of
this and is the project's main asset.

```
1. label       replay history, emit the statement the system WOULD have made
2. resolve     score it against what happened, on 1h bars
3. bucket      group by predicted probability (deciles)
4. compare     predicted vs realised frequency per bucket
5. interval    30-day block bootstrap on each bucket
6. holdout     the last 182 days, touched once
```

Three scores, reported together and never separately:

- **Reliability curve** — predicted against realised, with the diagonal drawn.
- **Brier score**, against the base-rate-only baseline. A model that only ever
  says "7%, the base rate" is perfectly calibrated and useless; beating the
  base rate on Brier is what separates informative from merely honest.
- **Expected calibration error** — the headline single number.

Rules carried over unchanged: block bootstrap because effective n is one to two
orders below raw n; purged folds with an embargo; a shuffle control on every
result; and, as always, the bar written down before the run.

### 2.2 Per output

| output | the statement | resolution rule | success bar |
|---|---|---|---|
| expected move cone | "50% inside ±62 bp over 4h" | did \|move\| land inside the band | coverage within 3 points of nominal at 50/80/90%, on holdout |
| zone strength | "bounced 71% within 4h" | touch, then reversal of ≥ 0.5 ATR without breaking through | ECE < 5 points, and Brier beats the base rate |
| regime exit | "62% resolve within 48h" | regime label changes | ECE < 5 points |
| unwind sensitivity | "18% chance of ≥5% adverse in 24h vs 7% base" | max adverse excursion on 1h bars | the lift must survive a block bootstrap |
| liquidity percentile | "12th percentile shelf" | none — it is a measurement, not a forecast | reproducible from the archive |

Note the last row. A percentile of observed depth is a **fact about the book**,
not a prediction, and it needs no calibration — only a correct computation and
an honest window. Not everything the system shows has to be probabilistic.

### 2.3 Defining "bounce", carefully, once

This is where the old system broke and it is the highest-risk definition in the
document. The checklist units bug — thresholds named "minimum 3 touches"
compared against a 1–5 strength score, affecting ~14% of levels in production —
happened because a word ("strength") was doing work a number should have done.

So the resolution rule is fixed in code, with the constants named after their
units, before any zone probability is published:

```
touch     price trades within 0.15 * ATR(1h) of the zone centre
bounce    within 4h of the touch, price moves >= 0.5 * ATR(1h) AWAY from the
          zone, without first closing 0.5 * ATR(1h) THROUGH it
break     the inverse
neither   excluded from the denominator, and its share is published
```

The `neither` share is published because a zone rule that resolves 40% of the
time and hides the rest is reporting a number about a minority of cases while
implying it covers all of them.

### 2.4 The features a zone probability is allowed to use

Only things measurable at the moment of the touch: touch count, age, timeframe
of origin, confluence source count, ATR-normalised width, distance travelled to
reach it, the regime, and the liquidity shelf sitting behind it.

The last one is the genuinely new input, and it is the most interesting
hypothesis in this document: **does a support zone with a thick resting bid
shelf behind it bounce more often than one without?** That question has never
been asked in this project, it is answerable from data already on disk, and —
critically — it is a question about *conditional frequency*, not about return.
It should be the first calibration study run.

Pre-registered, before the data is touched: bar is a ≥ 8 percentage point
difference in bounce rate between the top and bottom shelf-thickness terciles,
surviving a 30-day block bootstrap on the holdout. Anything less and the
liquidity map is a display feature, not an input to zone strength.

---

## 3. What changes in the codebase

Current state: 14,278 lines across 13 directories in `apps/api/src`,
`risk-management` already deleted today.

### 3.1 Keep as-is

| module | lines | why |
|---|---|---|
| `market-data` | 628 | Binance fetch and cache; the data layer is fine |
| `indicators` | 1,070 | RSI, ADX, %B, ATR, QQE — inputs to regime, all still needed |
| `prisma` | 34 | unchanged |
| `auth` | 260 | unchanged |
| `controllers` (health) | 124 | unchanged |
| `common` | 2,215 | guards, DTOs, replay engine — the replay engine becomes the calibration harness |
| `flow` | 751 | `FlowCollectorService` stays dormant; see §3.4 |

### 3.2 Rewrite

| module | lines | change |
|---|---|---|
| `analysis/services/support-resistance.service.ts` | ~900 | **Keep the geometry, delete the scoring.** Swing detection and clustering are sound and stay. The 1–5 `strength` score is deleted outright — it is the exact construct rule 2 forbids, and the source of the units bug. Levels come out unscored; probability is attached downstream from measured history. |
| `analysis/services/level-map.service.ts` | ~600 | Becomes `ZoneService`. Same confluence detection, but each zone is joined to a calibrated `P(bounce)` from a lookup built by the offline calibration job, with its sample count and interval. A zone with too few historical analogues reports `null`, not a guess. |
| `market-regime` | 218 | Gains age tracking and the transition-probability table. The classifier itself is unchanged. |
| `analysis-coordinator` | 3,761 | Loses the plan-building and checklist steps from the pipeline; gains the four outputs. `OutcomeScorerService` is repurposed almost intact — it already replays 1h bars and scores saved statements, which is precisely the calibration loop, just pointed at probabilities instead of R-multiples. |
| `ai` (narration) | 738 | Prompt rewritten for descriptive output. **Keep the audience constraint: a non-trader reading in a second language.** The narrator must not reintroduce a directional call in prose that the numbers refuse to make — an explicit negative instruction in the prompt, and a test asserting no directional verbs appear in output. |

### 3.3 Delete

| target | lines | why |
|---|---|---|
| `analysis/services/trade-plan.service.ts` | ~450 | Entry ladders, stops, targets. Measured at −0.106R per resolved trade, and the ladder pathology (all 3,630 losers fill every leg; only 67.3% of winners do) is structural, not fixable. End State A places no trades and plans none. |
| `analysis/services/checklist.service.ts` | ~400 | A weighted score of conditions that was never calibrated and carried the units bug. Any individual condition worth keeping becomes a regime input with a measured conditional frequency. |
| `squeeze-breakout` | 142 | Folds into `market-regime` as the compression state; a separate module for one state is not worth its wiring. |
| `CoordinatorRun` R-multiple columns | — | `grossR`, `netR`, `targetsHit`, `entryFilledAt`, `outcomeDirection` describe trades that will no longer exist. Migration, not silent abandonment. |

Rough net: **−1,400 lines deleted, ~800 rewritten, ~600 new** (the bookDepth
reimport and the calibration job). The system gets smaller.

### 3.4 New, and kept deliberately small

- **`scripts/book-depth-profile.ts`** — reimport of the archive preserving the
  band structure, into one new table. Reuses the existing script's fetch,
  checksum verification and unzip; only `transform()` changes.

  ```prisma
  model BookProfile {
    symbol String
    ts     DateTime   // 5-minute bucket, stamped at bucket END, as today
    shell  Int        // 1..5 = upper bound of the shell, in percent
    bidNotional Float
    askNotional Float
    @@id([symbol, ts, shell])
  }
  ```

  One table, five rows per bucket per coin. The stamping convention is
  inherited unchanged — a bucket stamped at its end, because stamping it at the
  start makes it readable before it finished, which is the look-ahead the
  archive importer already exists to avoid.

- **`CalibrationTable`** — the output of the offline job. Predicted-bucket →
  realised-frequency, with counts, intervals and the date the fit was made.
  Read at analysis time, never computed live. Small.

- **The collector stays off.** Nothing in this design needs it running. The
  liquidity map reads an archive that is already on disk and is republished
  daily to `data.binance.vision` if it ever needs extending; funding and
  premium have years of history available on demand. The one perishable series
  (`takerBuySellRatio1h`) is not an input to any output above. **Revisit only
  if a calibration study measurably needs live 1-hour taker data**, and say so
  in the study's pre-registration first.

---

## 4. API surface

Replaces `POST /analyses` as the primary path. `/analyses` and its history stay
for the existing forward-test record.

```
GET  /map/:symbol                 everything for one coin, one call
GET  /map/:symbol/zones           calibrated zones only
GET  /map/:symbol/liquidity       depth profile + shelf map
GET  /map/:symbol/regime          regime, age, transition probabilities
GET  /map/:symbol/crowding        positioning percentiles + unwind sensitivity
POST /map/:symbol/condition       the conditional question (§4.2)
GET  /calibration                 reliability curves for every output
GET  /calibration/:output         one curve, with counts and intervals
```

`GET /map/:symbol` is the one the dashboard calls. One request, one payload,
because the Lambda is 120 s and ten round trips to build one screen is how a
cold start becomes a timeout.

### 4.1 Response shape

```jsonc
{
  "symbol": "BTC",
  "asOf": "2026-09-05T16:00:00Z",
  "spot": 61432.10,

  "expectedMove": {
    "horizonHours": 4,
    "quantiles": { "p50": 0.0062, "p80": 0.0131, "p90": 0.0180 },
    "percentileOfOwnHistory": 78,        // wide for this coin
    "calibration": { "coverageP50": 0.49, "n": 4318 }
  },

  "regime": {
    "state": "COMPRESSION",
    "ageHours": 71,
    "exitProbability": { "within24h": 0.41, "within48h": 0.62, "n": 892 },
    "moveOnResolution": { "p50": 0.031, "p90": 0.078 },
    // Published because it is a coin flip. Removing it invites the reader
    // to assume a direction the data does not support.
    "directionOnResolution": { "up": 0.51, "down": 0.49, "n": 892 }
  },

  "zones": [
    {
      "low": 60800, "high": 61050, "center": 60925,
      "type": "support",
      "sources": ["12h swing x3", "0.618 Fib (12h)"],
      "distancePercent": -0.83,
      "bounce": {                         // null when analogues < 200
        "probability": 0.71,
        "horizonHours": 4,
        "ci95": [0.67, 0.75],
        "n": 1847,
        "unresolvedShare": 0.22           // the `neither` bucket, never hidden
      },
      "liquidityBehind": { "shellPercent": 2, "notional": 47.2e6, "percentile": 12 }
    }
  ],

  "liquidity": {
    "shells": [
      { "shell": 1, "bid": 21.4e6, "ask": 19.8e6, "bidPercentile": 34, "askPercentile": 41 },
      { "shell": 2, "bid": 47.2e6, "ask": 51.1e6, "bidPercentile": 12, "askPercentile": 55 }
    ],
    "imbalance": 0.47,
    "coverage": "+-5% of mid only",       // stated, not implied
    "nearBandAvailable": true             // the 0.2% band, 2026-01-15 onward
  },

  "crowding": {
    "fundingPercentile": 94,
    "oiChange24h": 0.12,
    "score": 0.81,
    "unwind": {
      "adverse5pctWithin24h": 0.18,
      "baseRate": 0.07,
      "medianOiDropOnAdverse": -0.094,
      "n": 214,
      "note": "Liquidation feed unavailable since 2024; OI change is the observable proxy."
    }
  }
}
```

Two shapes carry the honesty rules into the wire format itself: `bounce` is
`null` rather than a guess when the sample is thin, and every probability
carries `n`. A client cannot render a confident number the backend does not
have.

### 4.2 The conditional endpoint

`POST /map/:symbol/condition` answers the brief's example question by
**finding historical analogues, not by simulating**.

```jsonc
// request
{ "fundingPercentileMin": 90, "oiChange24hMin": 0.05, "percentBMin": 0.95,
  "horizonHours": 24 }

// response
{ "matches": 214, "firstMatch": "2023-02-11", "lastMatch": "2026-08-29",
  "outcomes": {
    "absMove": { "p50": 0.028, "p90": 0.071 },
    "adverse5pct": { "rate": 0.18, "baseRate": 0.07, "ci95": [0.13, 0.24] },
    "direction": { "up": 0.48, "down": 0.52 },      // still a coin flip
    "medianOiChange": -0.094
  },
  "warning": null   // set when matches < 100, or when matches cluster in
                    // fewer than 4 distinct 30-day blocks
}
```

That `warning` field is the magnitude gate's lesson encoded as a product
feature. Seventeen trades inside one 30-day block produced a zero-width
bootstrap interval that looked like certainty and was nothing of the kind. The
API refuses to let a caller make that mistake.

---

## 5. What the frontend shows

Sequenced last, after the backend and the calibration job are honest. Existing
Next.js dashboard; `strategies` and `alerts` pages retire with the trade plans.

### 5.1 Map (replaces the analysis page)

Price chart, and on it:

- **The expected-move cone** — shaded 50/80/90% bands projected forward. The
  cone is the visual thesis of the whole product: it widens and narrows, and it
  never points anywhere.
- **Zones as horizontal bands, opacity by calibrated probability.** A 71% zone
  is visibly stronger than a 54% one. Every band's label reads *"71% bounce ·
  n=1847"* — the count sits next to the number, always.
- **Liquidity shelves in the right margin**, a horizontal depth histogram
  aligned to the price axis, coloured by percentile against the coin's own
  history rather than by absolute size.

Deliberately absent: arrows, entry markers, target lines, anything with a
direction. If a screenshot of this page could be mistaken for a trade idea, the
design has failed.

### 5.2 Regime strip

A timeline of the last 90 days coloured by regime, with the current one's age
and its exit-probability curve. Answers "how unusual is right now" at a glance.

### 5.3 Crowding panel

Funding, OI and positioning as percentile gauges, plus the unwind sensitivity
sentence in plain language, with the base rate beside it — *"18% against a
usual 7%"* — because a probability without its base rate is a number designed
to be misread.

### 5.4 Calibration page — the one that makes the rest credible

Public, linked from every probability shown anywhere in the product. Reliability
curve per output, Brier against base rate, sample counts, and the date of the
last refit. When a curve drifts off the diagonal, the product says so on its own
front page.

This page is the reason to trust the others, and it is the page that would have
caught every defect in the project's history: the units bug, the mis-drawn
random control, the interval that was too wide to decide.

### 5.5 Alerts

Only state changes, never calls to action:

- regime changed
- expected-move cone entered the top/bottom decile of its own history
- a liquidity shelf crossed into the 10th percentile (unusually thin book)
- crowding percentile above 90 for 12 consecutive hours

*"BTC compression ended after 71h"* is the entire alert. What to do about it is
not the system's business.

---

## 6. Limits, stated before anyone builds this

- **±5% is the edge of the liquidity world.** Nothing about a 10% move is
  answerable from `bookDepth`. The API must return an error for such a query,
  not extrapolate one.
- **No liquidation data exists.** Cascades are described through their OI
  footprint after the fact, never predicted. Any future wording that promises
  otherwise is a regression.
- **`bookImbalanceNear` has seven months of history.** Fine for a live reading,
  disqualified from any multi-year base rate.
- **Calibration decays.** A 2023 base rate need not hold in 2026. Refit on a
  schedule, publish the fit date, and alert when the live curve drifts.
- **Ten coins.** Every base rate is a base rate for liquid majors, and the
  product should say so rather than implying generality.
- **Calibrated is not profitable, and the product must never blur the two.**
  A user who reads "71% bounce" as a trade will lose money to the same 14 bp
  that killed nineteen tests. The interface's job is to keep that distinction
  visible.

---

## 7. Build order

Each step is falsifiable, and each one is cheap enough to abandon.

1. **The shelf study** (§2.4) — does resting depth predict bounce frequency?
   Pure research, runs against data already on disk, needs no new code beyond
   the reimport. **If it fails, the liquidity map is a display feature and
   §1.3 shrinks to a chart.** Run this before writing any product code.
2. **The bookDepth reimport** — `BookProfile`, and the shelf study needs it
   anyway.
3. **The calibration harness** — repoint `OutcomeScorerService` at probability
   statements; produce the first reliability curve for zone bounce.
4. **Zone recalibration** — delete the 1–5 score, attach measured probabilities.
5. **Expected-move cone** — promote the magnitude model, the one component with
   holdout evidence already in hand.
6. **Regime transitions**, then **crowding**.
7. **API**, then **frontend**, then **alerts**.

Steps 1 and 3 are the ones that decide whether this is a real product. Neither
requires a single line of frontend, and neither requires the collector to be
running.
