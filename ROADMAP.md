# Meridian — roadmap and parked work

Written 25 Aug 2026.

This file lives at the repo root on purpose. `.gitignore` line 39 ignores any
directory named `docs/`, and the repo is public, so that rule is deliberate:
`docs/` holds research logs and a third-party playbook that must not be
published. The cost is that nothing in `docs/` is backed up by git — including
`ZONE_AUDIT.md`, which now lives there and carries the question 1 result. This
file is at the root so that at least the index of the work survives.

Where a number below could be checked against the code or a results file, it
was, and the location is given. Where it could not, it says so. Nothing here
is asserted on memory alone.

---

## 1. Where the project stands

**The confluence-zone strategy is retired.** It was not abandoned halfway. It
was measured, and the measurement was negative.

- **−0.106R per trade**, resolved trades only, after the zero-target fix.
  Verified: `docs/HANDOFF.md:14`, with the working table at `docs/HANDOFF.md:88`
  over 569 trades from `cp4-unified-20260815.csv`.
- Every exit rule we tried came out negative once open trades are excluded.
  Closing on price — a tighter stop, a trailing stop — made it worse, because
  it turns winners into losers faster than it rescues losers. `D_tight` halves
  the stop and drops the win rate from 61.4% to 48.6% to land in the same place
  (`docs/HANDOFF.md:126`). The least bad was closing when a fresh analysis no
  longer prints a plan, and that one is still negative.
- Public indicators carry no directional edge. This was checked four separate
  ways — the live schedule, an 84-day run, a 3-year panel, and a base-rate
  engine — recorded across `docs/STATE_OF_PLAY.md` and
  `docs/STATUS_FOR_REVIEW.md`.

**Could not verify, recorded as reported.** The bootstrap result
(P(>0) = 0.000 on resolved-only) and the trailing-stop chain
(+0.037R → +0.0012R → −0.030R, each step a bug coming out) are not present in
any results file or document in this repo. The bootstrap tool itself exists
(`apps/api/test/manual/bootstrap.ts`) but its output was not saved. Treat both
as unconfirmed until re-run.

**Fixing the remaining bugs would change the numbers, not the conclusion.**
That is why they are parked instead of fixed. The known defects in section 3
are real and some are large, but they move a result that is negative by a wide
margin, on a strategy whose inputs have separately been shown to carry no edge.
Spending weeks to make a losing number more precise is not worth it.

---

## 2. What comes next, in order

### 2.1 Forward data collector — DEPLOYED 26 Aug 2026, first run pending

**Status, 27 Aug 2026.** Live on `origin/main` (`abcc8d5`, PR #15, merged
26 Aug 22:35 UTC). The EventBridge rule fires at 03:30 UTC daily, so the first
collection is the morning of 27 Aug. Checked against production: the
`FlowSample` table exists and holds **0 rows** — expected, not a fault, but it
means the retention clock has not started saving yet. **Verify rows land after
the first 03:30 run.**

- `FlowSample` table, keyed on (symbol, metric, ts) so re-runs insert nothing new
- `FlowCollectorService` — all four endpoints, verified against live Binance
- Daily EventBridge rule at 03:30 UTC, asking for 30 days every time so a
  missed run repairs itself
- Nine tests, including the paging guard that stops a misbehaving endpoint
  looping for ever

Everything below is why it exists. The only item with a deadline.

Binance keeps roughly **30 days** of open interest, taker buy/sell volume,
long/short account ratio, and premium index. Every day we do not collect is a
day gone permanently. Funding and premium have about three years of history;
the rest do not.

This produces **zero signal today**. In 12–18 months it supports a real
train/test split on the inputs we actually wanted to study, rather than the
public indicators that turned out to be worthless. Nothing else on this list
gets harder by waiting. This one does.

### 2.2 Measure real execution cost — DONE, 26 Aug 2026

**The measured round trip is 0.25%.** It replaces the 0.14% we had been
modelling, which was a fee plus a guessed slippage taken from a different
exchange's futures pricing. Now one number, because only the total was
measured — splitting it into a fee and a spread would be inventing the halves.

Changed in `outcome.ts` (the site and every harness read it from there) and in
every research CLI's default. The golden set is unaffected: it re-scores each
trade with the cost frozen into the file, so the baseline could not move.

What it costs on the live record, 16–25 Aug, re-run at the measured number:

    basis                    was (0.14%)   now (0.25%)
    open marked to market      -0.180        -0.277
    closed only                -0.277        -0.379
    stopped-out trades         -1.120        -1.214
    total                                    -26.9R over 97 fills

**This is the number that gates 2.3, and it did not pass.** Cost in R is
`0.25 / stop%`. At the current ~1.3% stop that is 0.19R per trade. At the ~0.7%
stop a 1–3 hour hold implies, it is **0.36R per trade** — every trade would
need to average better than +0.36R before it earned anything at all. Read
2.3 with that in front of you.

### 2.3 Finer candles — MEASURED, and not needed

