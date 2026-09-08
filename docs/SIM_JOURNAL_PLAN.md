# Meridian — the simulated trade journal

Written 8 September 2026, the day after the frontend rewrite. Companion to
[`PRODUCT_LAYERS.md`](PRODUCT_LAYERS.md), which describes the market mapper this
sits on top of.

The mapper describes the market and refuses to state a direction, because twenty
pre-registered tests found nothing that predicts direction well enough to cover
a 14 bp round trip. This document plans something different: a **record** of
directional calls made by an outside analyst — Claude, given the map — scored
against real candles, with the reasoning that produced each call frozen beside
it.

It is a journal, not a signal generator. Nothing in it feeds the map.

---

## The rule this document enforces

Same rule as `PRODUCT_LAYERS.md`: **no phase begins until the phase below it has
passed its bar, and every bar is written before the run that tests it.**

The bars here are smaller than the research bars, because most phases are
plumbing rather than measurement. Two are not: Phase 1 (does the scorer agree
with the harness) and Phase 6 (does the readout refuse to overclaim). Those two
are where this can go quietly wrong.

---

## What is being measured, and what is not

### Not measurable at this volume

**"Can Claude trade?" is out of reach and will stay out of reach.** The block
bootstrap in `backtest-plans.ts` put a 95% interval **0.318R wide** on edge over
random for a 3-coin, 80-day window — and **0.301R of that width was the random
control alone**. Net R against zero, at any volume a person can produce by hand,
lands inside that interval. A positive number after three months is not a
finding, and this journal must never present it as one.

### What the batch design does measure

Asking about **ten coins in one session and recording the passes as well as the
takes** changes the question. It becomes:

> Do the coins the analyst took beat the coins the analyst passed on, in the
> same session, in the same market?

That is a **paired** comparison, and the pairing removes the term that has
wrecked every pooled study in this project. Unconditional 48-hour forward drift
by year runs **+0.3156 / +0.1229 / −0.0197 / −0.1788** (2023/24/25/26),
monotonically declining, and it straddles every split boundary. Any unpaired
study of directional calls re-tests market direction whether it means to or not.
Within a session, both arms eat the same drift and it cancels.

The unit of evidence is therefore the **batch**, not the trade. Ten coins asked
at one moment are close to one observation, not ten — this is the same effective-n
problem that put 300–1,500 observations of real evidence inside cells holding
13,500 rows. Every readout in Phase 6 reports batch count beside n, and refuses
to draw an interval under four batches.

### The third thing, which is free

Each record freezes the map exactly as it was shown. That separates two failures
that are usually confused:

- the analyst **read the map wrong** (it said COMPRESSION at 40h; the call
  assumed a trend), versus
- the analyst **read it right and the trade still lost**.

Nobody normally has the data to tell those apart. This design has it by
construction, at the cost of one JSON column.

---

## Decisions taken before any code

Recorded here rather than discovered later.

| decision | value | why |
|---|---|---|
| Round-trip cost | **0.25%** | `DEFAULT_ROUND_TRIP_PCT`, measured at the venue in August 2026 — fee and real spread together. Keeps every number comparable to the 843-row archive. |
| Fill window | **24 hours** | `FILL_WINDOW_HOURS`. Same reason. |
| Max hold | **72 hours** | `MAX_HOLD_HOURS`. Same reason. |
| Scoring window | **96 hours** | Fill window plus hold. A row is scoreable 96h after it was logged. |
| Who scores | **Lazily, on read** | The EventBridge rule was removed on 7 September and is not coming back. A row past its window and still unscored gets scored when the history page loads. No schedule, no second deploy path, no infrastructure. |
| Risk per unit | **Derived, never entered** | `riskPerUnit = abs(entry − stop)`, `riskPercent = riskPerUnit / entry × 100`. Asking a person to type a number that is implied by two other numbers is how the two disagree. |

### The prompt, settled

The prompt sent to the analyst is deliberately short and carries **no** summary
of the twenty failed tests. That is a deliberate choice: the point is to see
what an analyst does with the map, not what it does when told the map's authors
believe direction is unpredictable.

**Variant A was chosen, 8 September 2026.** The prompt asks for a plan even on
the coins the analyst would pass on:

> For any coin you would skip, still give the plan you would have placed, and
> mark it SKIP.

Without that sentence a pass carries no entry, stop or target and cannot be
scored in R, which leaves the take-versus-pass delta resting on realised move
alone. One sentence roughly triples the power of the only comparison this
journal can make.

