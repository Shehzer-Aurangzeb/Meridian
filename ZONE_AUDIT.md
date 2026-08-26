# Zone-map audit — plan

Written 26 Aug 2026. Roadmap item 2.6. **Nothing here is built yet.**

## Why this exists

`SupportResistanceService` and `LevelMapService` decide where every entry,
stop and target goes. Neither has been audited. Everything else in the system
has: the scorer, the outcome states, the cost model, the harness.

So every measurement so far has assumed the levels themselves were right. If
they are not, the −0.369R result is not a verdict on the method — it is a
verdict on a broken implementation of the method, and those are different
things.

**This is a diagnosis, not a fix.** It cannot make the strategy profitable. It
can only tell you whether the strategy was ever actually tested. That is worth
a few days and no more.

## What the code does now

Read these three files first; they are small (718 lines total):

- `apps/api/src/analysis/services/support-resistance.service.ts` (419)
- `apps/api/src/analysis/services/level-map.service.ts` (195)
- `apps/api/src/analysis/interfaces/support-resistance.types.ts` (104)

The pipeline, end to end:

1. Fetch candles for **12h, 4h, 1h** (`LEVEL_TIMEFRAMES`, level-map.ts:22)
2. Per timeframe, find swing highs and lows — a bar higher/lower than the 2
   bars either side (`SWING_LOOKBACK = 2`, sr.ts:77 and :115)
3. Group swings within **0.5%** of each other into clusters (`clusterLevels`,
   sr.ts:151)
4. Keep clusters with **2+ touches**, score them 1–5, keep the **10 nearest**
   to spot (sr.ts:68)
5. Add **5 Fibonacci quarters** anchored to the 12h swing range
6. Flatten all of it into `marks`, each tagged with a `source` string
7. Group marks into **zones** where 2+ *different* sources agree
   (`findConfluenceZones`, sr.ts:354)
8. A zone below spot is where a long goes; above, a short

## Confirmed already — verified in the code, no measurement needed

These four are facts. Do not re-litigate them; decide what to do about them.

**A. The lookback setting is dead.** `SR_DEFAULTS.LOOKBACK_CANDLES = 100`
(types.ts:69) is read by nothing in production — only `test/manual/zonetest.ts`
and a comment. `SRDetectionOptions.lookbackCandles` (types.ts:58) is declared
and documented but never destructured in `levelsFromCandles` (sr.ts:30). The
real window is whatever `CANDLE_LIMITS` supplies: 120 bars on 12h, 150 on 4h,
200 on 1h. A reader would reasonably believe it was 100 everywhere.

**B. Level strength never reaches a zone.** `calculateLevelStrength` (sr.ts:282)
produces a 1–5 score per level. It reaches the entry checklist
(`checklist.service.ts:315`) but `ConfluenceZone` has no strength field at all,
and `findConfluenceZones` only receives price, type, source and touchCount. So
the thing trades are actually built on cannot see it. Either wire it in or
delete it — right now it is neither.

**C. "Did it hold" is almost always false.** `checkIfLevelHeld` (sr.ts:255)
scans from the FIRST touch to the end, so any break at any time marks the level
broken — and price usually breaks through at some point between two touches.
The ±0.5 strength adjustment is therefore applied near-uniformly and changes
scores without changing ranking. There is already a `TODO` on it saying it
should probably mean "held since the most recent touch".

**D. The Fibonacci anchor is nearly the raw high and low.** `fibAnchors`
(sr.ts:337) takes `Math.min` of every swing low and `Math.max` of every swing
high. The comment says this stops "one freak spike" defining the range, but a
spike that forms a swing point still defines it. The protection is thinner than
advertised.

## What to measure — in order, each with its method

Every one of these is a hypothesis with a number attached. Do them one at a
time and stop after each to look.

### 1. Are the zones stable, or an artifact of the grouping order?

`findConfluenceZones` (sr.ts:354) sorts marks by price then walks left to
right, adding each mark if it is within 0.5% of the group's **running mean**
and the total span stays under 1%. That is greedy single-pass clustering: it is
order-dependent, and a mark that could belong to two groups always joins the
first. A chain break at one price shifts every group above it.

**Method:** re-run the grouping on the same marks in reverse price order and
compare the zones produced. Then jitter every mark by ±0.05% and re-run. If
zone centres move more than the entry-to-stop distance, the zones are noise
and nothing downstream means anything.

**Why it matters most:** the stop sits 1 ATR beyond the zone edge. If the edge
is unstable, so is 1R, and 1R is the denominator of every number we have.

### 2. Is the confluence real, or can two marks from one method fake it?