Two things were checked before any of this was built, and both came back
against doing it.

**The data was never the obstacle.** 1m and 5m klines go back to **2017** for
BTC and ETH — full history, no retention cliff. And the code already handles
them: `TimeInterval` includes both, `CANDLE_LIMITS` has entries for both,
`getCandlesFrom` pages transparently, and `LEVEL_TIMEFRAMES` / `ATR_TIMEFRAME`
/ `ANALYSIS_TIMEFRAME` are already module constants everything reads from.
Nothing needs rebuilding. The earlier note in this file saying otherwise was
wrong.

Volume, for reference: 1m is ~41M candles across ten coins (~41,000 requests);
5m is ~8.2M (~8,200); 15m is ~2.7M.

**The one-hour bar was barely lying.** `test/manual/resolution.ts` scores every
live plan twice, identical except the bar size, and compares. The concern was
real: a 1h bar records only open, high, low and close, not the ORDER they
happened in, so when one bar touches both the stop and a target the scorer has
to guess, and it guesses stop-first because the alternative would flatter every
result.

Run over 310 analyses since 16 Aug, 157 comparable on both clocks:

    clock                mean netR   total R
    1h (what we quote)     -0.427     -67.1
    5m (the truth)         -0.369     -57.9

    error: +0.059R per trade, 9.2R in total

    status changed on 12 of 162 (7%), every one in the same direction:
      STOPPED     -> PARTIAL       7
      NO_FILL     -> PARTIAL       3
      NO_FILL     -> ALL_TARGETS   2

    plus 5 trades that opened on 5m and never on 1h, worth 1.20R
    zero trades went the other way

**The guess was always pessimistic, never flattering.** No result this project
has published was inflated by it; a few were understated. That is the reassuring
direction to be wrong in, and it means the recorded history stands.

By how long the trade lasted, on the fine clock:

    held      n    mean error (R)
    0-3h     41        0.125
    3-12h    56        0.022
    12-24h   28        0.101
    24h+     32        0.000

The prediction was that the error would concentrate in the shortest holds and
dominate them. It does lean that way — 0.125R at 0-3h against exactly zero
past a day — but it is not monotonic and it is not large.

**Verdict: finer bars do not rescue short holds.** The measurement error they
would fix is 0.059R per trade. The cost gate from 2.2 is 0.36R per trade at the
0.7% stop a short hold implies. The correction is a sixth of the problem, so
2.3 stays closed.

**One caveat, and it is the reason not to treat this as settled forever.** The
0-3h trades measured here are trades that happened to resolve quickly under the
CURRENT geometry — wide stops, a 72h limit. A strategy actually designed for
1-3 hour holds would use much tighter stops, putting the stop and the target
close enough together that the same bar touches both far more often. So 0.125R
is a floor for such a strategy, not an estimate of it. If short holds are ever
revisited for a reason that survives the cost arithmetic, re-run this first.

### 2.4 Baseline measurement — not needed while 2.3 stays closed

It existed to separate a new input's effect from the timeframe change. With no
timeframe change, there is nothing to separate. Revive it if 2.3 reopens.

### 2.5 Then new inputs, one at a time

Sequential testing against that baseline.

Before starting, write down **how many inputs will be tested** and **the kill
criterion for each**. Test twenty inputs individually and roughly one will look
significant on noise alone. That is how the original five-condition checklist
got built, and why it did not survive.

### 2.6 Audit the zone map — question 1 done, null

**Planned in `docs/ZONE_AUDIT.md`; results at the foot of that file.**

**Q1 (are the zones an artefact of grouping order?) — answered 27 Aug, null.**
`apps/api/test/manual/zonestability.ts`. Over 4,770 zones, a zone centre moves
**0.006R** at the median when every mark is jittered ±0.05%, and **0.000R** when
the same marks are grouped top-down instead of bottom-up. The bar was 1.0R. The
grouping IS order-dependent — 23% of zones shift and the zone count moves ±3% —
but not by enough to reach any trade built on one.

So the level map is reproducible, and the −0.369R result is not an artefact of
unstable levels. That was the finding most likely to invalidate everything
downstream, and it did not.

**Q2 (is the confluence real, or can two marks from one method fake it?) —
answered 27 Aug, 8%.** `zoneaudit.ts --q2`. Collapsing each source to method +
chart — `12h support` and `12h resistance` are both `12h swing` — leaves **92%
of zones still passing** the 2-source rule. The filter is weaker than
documented, by eight percent.

Of the two mechanisms the plan named, one is common but rarely decisive
(sup+res pairs appear in 38% of zones, load-bearing in 8%) and the other
**never fired once** in 4,770 zones (two fib ratios in one zone needs an anchor
range under ~4%; none was). Re-scoring that 8% is outstanding, not closed — see
`docs/ZONE_AUDIT.md`.