The frozen text lives in [`SIM_PROMPT.md`](SIM_PROMPT.md), which also records a
consequence that is not obvious: `MAP_DISCLAIMERS` states that twenty tests
found nothing predictive, so `disclaimers` is excluded from the pasted payload
while the stored snapshot keeps it. The snapshot is what the system held; the
paste is what the analyst saw. They differ by that one field, always.

---

## The shape of the thing

```
/map/:coin ──────────────────────────────────────────────┐
   chart, regime, cone, zones, depth                      │
   [Copy prompt]  →  paste to Claude, for 10 coins        │
   [Log answer]   →  entry / stop / targets / rationale   │
                                                          ▼
                                            one SimTrade row per coin
                                            sharing one batchId,
                                            each freezing its own map
                                                          │
                            96 hours later, on next read  │
                                                          ▼
/history ──────────────────────────────────────  scoreTrade() against real bars
   cards, grouped by batch                                │
   scoreboard: TAKE vs SKIP, paired                       │
                                                          │
/history/:id ─────────────────────────────────────────────┘
   the chart with entry, stop and targets drawn
   the outcome
   the analyst's own words
   the frozen map that produced it
```

## What already exists, and must not be rebuilt

| piece | where | state |
|---|---|---|
| `scoreTrade()` | `apps/api/src/common/replay/trade-scoring.ts` | **Alive and tested.** Survived the 7 September purge. Ladder fills, breakeven, trailing stops, cost in R. Takes hand-set numbers unchanged. |
| Candle proxy | `apps/web/app/api/candles/route.ts` | Alive. Hits Binance directly from Vercel, so the chart needs no backend work at all. |
| `useCandles`, `useLiveCandle`, `useLivePrices` | `apps/web/lib/hooks/` | Alive but currently unimported — they were left behind when the analysis pages went. Phase 3 gives them a caller again. |
| `lightweight-charts@5.2.0` | `apps/web/package.json` | Already a dependency. |
| The chart component | `git show a2056ff^:apps/web/components/features/analysis-detail/analysis-chart.tsx` | 434 lines, recoverable. Only its `TradePlan` type binding needs swapping. |
| History cards, scoreboard, filter bar, verdict card, bucket helpers | same commit | Recoverable. Built for this exact shape. |

**The rule for every restored file: recover it, then read it before adapting
it.** These were written against `AnalysisRecord`, which no longer exists.
A file that compiles after a find-and-replace is not the same as a file that is
correct.

---

## Phase 0 — the prompt, and the decisions above

> **STATUS: PASSED, 8 September 2026.** Variant A chosen. The prompt is frozen
> in [`SIM_PROMPT.md`](SIM_PROMPT.md) and `pnpm --filter api sim-batch` produces
> a pasteable batch today, before any of the record exists.
>
> Verified on a two-coin run: `disclaimers` absent from the payload, and the
> cone carries its cross-sectional tilt — BTC priced inside the universe gives a
> 4h p50 of 0.003566 against 0.003667 priced alone, so the two calls are
> demonstrably not the same computation. The frontend has been calling
> `/api/map/:coin` without a `universe` parameter and has therefore been serving
> the untilted baseline; Phase 3 fixes that on the screen.

**Goal.** Settle the open decision and write the prompt down where it cannot
drift between sessions.

**Scope.**
- `docs/SIM_PROMPT.md` — the exact text, and nothing else.
- `apps/api/scripts/sim-batch.ts`, wired as `pnpm --filter api sim-batch` —
  builds the batch in-process against `MapService`, so it needs no server and no
  token. Prints one pasteable block per coin plus a `batchId`.
- The `.gitignore` allowlist entries for both documents, since `docs/*` is
  deny-by-default.

**Bar.** None on the decision. Two checks on the script: `disclaimers` must be
absent from what it prints, and a coin priced inside the universe must differ
from the same coin priced alone — otherwise the tilt is not reaching the paste.

**Output.** A batch that can be collected by hand today. Worth doing first
precisely because the sample starts accumulating while Phase 1 is being built.

---

## Phase 1 — the record and the scorer

