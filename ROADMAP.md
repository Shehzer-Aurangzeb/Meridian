# Meridian — roadmap and parked work

Written 25 Aug 2026.

This file lives at the repo root on purpose. `.gitignore` line 39 ignores any
directory named `docs/`, which catches both `docs/` and `apps/api/docs/`. The
older files in `apps/api/docs/` survive only because they were committed before
that rule existed. Anything new put there would vanish. We have already lost
provenance once that way, so this is tracked instead.

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

### 2.1 Forward data collector — start immediately

The only item with a deadline.

Binance keeps roughly **30 days** of open interest, taker buy/sell volume,
long/short account ratio, and premium index. Every day we do not collect is a
day gone permanently. Funding and premium have about three years of history;
the rest do not.

This produces **zero signal today**. In 12–18 months it supports a real
train/test split on the inputs we actually wanted to study, rather than the
public indicators that turned out to be worthless. Nothing else on this list
gets harder by waiting. This one does.

### 2.2 Measure real execution cost — half an hour, no code, this week

Find two things: the actual fee tier at the venue we would trade, and the real
spread on the ten coins at the size actually traded. **This has never been
done.** Every number in the project rests on a modelled cost.

What we model now is 0.05% fee plus 0.02% slippage per side, so 0.14% round
trip (`apps/api/src/analysis-coordinator/outcome.ts:74`).

Why it matters: at a 1–3 hour hold the stop is roughly 0.7% wide, so cost lands
near **0.20R per trade**. If the true round trip is 0.21% instead of 0.14%,
short holds are dead by arithmetic before anyone writes code. An external
review already flagged that spot fees in Canada could be far higher than the
futures numbers we used (`docs/EXTERNAL_REVIEW_BRIEF.md:271`).

**This number gates everything after it.** Do it before 2.3.

### 2.3 Finer candles

Pull 1-minute or 5-minute history and rebuild the candle layer.

Bigger than it sounds. The zone map, the ATR, and every indicator assume 12h,
4h and 1h bars. Day-long holds are a consequence of that timeframe, not of the
trading rules. Nothing shorter can be tested until this exists.

### 2.4 Baseline measurement, before any new input

At the finer resolution, answer one question: **do 1–3 hour holds behave
differently from what we saw at 1h?**

This is the control. Without it, any later result cannot be separated from the
timeframe change itself. We already know from the live data that a market
regime change can flip a directional result completely — so an uncontrolled
comparison here would prove nothing.

### 2.5 Then new inputs, one at a time

Sequential testing against that baseline.

Before starting, write down **how many inputs will be tested** and **the kill
criterion for each**. Test twenty inputs individually and roughly one will look
significant on noise alone. That is how the original five-condition checklist
got built, and why it did not survive.

### 2.6 Optional — audit the zone map

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

`apps/api/src/analysis-coordinator/outcome.ts:74` — one flat 0.05% fee plus
0.02% slippage per side, applied identically to both.

In reality the entry legs are resting limit orders, which pay the lower maker
fee, and a stop-out is a market order, which pays taker. Per-order cost is not
modelled at all, so a three-leg entry is charged as if it were one order.

This is the same number 2.2 is meant to replace.

### Config provenance — load-bearing numbers with a broken citation

Three constants are picked, not derived, and they drive every result:

- `MAX_BARS = 72` — `apps/api/test/manual/backtest-plans.ts:126`
- `SLIP_PCT = 0.02` — `apps/api/test/manual/forward-test.ts:97`
- `FILL_WINDOW_HOURS = 24` — `apps/api/src/analysis-coordinator/outcome.ts:57`

**The citation problem is worse than reported.** `forward-test.ts` cites "§14h"
eleven times as the authority for its hold length, its cooldown, and its
marking convention. There is **no §14h** in `docs/STATE_OF_PLAY.md`. There is a
§14 — and §14c is a **retraction** of it, stating that §14's configuration "was
never written down, and cannot be recovered" and its headline number is
unreproducible (`docs/STATE_OF_PLAY.md:600-616`).

`forward-test.ts:36` also cites "STATE_OF_PLAY.md methodology rule 7" for the
claim that the unit of evidence is the month. Rule 7 in that file is about
never claiming zero fitted parameters (`STATE_OF_PLAY.md:656`). The file has
three separate "Methodology rules added" sections, each restarting its
numbering, so the citation is ambiguous as well as wrong.

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
- **Two unmerged research CLIs** — `5b6526e` (live audit) and `e87651c`
  (`--until` on the forward test). Command-line only; nothing in production
  reads them.
- **The `docs/` directory.** Everything in it is untracked and one `rm` from
  gone, including `STATE_OF_PLAY.md`, `HANDOFF.md` and `EXTERNAL_REVIEW_BRIEF.md`
  — the three files most of this roadmap's evidence comes from.
  **Do not delete anything there. Move it somewhere tracked or backed up first.**
  Note: the brief for this file said seven files were awaiting a decision. There
  are **fifteen** files plus a PDF in `docs/` today. The list of seven was not
  recorded anywhere, so it needs redoing.

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