**Both re-run 27 Aug on seven charts** after `LEVEL_TIMEFRAMES` widened to
`1w/1d/12h/4h/1h/30m/15m`. Q1 still passes (median 0.000R reverse, 0.005R
jitter; p90 doubled to 0.082R, still 12× inside the bar). Q2 **improved**:
inflated share 8% → 5%, and zones resting on 3+ genuinely independent methods
went 19% → 57%. More charts add real confirmation faster than fake.

Q3–Q5 not started. Q1 was the gate and it passed, so the rest are optional in
the same way the whole section was. Q5 (parameter sweep) gained a concrete
target: the 0.5% cluster threshold is intraday-calibrated and applied unchanged
to the weekly chart, where it yields roughly one mark in fifty.

`SupportResistanceService` and `LevelMapService` were never examined by either
audit, and they decide where every entry, stop and target goes. Two smells,
both confirmed in the code:

- **`SR_DEFAULTS.LOOKBACK_CANDLES = 100` is dead in production.**
  `apps/api/src/analysis/interfaces/support-resistance.types.ts:69` defines it.
  The only places that read it are a manual script
  (`apps/api/test/manual/zonetest.ts:94`) and a comment. The live
  `SupportResistanceService` never uses it — it uses `SWING_LOOKBACK` instead.
  So the number a reader would assume governs the lookback governs nothing.
- **`STRENGTH_THRESHOLDS` computes a strength that never reaches a zone.**
  `support-resistance.service.ts:284-310` produces a 1–5 strength per level. It
  reaches the entry checklist (`checklist.service.ts:315`), but `ConfluenceZone`
  has no strength field at all, so the zone the trade is actually built on
  never sees it.

Worth a few days if it would settle whether the levels themselves were ever
right. Not required before moving on.

---

## 3. Deliberately parked

These are **known, measured, and not being fixed**. Recorded so nobody
rediscovers them and thinks they are news.

**Note on sourcing.** The brief for this file referred to a "Session 2 audit"
document. No such file exists in this repo or in the local `docs/` directory.
Every item below was therefore re-verified against the code directly, and the
line numbers are the evidence. Where an item could not be found in the code, it
says so.

### N2 — the golden set does not reserve a right edge

`apps/api/scripts/golden-build.ts:190` stops at `h1.length - 2`, which excludes
only the still-forming candle. The main harness reserves a full window: a
decision bar needs the fill window plus the hold before it can resolve
(`apps/api/test/manual/backtest-plans.ts:443-449`, with a comment explaining
exactly why). The golden builder was written to match the harness and has since
drifted from it.

Effect: trades near the recent edge of the golden set get a short window, get
marked to market early, and then count at full weight alongside trades that had
their whole window.

Parked because: the golden set's job is to notice when scoring changes, and it
does that fine with a biased-but-stable baseline.

### N3 — `aggregate()` counts unfilled trades as finished losses

`apps/api/src/common/replay/trade-scoring.ts:320` defines unresolved as
`status === 'TIMEOUT'` and nothing else. A `NO_FILL` row is therefore treated as
**resolved**, and its zero enters `expectancyResolved` as a real finished trade.

Two further problems in the same function:
- `winRate` divides by `rows.length` (line 377), so unfilled rows dilute it.
- Wins are `x > 0` and losses are `x <= 0` (lines 361-362), so a zero is a
  **loss**. Every unfilled trade is booked as a losing trade.
- `mean([])` returns `NaN` and `payoff` returns `NaN` when there are no losses.
  Those NaNs propagate into printed tables.

Parked because: callers mostly pass filled trades only, so the headline numbers
are not wrong today. It is a trap for the next caller, not a live defect.

### N4 — the concentration ratio divides by a signed total

`apps/api/test/manual/exits.ts:575-579`. `total` is the signed sum of net R
across all trades. The line then prints `top2 / total` as a percentage.

When the strategy loses money the total is negative, so the ratio flips sign
and means nothing — top two coins contributing +5R against a −10R total prints
as −50%. The `> 0.6` "CONCENTRATED" test can never fire on a losing set.

Parked because: it is a diagnostic print on a retired strategy.

### Cooldown makes the trade set depend on the exit rule

`apps/api/test/manual/backtest-plans.ts:706-707` sets the next allowed entry to
`i + barsToFill + barsHeld + COOLDOWN`. `barsHeld` is decided by the exit rule.
So changing how trades exit changes when the next trade may start, which
changes which trades exist at all.

This is why full-run A/B comparisons are not evidence here. It is already
partly mitigated: the exit arms are scored against the base arm's entry set on
purpose (`backtest-plans.ts:325-333`), so arm-vs-arm comparisons are honest.
The problem remains for anything compared across separate runs.

*Not verified:* the figure that 98% of the walk is redrawn on any scorer change
does not appear in the repo. The mechanism is real; the magnitude is unchecked.

### The entry ladder takes full size on every loser

Confirmed in `apps/api/src/analysis/services/trade-plan.service.ts:154-167`.
Entries sit at the near edge of the zone, its centre, and the far edge. The stop
sits **beyond the far edge** — one ATR past it.