> **STATUS: PASSED, 8 September 2026.** `SimTrade` created by migration
> `20260908162407_add_sim_trade`, applied to **local only** — additive, one
> `CREATE TABLE` and three indexes, no existing column touched.
>
> Both bars pass, and both fixtures were shown to discriminate rather than
> assumed to. 23 sim tests, 456 in the whole suite, typecheck clean.
>
> Verified end to end against real Postgres and real Binance bars, not mocks: a
> BTC decision eight days old, entry 1% below the open, stop 3% below, one
> target 3% above. Scored `ALL_TARGETS`, gross **2.0000R**, net **1.8763R**,
> filled at bar 17, held 55. The arithmetic checks by hand — the target sits 4%
> above an entry with a 2% stop, so 2.0000R is exact, and `riskPercent` 2.0202
> gives a cost of 0.25/2.0202 = 0.1238. A second pass wrote nothing.

**Goal.** A hand-entered trade can be stored, and scored against real candles,
and the score agrees with the backtest harness.

**Scope.**

One table. Not two — a session has no attributes beyond a timestamp that every
row already carries, so `batchId` is a column rather than a join.

```prisma
model SimTrade {
  id      String @id @default(cuid())
  batchId String
  symbol  String

  /// TAKE or SKIP. A SKIP with a plan attached is Variant A; without, Variant B.
  verdict   String
  direction String?
  entry     Float?
  stop      Float?
  /// [{ price, weightPercent }], summing to 100.
  targets   Json?
  /// The analyst's own words. Never parsed, only displayed.
  rationale String?

  /// The map exactly as it was shown. Frozen on purpose: a foreign key would
  /// let this drift when the map code changes, and then it stops being evidence.
  mapSnapshot Json
  /// The price the decision was made against, kept out of the snapshot so it
  /// can be indexed and compared without parsing JSON.
  spotAtDecision Float
  /// True when the analyst said it fetched data beyond the snapshot. The
  /// snapshot is then what OUR system showed, not everything the analyst saw.
  usedOutsideData Boolean @default(false)

  createdAt DateTime @default(now())

  /// Written once, by the scorer, never on a read path.
  outcome    String?
  grossR     Float?
  netR       Float?
  targetsHit Int?
  barsHeld   Int?
  /// Null means "score me", including a row whose candles would not load, so a
  /// failed fetch is retried rather than frozen as a verdict.
  scoredAt   DateTime?

  @@index([batchId])
  @@index([symbol, createdAt])
}
```

A `SimTradeService` that:
- builds a `ScorablePlan` from the stored row — `averageEntry` from `entry`,
  empty `entries` (one step for the whole position), `riskPerUnit` and
  `riskPercent` derived, never stored twice;
- fetches the 96 hours of 1h bars after `createdAt`, **starting from the first
  bar after the decision bar** — `forward[0]` must not be the bar the decision
  was made on;
- calls `scoreTrade` and writes the result once.

**Bar.** Two fixtures, both of which must fail a broken implementation rather
than passing either way:

1. **The known off-by-one.** A bar that touches the entry and then runs through
   the stop *inside the same hour* must score `STOPPED`, not left open. This is
   a real bug that was found in `backtest-plans.ts` on 11 August 2026 — it
   resolved from `fillIdx + 1` and mis-scored 146 of 6,084 trades. The fixture
   must invert the answer if the wiring repeats it.
2. **Cost is charged against the stop, not the entry.** A plan with a 0.5% stop
   and a plan with a 2% stop must pay `0.25/0.5 = 0.5R` and `0.25/2 = 0.125R`
   respectively. A fixture that passes when cost is a flat constant proves
   nothing.

**If it fails.** It is a wiring bug, not a finding. Fix and re-run. Nothing
downstream can be trusted until both fixtures invert on a broken scorer.

---

## Phase 2 — the API

> **STATUS: PASSED, 8 September 2026.** Four routes, 28 contract tests, 484 in
> the whole suite, typecheck clean.
>
> Verified over real HTTP against real Postgres, not mocks. `GET /sim` without a
> token is 401. Three malformed calls were refused with the row named —
> `trades[0]: target weights sum to 140, not 100`. A two-coin batch posted,
> scored on the next read, and returned `ALL_TARGETS` at net **+1.8763R** for the
> take against `STOPPED` at **-1.1238R** for the pass. `/sim/stats` withheld the
> delta on one block and said why in plain English. `/sim/nope` is 404.
>
> `blockBootstrap`, `blockBootstrapDiff`, `makeRng`, `mean` and `quantile` were
> **moved** out of `test/manual/` into `src/common/stats/block-bootstrap.ts`
> rather than copied — a second copy is a second place for the bug to live, and
> that generator has already been wrong once. `test/manual/rng.ts` and
> `holdout.ts` are now re-export shims, so all thirteen research scripts that
> import by the old path keep working unchanged.