A zone needs 2+ distinct `source` strings. Sources are built at
level-map.ts:156 as `` `${timeframe} ${level.type}` `` and at :166 as
`` `${ratio} Fib (12h)` ``. The comment at :153 explains the intent correctly
— method plus chart, nothing else, so repetition cannot fake agreement.

Two ways it can still be faked:

- **`12h support` + `12h resistance`.** Both are 12h swing points. Same method,
  same chart, but two different strings — so a swing high at 100.0 and a swing
  low at 100.2 count as independent agreement. They are not.
- **`0.25 Fib (12h)` + `0.5 Fib (12h)`.** Same method, same chart, different
  ratios. They sit 25% of the range apart, so this only bites when the range is
  tight — which is exactly the COMPRESSION regime the tool trades most.

**Method:** for every zone in the live set, print its `sources` and count how
many are genuinely distinct *methods* (swing vs fib) on distinct *charts*.
Report what share of zones drop below 2 under that stricter rule, and re-score
those trades separately.

### 3. Are 12h, 4h and 1h independent at all?

They cannot be, by construction — a 4h bar is made of 1h bars, and a 12h bar of
4h bars. A swing high on 12h is frequently also a swing high on 4h. The whole
premise is "agreement across DIFFERENT charts is the point" (level-map.ts:64),
and nested timeframes are the weakest possible version of different.

**Method:** count how often a 4h level and a 1h level in the same zone trace
back to the same underlying price extreme. If it is common, "3 sources" often
means one event counted three times.

### 4. Does keeping the 10 nearest levels starve one side?

`allLevels.slice(0, maxLevels)` (sr.ts:68) keeps the 10 nearest levels by
absolute distance, with no balance between above and below. In a trend, the
near side is crowded and the far side is empty, so one direction can lose its
levels entirely.

**Method:** per analysis, count levels kept above vs below spot. Cross-check
against the live finding that long setups filled 46% and shorts 72% in the
rally. **Be careful here:** deduplicated *opportunities* were balanced
(82 long / 79 short), so this is a hypothesis about fill rates, not about
selection. Do not restate it as a bias claim — that error has already been
made once in this project and corrected.

### 5. Is 0.5% the right grouping width, and 2 the right touch count?

Both are picked, not derived (`CLUSTER_THRESHOLD: 0.5`, `MIN_TOUCHES: 2`,
types.ts:65-68). The playbook's worked example spans 0.524%, which is where the
span cap came from, but nothing else justifies the numbers.

**Method:** sweep them and report zone count, fill rate and net R at each
setting. **Then stop.** Do not pick the best one — that is fitting, and this
project has already retracted one result for exactly that. The output is a
sensitivity curve: if results swing wildly across the sweep, the parameters
were load-bearing and every past number carries an unstated error bar. That
finding is the deliverable, not a better setting.

## How to run it

`test/manual/backtest-plans.ts` already rebuilds the level map as of any past
bar via `mapAt(i)` and calls `LevelMapService.buildFrom` — which is already
split from fetching precisely so a caller can hand in shortened history. That
is the hook for 1, 2, 4 and 5. Nothing new needs building to fetch or replay.

For live zones, `test/manual/live-audit.ts` reads production analyses and their
stored `coordinatorPayload`, which contains the full `map.zones` array — so
questions 2 and 3 can be answered on real saved zones without recomputing
anything.

Write findings as ONE new manual CLI, in the style of the existing ones:
a header comment saying what question it answers and what it cannot, and a
`--self-check` or an assert-based demo. Do not modify the two services until
the measurements are in.

## What would count as a result

- **Zones unstable under reordering or jitter** → the levels were never tested,
  and every past number needs its error bar restated. Biggest possible finding.
- **A large share of zones fail the stricter source rule** → the confluence
  filter is weaker than documented and the zone count is inflated.
- **Results swing wildly across the parameter sweep** → the constants were
  load-bearing and undocumented.
- **All four come back clean** → the levels were right, the strategy genuinely
  does not work, and the retirement is confirmed rather than assumed. This is a
  perfectly good outcome and should be reported as plainly as the others.

## Rules for this work

- **The holdout stays unspent.** No `--split holdout`, no `holdout.ts`, no
  TUNE/HOLDOUT split unless explicitly asked.
- **Measure, do not infer.** Every claim needs a file, a line and a number.
- **Do not tune.** Sweeps produce sensitivity curves, never a chosen setting.
- **Matched-trade comparison only.** Changing the level map changes which
  trades exist, so full-run A/Bs are not evidence. Compare the same trades.
- **Report resolved-only and marked, plus the gap.**
- **Record the exact command with every result.**
- `pnpm golden` re-scores each trade with the config frozen into the file, so
  changes to the level map will NOT show up there. It is not a safety net for
  this work.
- Expect a null. Four audits before this one found bugs that moved numbers and
  not conclusions.