So any price that reaches the stop has already traded through all three entry
legs. **Every stopped-out trade is 100% filled.** Meanwhile a trade that turns
around quickly at the near edge fills only the first leg, at partial size.

The ladder therefore takes full size on every loser and partial size on its
fastest winners. That is a structural drag, not a bug in the scorer — the
scorer models it correctly.

### The cost model charges maker and taker the same

`apps/api/src/analysis-coordinator/outcome.ts` — one flat round trip, applied
identically to every trade.

2.2 replaced the *size* of that number with a measured 0.25%, but not its
shape. In reality the entry legs are resting limit orders, which pay the lower
maker fee, and a stop-out is a market order, which pays taker. Per-order cost
is not modelled at all, so a three-leg entry is charged as if it were one
order.

Parked, but it is now the most valuable of these: 2.3 hinges on whether the
maker side is genuinely cheaper, and a flat number cannot answer that.

### Config provenance — load-bearing numbers with a broken citation

Three constants are picked, not derived, and they drive every result:

- `MAX_BARS = 72` — `apps/api/test/manual/backtest-plans.ts:126`
- `SLIP_PCT = 0.02` — `apps/api/test/manual/forward-test.ts:97`
- `FILL_WINDOW_HOURS = 24` — `apps/api/src/analysis-coordinator/outcome.ts:57`

**Correction, 27 Aug 2026 — the §14h citation is good.** An earlier version of
this file said there is "no §14h" in `docs/STATE_OF_PLAY.md` and that
`forward-test.ts` cited a section that did not exist. That was wrong. §14h is at
`docs/STATE_OF_PLAY.md:1041` — "THE TRADE PLAN ITSELF — flat before costs,
negative after" — and its Config block at :1058 records
`fill-bars=24 max-bars=72 cooldown=24` verbatim, which is exactly what
`forward-test.ts` cites it for. The eleven citations are correct.

What remains true: §14h *records* those settings, it does not derive them. 72
bars and a 24-bar cooldown were chosen, and §14h is the log of a run that used
them, not an argument for them. So the constants above are still picked rather
than derived — that part of this section stands.

`forward-test.ts:20` does still miscite: it credits "methodology rule 7" for the
claim that the unit of evidence is the month. That is **rule 8**
(`docs/STATE_OF_PLAY.md:658`); rule 7 (:657) is about never claiming zero fitted
parameters. Off by one. The file has three separate "Methodology rules added"
sections, each restarting its numbering, which is how it happened.

Parked because: the constants are documented here now, which is what a reader
needs. Re-deriving them belongs to whatever strategy replaces this one.

### Split bleed and the random control

Two items from the brief could **not** be found in the repo and are recorded as
unverified:

- **TUNE/HOLDOUT bleed** — reported as 3.3% of TUNE leaking into holdout prices
  in the base file, and roughly six times worse in the arms file. The split gate
  itself is real and strict (`apps/api/test/manual/exits.ts:245-257` refuses to
  run without `--split`), but no measurement of the bleed exists in any results
  file here.
- **The random control's spread** — reported as roughly 7× the quantity it
  estimates, making it unusable. Not found. Note that the recent live forward
  test still leans on this control for its "+0.5R better than random" figure,
  which is a further reason to distrust that number.

Re-measure both before either is cited again.

### 75% of trades are half of a simultaneous long and short

Reported, and consistent with how the planner works — it builds one plan for
the nearest zone below and one for the nearest zone above, so both sides fire on
the same coin at the same moment. **The 75% figure itself is not in the repo**
and was not re-derived. The mechanism is confirmed
(`trade-plan.service.ts`, the two-zone loop); the proportion is not.

---

## 4. Already-open items

- **Re-freeze the golden set.** `pnpm golden` reports 5/35 changed. That is
  deliberate — the zero-target fix withheld exactly those five plans, and the
  stale baseline is currently what proves the fix worked. Re-freezing is a
  decision, not a chore.
- **`algoVersion` column.** The scoreboard currently splits old from new
  analyses on a timestamp (16 Aug). A timestamp is a weak proxy for which code
  produced a row. A column plus a migration is the real fix.
- ~~**Two unmerged research CLIs**~~ — `5b6526e` (live audit) and `e87651c`
  (`--until` on the forward test) both reached `origin/main` in PR #12. Closed.