**Goal.** The record is reachable, and the endpoints promise only what Phase 1
can deliver.

**Scope.**
- `POST /sim` — one batch, an array of coins. Validates that targets sum to 100,
  that `stop` is on the correct side of `entry` for the stated direction, and
  that a `TAKE` carries a plan. Rejects rather than storing a row that can never
  be scored.
- `GET /sim` — the list, newest first, paged. Scores anything past its window
  before returning.
- `GET /sim/:id` — one row including its snapshot.
- `GET /sim/stats` — the scoreboard numbers, including the paired delta and the
  batch count.

**Bar.** Contract tests, in the manner of `map.contract.spec.ts` — each one
encoding a promise, each one corresponding to a way this project has previously
been wrong:

- A batch under four batches total returns its interval flagged, never bare.
- A `TAKE` without an entry is a 400, not a stored row that scores as `null`
  forever.
- Targets that do not sum to 100 are a 400. A plan that sells 140% of a position
  produces an R-multiple that looks like skill.
- An unscored row returns `outcome: null`, never `0`. Scoring a missing verdict
  as zero is what turned a −0.106R result into −0.202R in §14h.

**If it fails.** Plumbing. Fix and re-run.

---

## Phase 3 — capture

> **STATUS: PASSED, 8 September 2026.** The bar was ten coins logged end to end
> in under five minutes with no price retyped. Measured by driving the real
> browser against the real API: **ten readings loaded in 2.1s, ten calls filled
> in 2.2s, saved as one batch.** Zero console errors.
>
> Verified in the database afterwards: three TAKE and seven SKIP under one
> `batchId`; `entry`, `stop` and `spotAtDecision` correct per coin; `decidedAt`
> taken from each map's own `asOf` rather than the moment Save was pressed; and
> the stored `mapSnapshot` **keeps** `disclaimers` while the copied prompt drops
> them — the documented invariant, checked rather than assumed.
>
> The chart is restored as `components/features/map/price-chart.tsx`, rewritten
> to take a symbol, a spot, zones and optional levels instead of the deleted
> `AnalysisRecord`. Phase 5 passes it entry, stop and targets.
>
> ### Two real defects found and fixed
>
> **`AppShell` rendered `children` twice** — a desktop branch and a mobile
> branch, one hidden by CSS. Every page in the product was therefore mounted
> twice: two sets of hooks, two fetches, and two independent copies of any form
> state. `/log` showed twenty coin sections and ten duplicate map requests, and
> `/map` fetched every coin twice. A hidden chart also measures zero width,
> which is the exact failure its own comment warned about. This was
> pre-existing, not introduced here. Children now render once; measured
> afterwards at 1440px and 390px: ten sections, one map call, sidebar shown then
> hidden, no horizontal scroll at either width.
>
> **`/map` was calling `/api/map/:coin` with no `universe`**, so the screen had
> been serving the untilted baseline — the cone without the cross-sectional
> ridge tilt that beat its shuffle control by 14 to 38 bp. Flagged in Phase 0,
> fixed here. The batch loader moved to React Query so the ten readings are
> deduplicated and keyed by `(symbol, universe)`; the same coin priced alone is
> a different number and must not share a cache entry.

**Goal.** The chart is back, and a batch can be logged in one sitting without
retyping anything.

**Scope.**
- Restore the chart onto `/map/:coin`, above the existing panels. It draws only
  prices the map already computed, so the chart cannot disagree with the cards
  below it.
- **Copy prompt** — puts the prompt text plus this coin's map JSON on the
  clipboard. No API integration, no key management, no spend: the analyst is
  reached by paste.
- **Log answer** — a form taking direction, entry, stop, targets and the
  analyst's words. Pre-fills `symbol`, `spotAtDecision` and `mapSnapshot` from
  what is on screen. A batch stays open until ten coins are logged or it is
  closed by hand.

**Bar.** A batch of ten logged end to end, in under five minutes, without
copying a price by hand. If a number has to be retyped, the form is wrong —
retyped numbers are how the snapshot and the plan come to disagree.

---

## Phase 4 — history

> **STATUS: PASSED, 8 September 2026.** The bar was that a batch still inside
> its 96-hour window renders as pending — not as zeros, and not as an empty
> state that reads like a loss.
>
> Verified against seven seeded batches (70 calls, 41 finished, 29 running) in
> the real browser. The pending batch rendered ten cards, every one showing a
> dash rather than a number and the words "Still running · 95h to go"; a search
> for `+0.00` or `-0.00` across those cards found nothing. Zero console errors,
> and no horizontal scroll at 390px.
>
> Every filter tile agreed with the list beneath it — 19/19 made money, 11/11
> lost, 11/11 ran out of time, 0/0 never started, 29/29 still running. The
> scoreboard and the cards read the same rows through the same `bucketOf`, so
> they cannot disagree about a row the way a card and a separately-computed
> total once could.
>
> The scoreboard leads with the DIFFERENCE between the calls taken and the calls
> passed on, and prints the interval beside it rather than the point estimate
> alone: on the seeded data, **-0.51, anywhere from -1.63 to +0.59, over 5 time
> blocks**. It crosses zero, which is the correct reading of noise. Below four
> blocks no interval is drawn at all.
>
> ### Fixed along the way
>
> **Pages were doubling the shell's padding.** `AppShell` states that it owns
> page padding and that pages add none; `/map`, `/calibration` and `/log` each
> added `px-8 py-10` on top, which is the 80px gutter its own comment warns
> about. Removed from all three.
>
> **An expanded card stretched its neighbour** to match height in the two-column
> grid. `items-start` on the grid.
>
> The detail link on each card is deliberately absent until Phase 5 builds
> `/history/:id`. A link to a page that does not exist is the defect the
> frontend rewrite fixed on 7 September, and re-introducing it to look finished
> would be the same mistake.

**Goal.** The screens that were useful, back, reading the new record.

**Scope.** Restore and adapt: the cards, the scoreboard, the filter bar, the
bucket helpers. Group by batch, because the batch is the unit of evidence:

```
8 September · 10 coins · took 3, passed 7
```

**Bar.** A batch whose rows are all still inside their 96-hour window renders as
pending — not as zeros, not as an empty state that reads like a loss. The
distinction between "no verdict yet" and "a verdict of nothing" is exactly the
one that has been got wrong before.

---

## Phase 5 — the detail screen

> **STATUS: PASSED, 8 September 2026.** The bar was that a reading archived
> before a map change still renders what it actually held.
>
> Tested with two seeded records: one carrying a full, current snapshot, and one
> whose snapshot predates `sources`, `bounceWithin4h`, `regime`, `expectedMove`,
> `liquidity` and `disclaimers` entirely. The older record renders — it keeps its
> coin, its price and the one level it held — and it renders **nothing it did not
> hold**: no market-state panel, no cone, and none of today's disclaimers.
>
> `normaliseSnapshot` in `lib/snapshot.ts` is what makes that true, and the rule
> it follows is narrow on purpose: fill in the SHAPE the renderer needs, never
> the CONTENT. A reading that showed no disclaimers keeps showing none. Pasting
> in current copy would make the page a reconstruction rather than a record, and
> a record is the only thing this journal is for.
>
> Checked by `pnpm --filter web check`, which was pointing at a file deleted on
> 7 September and now runs `lib/snapshot.check.ts`. The fixture is proved to
> discriminate rather than assumed to: the same reads that pass after
> normalisation are asserted to THROW against the raw object.
>
> The chart draws the entry, stop and targets, anchored at the decision with a
> "decided" marker on the bar that contains it. Verified end to end in the
> browser: chart present, levels drawn, the cost sentence explaining the gap
> between gross -1.00 and net -1.12, the analyst's words, and the frozen map
> below. Zero console errors, no horizontal scroll at 390px.
>
> ### Three defects fixed
>
> **`use(params)` crashed the page** with React error #438. This is Next 14,
> where the params prop is a plain object and `use()` only accepts a promise.
> A client component reads the route with `useParams()`.
>
> **The topbar claimed every nested route was the map.** `PAGE_TITLES[pathname]`
> is an exact-match lookup, so `/history/<id>` fell through to a hardcoded
> "Market map" default. Now matched on the first segment, the way
> `isRouteEnabled` already did.
>
> **An archived zone read "found by 0 methods"** — a statement about the method
> rather than about the record. It now says how it was found was not recorded.

**Goal.** Answer, for any single trade, the question "which analysis led to
this?"

**Scope.** `/history/:id`, showing together:
- the chart, with entry, stop and targets drawn, anchored at the decision time
  rather than at now — the most recent 500 bars do not contain a trade from six
  weeks ago;