- **The `docs/` directory — cleaned 27 Aug 2026.** Was fifteen files plus a PDF;
  now eight plus the PDF. What went, and why:

  | deleted | reason |
  |---|---|
  | `API_INTEGRATION.md` | documented `/analysis-coordinator/coordinate` and `/stream`; those controllers are now `analyses`. Swagger at `/docs` is live and correct. |
  | `BACKEND_ARCHITECTURE.md` | same mental model as `STATE_OF_PLAY.md` §1–2, three months older |
  | `DEVELOPMENT_PLAN.md` | May 5 Phase 0 setup plan, executed |
  | `MERIDIAN_REBUILD_PLAN.md` | two lines different from the tracked `apps/api/docs/REBUILD_PLAN.md` |
  | `INDICATOR_VALIDATION.md` | a "✅ COMPLETE" test-count listing; the tests are the truth |
  | `EXTERNAL_REVIEW_BRIEF.md` | self-marked SUPERSEDED, headline number retracted, "do not quote numbers from this file" |

  All seven `apps/api/docs/*.md` were deleted too — every one predates the
  measurement work and two document a `POST /analysis/complete` endpoint that no
  longer exists. Those were tracked, so `git revert` brings them back.

  **The `docs/` deletions are not in git.** They are backed up at
  `~/Downloads/Projects/Personal/Meridian-docs-backup-20260827/`. That backup is
  the only copy — treat it as such until you are sure nothing is missed.

  **Still do not delete anything in `docs/` without backing it up first.** The
  nine survivors are there because live code or this file cites them:
  `STATE_OF_PLAY.md` (8 code files), `HANDOFF.md` (§1 above), `DEPLOYMENT_PLAN.md`
  (`infra/bin/meridian.ts:12`), `MERIDIAN_BASERATE_PLAN.md` (`baserate.ts:16`),
  `MERIDIAN_FLOW_PLAN.md` (the collector shipped from it), `STATUS_FOR_REVIEW.md`
  (§1), `SYSTEMATIC_ANALYST.md` (the product thesis), `FRONTEND_ENGINEERING.md`
  (rationale for the live History page), and the playbook PDF (source of every
  parameter).

---

## 5. Discipline that carries forward

These survived the strategy. They apply to whatever is built next.

- **Measure, do not infer.** Every claim needs a line number and a number.
- **Matched-trade comparison is primary.** Trade-set drift is larger than most
  individual fixes, so full-run A/B tests are not evidence.
- **Report resolved-only, not marked-to-market.** Always give both, and the gap
  between them.
- **Pre-register the prediction and the kill criterion** before running.
- **Record the exact command** with every result. §14 is unreproducible purely
  because this was not done.
- **Cost-stress at 1.5× from day one**, not as an afterthought.
- **Expect a null.** Most signals a retail account can reach are already
  arbitraged away.
- **The holdout is touched once, at the end.** It is currently unspent.
- **One checkpoint per turn.** Stop and inspect before moving on.

---

## 6. What survives the retirement

The strategy is dead. **The measurement rig is the asset**, and it works against
any strategy, not just this one. All of it verified in place:

- **One scorer** — `apps/api/src/common/replay/trade-scoring.ts`. Fills the
  entry ladder leg by leg, sizes the result to what was actually held, charges
  cost in R, and derives status in one place. Every harness calls it.
- **`aggregate` with a permanent marking gap** — `trade-scoring.ts:356`. It
  reports the marked average, the resolved-only average, and the difference,
  always. That difference is what separates a real result from a bookkeeping
  choice. (Fix N3 before reusing it on a set containing unfilled rows.)
- **The golden harness** — `apps/api/scripts/golden-build.ts` and
  `golden-report.ts`. Frozen inputs and outputs, re-scored on demand, so a
  scoring change announces itself instead of quietly moving every result.
- **A split gate that refuses to default** — `exits.ts:245-257`. No `--split`,
  no run. `--split holdout` prints a banner saying the rows are now spent.
- **Look-ahead guards that run on every bar** — `backtest-plans.ts:513-531`,
  checked against real data rather than fixtures. It throws if any series
  extends past the decision bar.
- **`BASE_check` bit-identity** — `exits.ts:80-88`. An arm configured to be
  identical to the base trade must reproduce it exactly, to the floating-point
  bit. It is the control that proves the arm machinery adds nothing.
- **21 test suites, ~370 tests.** Static count is 360 `it(` blocks; `.each`
  blocks expand at runtime, which accounts for the rest.

---

## 7. The resolution constraint — added 27 Aug 2026

**This is the durable finding of the session and it gates every comparison made
from here on.**

### The harness measures correctly

`backtest-plans.ts` had never had a positive control. It has one now. The
harness was copied to a scratch location with only its import paths changed, and
edges of known strength were planted into the trade outcomes by exact quota
(Bresenham-spread, so the realised mean tracks the nominal at any trade count).
Four plants, planted beside recovered:

| plant | planted (closed form) | recovered | miss |
|---|---|---|---|
| strong | +0.1977R (n=177) | +0.1977R | 0.00e+0 |
| weak | +0.0395R (n=177) | +0.0395R | 0.00e+0 |
| one arm only | +0.1957R (n=92) | +0.1957R on `C_trail_10`, 0.0000R on `BASE_check` | 0.00e+0 |
| negative | -0.1073R (n=177) | -0.1073R | 0.00e+0 |

It does not attenuate, lose, or invent an edge, and it does not leak a plant
across arms. **Cooldown re-phasing does not interfere either**: a one-bar change
to `barsHeld` redraws 58.2% of the walk (103 of 177 trades, n 177 → 171), and
recovery stays exact against the new n. Re-phasing breaks comparability BETWEEN
runs; it does not corrupt the measurement WITHIN one.

### But it cannot resolve anything this project has decided on

A 14-day block bootstrap — `holdout.ts:blockBootstrap`, seed 12345, 2000 draws —
puts a **95% interval 0.318R wide** on edge over random for a 3-coin, 80-day
window, straddling zero. Six blocks is a coarse resample base; that is a limit
of the window, not of the code.

| decision | delta it rested on | vs 0.318R |
|---|---|---|
| CHARTS_AB — revert 7 charts | 0.130R | 2.4x inside |
| HIERARCHY_AB — revert hierarchy | 0.200R | 1.6x inside |
| pre-registered "better" bar | 0.050R | 6x inside |
| pre-registered "neutral" band | 0.020R | 16x inside |

**Every decision made so far rested on a delta inside the interval.** None of
them are wrong — both were reverts, and a revert needs only a failure to clear a
bar — but they are directional and unreplicated, not measurements.

The instability is not theoretical. The same command run twice roughly two hours
apart, differing only by the candles that arrived in between, moved the headline
**+0.108R -> +0.056R on three extra trades** (177 -> 178 strategy, 104 -> 106
control).

**Any future strategy comparison needs one of: a much longer window, more coins,
or a metric with a tighter interval than edge-over-random.** Adding an input and
re-running this rig on 80 days of three coins will not settle anything.

### The random control should not decide anything until it is rebuilt

It carries **0.301R of the 0.318R**: the PLAN arm's own interval is 0.098R wide,
the RANDOM arm's is 0.301R. It also moved 0.044R on three trades when the window
shifted by hours.

This retires the "not found / unverified" note in §3 under *Split bleed and the
random control*. The control's spread is now measured, and it is the dominant
term.

**The known defect** is at `backtest-plans.ts:721`: `allSignals` is pushed
BEFORE the `STATES` filter on the next line. So the control samples from every
plan the walk produced — ACTIONABLE, APPROACHING and FAR — while the strategy
arm takes ACTIONABLE only. The two arms are drawn from different populations,
which is not what "same plans, random timing" claims. Fix this before quoting
edge over random as a primary metric again.

### Also landed this session

- **Edge over random now prints BOTH conventions**, resolved-only (the
  pre-registered primary) and marked, from the same `aggregate`, with the open
  count and the marking gap. It printed only the marked figure until now, while
  both pre-registrations defined the primary as resolved-only.
- **Five silent degradation-to-null sites fixed** — `completedAsOf` (bad
  duration returned zero candles), `levelsFromCandles` (zero candles / bad spot),
  `findConfluenceZones` (bad spot), `fibLevels` (NaN anchor), and
  `FlowCollectorService.fetchWindow` (a changed API shape read as an empty
  window). Each now throws instead of returning an empty result.
- **Five found and deliberately NOT fixed**, recorded so they are not
  rediscovered as news: `levelsFromCandles` with 1-19 candles still warns and
  returns `[]` and that warning is invisible under `Logger.overrideLogger(false)`
  (the weakest remaining spot); `calculateBandWidthSeries` returns `[]` below its
  period, feeding the regime percentile; `mapAt` returns null below 50 candles
  and the skipped bars are counted nowhere; `run-log.ts:32` returns `[]` for a
  missing file; `findFirstFill` / `fibAnchors` / `verdict.ts` nulls are genuine
  "nothing there".
- **`partial-weights` retired as a golden-set coverage category.**
  `renormaliseTargetWeights` always sums to 100 for one or more targets, and
  `buildPlans` no longer emits a zero-target plan, so `targetWeightSum < 100` is
  unrepresentable. The only five members that ever satisfied it were the
  zero-target plans that stopped building. A coverage guard that can never be met
  throws on every future `--extend`.
- **`pnpm golden` now exits non-zero** on any changed status, any changed netR,
  or any `NO_PLAN`, and names the dead fixtures. It always exited 0 before, which
  is how five dead members survived twelve days.
- **The golden set is in git.** `apps/api/.gitignore` keeps ignoring the bulk
  result CSVs but tracks `golden-set*.json`, so the drift detector and its three
  archives no longer exist only on one laptop.

---

## 8. The flow archive — imported 28 Aug 2026

`https://data.binance.vision/data/futures/um/daily/metrics/<PAIR>/` publishes
five-minute open interest, long/short and taker data as daily files, free and
without a key. It removes the twelve-month wait: **2021-12-01 onward for all ten
coins, BTC from 2020-09-01**, 17,766 files, 203 MB, every checksum verified.

Six columns become six `FlowSample` metrics. The mapping, the timestamp shift
and the evidence live in ONE place — `ARCHIVE_METRICS` in
`flow-collector.service.ts`. Nothing downstream needs to know the archive exists.