- the outcome;
- the analyst's own words, unparsed;
- the frozen map, rendered by the same `MapView` the live screen uses, so past
  and present look identical.

**Bar.** Open a trade from a batch logged before a map code change, and confirm
the snapshot still renders what was actually shown at the time. A snapshot that
re-renders through today's code is not a snapshot.

---

## Phase 6 — the readout

> **STATUS: PASSED, 8 September 2026.** Both bars pass, and the readout is
> verified by a positive control rather than by inspection:
> `pnpm --filter api sim-readout`.
>
> **Planted differences come back out.** +0.40 measured +0.4138, +0.15 measured
> +0.1229, -0.25 measured -0.2477, and a plant of exactly zero measured -0.0151
> with an interval crossing zero. A readout that cannot find an edge it was
> handed cannot be trusted to report one it was not.
>
> **Rows are not evidence; blocks are.** 200 finished calls inside a single
> fortnight draw no interval at all. Four blocks is enough; three is not. On
> screen this was confirmed with a seeded record of **80 calls across 8
> batches** — the two arms visibly 0.40 apart at +0.38 and -0.02 — where the
> difference card refuses to state a figure and says why.
>
> **The difference is resampled, not the arms.** Measured, not asserted: on the
> same data, the paired interval is **0.029** wide against **1.924** for two
> intervals subtracted — 66 times narrower. More importantly, subtracting gives
> `[-0.566, +1.358]`, which crosses zero and would report no difference, while
> the paired interval gives `[+0.381, +0.409]` and correctly contains the
> planted +0.40. Subtracting intervals would have hidden a real edge outright.
>
> **An unfinished call never reaches the total.** Adding 40 open calls moves
> neither arm by more than 1e-12 and lands them in `pending`; scoring the same
> rows at zero moves the taken arm from 0.7299 to 0.5474. That is the mechanism
> that turned -0.202R into -0.106R in section 14h, reproduced and then excluded.
>
> ### The screen
>
> The difference leads and is the only figure given room; the two arms sit below
> it as inputs, not as results. Under four blocks it shows a dash and the reason.
> A section titled "What this can and cannot show" states in plain words that the
> record cannot answer whether an analyst can trade — quoting the **0.318**
> margin of error, of which **0.301** was the random control alone — and that any
> figure a person can build by hand sits inside it. No jargon: no "bootstrap",
> no "confidence interval", no "p-value".
>
> ### Fixed
>
> **`MIN_BLOCKS` existed twice.** It was declared in `condition.service.ts` and
> re-declared in `sim.stats.ts`. Moved to `common/stats/block-bootstrap.ts`,
> beside the bootstrap it guards, and imported by both. Two copies of a
> threshold are two places for it to drift.

**Goal.** State what the record supports, and refuse to state more.

**Scope.** The paired comparison, with its guards:

```
6 batches · 60 coins · took 19, passed 41

TAKE   net R  +0.08
SKIP   net R  −0.11
delta         +0.19   [−0.14, +0.51]   6 batches
```

- The interval comes from a **block bootstrap over batches**, not over trades.
  Ten coins asked at one moment are one observation.
- Under four batches, no interval is drawn at all — the same `MIN_BLOCKS` guard
  that already exists in `condition.service.ts`, reused rather than re-derived.
- The delta is computed as one interval on the difference, **never as two
  intervals subtracted**. Subtracting intervals is a defect this project has
  already shipped once.
- The screen says in plain words that this measures selection within a session
  and not whether an analyst can trade, with the 0.318R figure and why.

**Bar.** Two planted fixtures:

1. A record with three batches must print the guard, not an interval. If it
   draws one anyway, the guard is decorative.
2. A record with a planted delta of a known size must recover it. Four plants
   were used this way on `backtest-plans.ts` and recovered to the digit; the
   same technique applies, and a readout that cannot recover a planted edge
   cannot be trusted to report a real one.

**If it fails.** This is the one phase where failure is not merely a bug. A
readout that overstates is worse than no readout, because the whole point of the
record is to be believable later.

---

## What this is not, restated

No part of this feeds the map. No probability from this record is published
anywhere in the product. The mapper's four calibrated outputs — one published,
three withheld with reasons — are unaffected by anything logged here.

If the paired delta eventually clears its bar over enough batches, that is a
finding about an outside analyst reading Meridian's output. It would be a
reason to run more batches. It would not be a reason to put a direction on the
map screen.