### The shift, because it is a silent look-ahead

The archive stamps a snapshot with the START of its window; the live API stamps
it when it PUBLISHES, one bar later. `archive[T] === live[T + 5min]` for the five
snapshot columns; `sum_taker_long_short_vol_ratio` is a flow measured over the
window and shifts by zero. Measured over the whole ~29-day live overlap: ten
coins, 82,850 comparisons per column, unanimous, no coin or day dissenting.
Reading an archive row as known-at-its-own-timestamp is a five-minute look-ahead
that throws nothing.

### Two taker metrics, because they are two numbers

`takerBuySellRatio1h` (Binance's hourly aggregate, what the collector has been
storing) and `takerBuySellRatio5m` (the archive's, and now also collected).
Neither reconstructs the other: the mean of twelve 5m ratios misses the 1h ratio
by **13.9% at the median and 67.3% at worst**, and only `sum(buyVol)/sum(sellVol)`
recovers it, which the archive does not publish.

**A 1h taker feature must never be built by averaging 5m ratios.** If one is
wanted it has to be defined as something else — the last 5-minute bucket of the
hour, say — and named so the definition is visible.

### Coverage holes that must not be averaged away

- **2022 is a bad year for four of the six columns.** Blank cells by year:
  both top-trader columns are **87.2% empty in 2022**, the taker ratio **35.0%**,
  the global long/short ratio 5.1%. From 2023 on all four are ~0%. Open interest
  and its USD value have **zero** blanks anywhere in the archive.
  Overall: topTrader\* 18.0%, taker 7.3%, longShortRatio 1.1%.
  Blanks are SKIPPED at import, never written as 0 — absence is not a reading —
  and the import prints the count so the skipping is visible.
- **167 files hold fewer than 288 buckets.** In the ten-coin window they are the
  same dates across all ten coins at once (2021-12-04 at 285, 2021-12-15 at 287,
  2024-02-16 at 163). Binance-side collection outages: real holes in the market
  record, imported as-is because filling them would be inventing data.
- **263 files repeat every row**, all BTCUSDT between 2020-09-01 and 2021-05-21,
  none inside the ten-coin window. Deduped at import.
- **1,044 files are not in chronological order**, from 2024-04-04, and it is not
  a clean boundary — 51 dates have both sorted and unsorted files. Sorted
  unconditionally at import.
- **Twelve rows are stamped 1-3 seconds late** on the right minute (BNBUSDT and
  LTCUSDT 2024-04-03, SOLUSDT 2024-04-02, LINKUSDT 2024-04-01). Floored to the
  5-minute bucket; never match on exact epoch equality.

### The study window starts 2023-01-01 for top-trader and taker

**Not a preference — a constraint that follows from the coverage table above.**

Blank-cell rate by year:

| year | longShortRatio | topTraderAccount | topTraderPosition | taker |
|---|---|---|---|---|
| 2021 | 1.8% | 1.8% | 1.8% | 1.8% |
| **2022** | 5.1% | **87.2%** | **87.2%** | **35.0%** |
| 2023 | 0.0% | 0.0% | 0.0% | 0.0% |
| 2024 | 0.0% | 0.0% | 0.0% | 0.0% |
| 2025 | 0.0% | 0.1% | 0.0% | 0.0% |
| 2026 | 0.0% | 0.0% | 0.0% | 0.0% |

Coverage is not stationary, and that breaks the thing every experiment here
depends on. A TUNE/HOLDOUT split straddling 2022 would not compare two PERIODS,
it would compare two DATASETS: one where the top-trader columns are nine-tenths
absent and one where they are complete. Any difference between the halves would
be confounded with the density of the input, and the shuffled control would not
catch it, because the shuffle preserves the missingness pattern.

**So: any experiment using `topTraderAccountRatio`, `topTraderPositionRatio` or
`takerBuySellRatio5m` starts at 2023-01-01.** That still leaves **3 years
8 months, ten coins, 5-minute resolution** — far more than any input this
project has tested. `openInterest` and `openInterestValue` have zero blanks
anywhere and are not constrained; `longShortRatio` peaks at 5.1% in 2022 and is
a judgement call rather than a rule.

### The collector now does about seven times the work per run

Setting the two snapshots to 5m is the right call for the join, but it is not
free. A 30-day backfill at 5m is 8,640 rows per metric per symbol — 18 pages of
500 against 2 at hourly. Per run: roughly 570 page requests against about 80
before, plus the 120 ms politeness sleep between each.

Nothing is broken and nothing was changed for it, but **if the scheduled run
starts timing out, the fix is `DEFAULT_BACKFILL_DAYS`, not the period.** Thirty
days of overlap exists so a missed run self-heals; at 5m that is far more
overlap than the self-heal needs.

### WHERE THE ARCHIVE LIVES: locally. Production stays collect-only.

**Decided 28 Aug 2026 on two measurements, not on preference.**

**1. It does not fit.** Neon enforces a hard storage quota, readable from the
database itself:

```
psql "$DATABASE_URL" -c "SELECT setting FROM pg_settings WHERE name='neon.max_cluster_size';"
-> 512   (MB)
```

Production was 15 MB before any of this. A 200-file probe put 217,868 rows in
and took it to 65 MB — about **230 bytes per row**, so the full 28.4M rows
project to **roughly 6.5 GB against a 512 MB cap, 12.8x over**. The import would
have died around 1.9M rows, some 7% in. Worse than dying: a Neon project that
exceeds `max_cluster_size` goes **read-only**, which stops the collector — and
the collector is the one thing that must not stop, because Binance deletes these
endpoints after about 30 days and a missed window is gone for good.

**2. Nothing in production reads it.** `FlowSample` is WRITE-ONLY there:
`FlowCollectorService.store` calls `createMany` and that is the only production
code touching the table. No controller queries it (auth, risk-management,
analyses and health are the four, and none mention it), no raw SQL touches it
(`$queryRaw` appears once, as `SELECT 1` in the health check), the web app has
zero references, and the Lambda's only flow entrypoint is `collector.collect`.
The sole reader anywhere is `scripts/flow-verify.ts`, which is a local tool.

So five years of history in Neon would cost 6.5 GB to serve nobody.

### What that means operationally

- **The archive lives in the LOCAL database** (`.env.local`,
  `postgresql://…@localhost:5433/meridian_db`, the `meridian-postgres` Docker
  container on the `infra_postgres_data` volume). 28,413,765 rows, 4.8 GB.
  Every experiment — `volsignal.ts`, `backtest-plans.ts`, the decile harness —
  already runs locally, which is where the data now is.
- **Production keeps collecting forward — but the 5m change put it on a clock.**
  Three metrics now collect at 5m and two at 1h: `288x3 + 24x2 = 912` rows per
  coin per day, **9,120 rows/day** for ten coins. At the measured 241 bytes/row
  that is **62.8 MB/month, 764 MB/year** — and from today's ~15 MB it **fills
  the 512 MB cap in about 7.9 months**.

  Before the 5m change it was 960 rows/day and 80 MB/year: roughly six years of
  headroom. **The density fix cut the runway from ~6 years to ~8 months.** That
  is the right trade — the archive join needs 5m and the seam is real — but it
  is a deadline, not a footnote.

  Two levers when it approaches, in order: **drain Neon into local and truncate**
  (the archive lives locally anyway, so this is the natural rhythm and costs
  nothing), or **intern `metric` to a small int**, which the size breakdown says
  is worth roughly half the bytes. Raising the plan is the third option, not the
  first. Do NOT reach for `DEFAULT_BACKFILL_DAYS` — a smaller window re-fetches
  fewer rows but stores exactly the same ones, so it changes nothing here.
- **The two databases are not replicas and must not be confused.** Local holds
  archive + whatever it has been given; Neon holds the live forward collection
  only. They share a schema and a convention, so a row from either is directly
  comparable — that was the point of the shift rule.
- **To rebuild the local archive from nothing** (the downloaded files are NOT in
  git, and `test/manual/results/` is ignored):

  ```
  # 1. fetch, ~203 MB, ~15 min, verifies every .zip against its .CHECKSUM
  #    (the fetch script lives with the probe artefacts, not in the repo)
  # 2. docker start meridian-postgres && npx prisma migrate deploy
  # 3. npx ts-node --transpile-only scripts/flow-import.ts --dir <archive>
  # 4. npx ts-node --transpile-only scripts/flow-verify.ts --live <live.json.gz>
  ```
  Step 3 takes about 42 minutes and is idempotent; step 4 must print 60 PASS.

**If production ever does need to read this table**, the fix is not a bigger
plan. It is `metric` interned to a small int — the primary key is 2.4 GB of the
4.8 GB largely because a ~19-character string is stored 28 million times. That is
a real inefficiency worth fixing on its own merits, and it is not done.

### Known unknowns — recorded, not resolved

- **Point-in-time is unestablished.** Historical files have been rewritten years
  after their dates (the 2020-09-01 BTC file was last modified 2026-03-18). That
  proves REGENERATION, not restatement, and one session cannot tell them apart
  without a prior copy. The only evidence is the live overlap, which is clean to
  the bit on open interest. An ETag + size baseline for six dates spanning
  2021-2026 is saved with the probe artefacts; re-check it in a month.
- **Licence is undocumented.** No terms, README or licence file exists anywhere
  in the bucket, and `https://data.binance.vision/terms` is a 404. The data is
  public and unauthenticated. Personal research is the assumed use. Recorded,
  not resolved.
- **Publication lag is being measured, not guessed.** A 24-hour poller records
  the newest bar each endpoint will serve, every three minutes, on two coins.
  One sample is not an embargo rule. The embargo itself is FEATURE
  CONSTRUCTION, not import — it belongs in the harness beside `completedAsOf`,
  enforced and tested the same way, and it is not built yet.
