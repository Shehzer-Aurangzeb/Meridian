# Meridian v2 — The Systematic Analyst

**Drafted 3 Aug 2026**, after four measured hypothesis failures (`STATE_OF_PLAY.md` §14c–§14e).

---

## 1. The one-line change

**Before:** "Here is a trade. Score 60/100, TACTICAL_SETUP. Entry $22.40, stop $21.10, TP $24.90."

**After:** "Here is what I see, what the market is doing, how much you could risk, and when this becomes interesting. You decide whether to trade it."

The tool stops claiming an edge it does not have, and starts doing the part it can actually do correctly. It becomes a **systematic analyst**, not a systematic trader.

## 2. Why — and what specifically is being dropped

Four hypothesis families were measured against random controls with month-clustered inference. None survived:

| hypothesis | result |
|---|---|
| checklist as scanner | no edge vs random longs (§14c) |
| checklist as confirmation filter | structurally unreachable; mis-wired (§14d) |
| zone-arrival location | **significantly worse** than random (§14d) |
| cross-sectional momentum, long/short | no edge; below its random control (§14e) |

The claim being dropped is narrow and precise: **that this system can predict direction.** Not "technical analysis is useless," not "no edge exists in crypto." Just that we tested four ways of extracting one and found nothing, and continuing to guess costs real money.

**The critical asymmetry:** a *descriptive* claim is cheap to verify — a level either held or it didn't, a regime either was compressed or wasn't, a 1% risk cap either capped the loss at 1% or it didn't. A *predictive* claim needs hundreds of independent observations and survives almost nothing. We spent a day proving the second half of that sentence.

## 3. The four capabilities

### 3.1 Level engine — "what do I see?"

Marks confluence zones: swing structure, playbook Fibonacci (0 / 0.25 / 0.5 / 0.75 / 1.0), levels that have held more than once, and where several of those agree inside a narrow band.

**Status:** partially built, and carrying a bug that is now P0 rather than a curiosity.

- Finding D (§6): `identifyKeyLevels` snaps swings onto a grid anchored to *current price* and measured from zero, so a **0.07% price move changed the nearest level from "support, 4 touches" to "resistance, 1 test."** When levels were an input to a score, that was instability in a signal we didn't trust anyway. **Now the levels *are* the product**, so non-reproducible levels are a correctness bug, not noise.
- §14d found the checklist's internal S/R agrees with a proper confluence-zone engine **1.2% of the time**. Two level systems coexist in the codebase and contradict each other. One must go.
- The zone work in `zonetest.ts` skipped the clustering + `MIN_TOUCHES ≥ 2` filter that both `SR_DEFAULTS` and the playbook ("support that held multiple times", p52) specify, leaving the level set ~4–5× denser than a human would mark. That was a caveat on a dead experiment; here it is **product work**.

**To do:** one level engine, swing-clustered, touch-counted, anchored to a fixed reference rather than to current price, with a stability test asserting that a sub-0.1% price move cannot change the marked set.

### 3.2 Regime description — "what is the market doing?"

Compression / trending / mean-reversion, from BB bandwidth percentile and ADX. **Status: built and working.** Nothing changes except the framing — it describes rather than routes to a signal.

Worth keeping honest: regime *description* is not regime *prediction*. "Bandwidth is in the bottom 15% of its 6-month range" is a fact. "Therefore a breakout is coming" is not, and we never tested it.

### 3.3 Position sizing and risk — "how much?"

1–2% risk rule, stop placement, R-multiple arithmetic, leverage caps, liquidation distance. **Status: built, and the most defensible code in the repo** — it is arithmetic, so it is either right or wrong, and it can be unit-tested to certainty.

Playbook corrections from §14d apply here: the stop is **level − 1.0×ATR(14)**, anchored to the level, not `entry − 1.5×ATR`. Scaled entries are **20/20/60**.

### 3.4 Journal and replay — "how did I do?"

Log the plan the user actually took, replay real candles against it, report what happened. **Status: `PerformanceService` already does the replay** (`PENDING_FILL → OPEN → TARGET_HIT / STOPPED_OUT`) — it was built as forward evaluation and needs only to be pointed at user-entered plans instead of machine-generated ones.

This is the only component that can eventually answer whether the tool helps: it measures *the user's* decisions over time, not the tool's predictions.

## 4. What gets deleted

| delete | why |
|---|---|
| `ChecklistService` 5-point score | no edge in either direction, four ways (§14c–e) |
| tiers: `WATCHING` / `TACTICAL_SETUP` / `STRATEGIC_TRADE` / `APEX_SETUP` | thresholds tuned on top of the three §4 wiring bugs; `APEX` fired **0 times** in every run ever |
| `ContinuousChecklistService` | the A/B it existed for is settled — resolution was never the problem |
| entry-signal generation and `shouldInvokeAI` gating on score | there is no signal to gate |
| the checklist's internal price-anchored S/R | contradicts the level engine 98.8% of the time (§14d) |
| "tradeable / not tradeable" as a *verdict* | becomes a description of distance-to-zone instead |

Note `SqueezeBreakoutService` also goes as a *signal*, but its 20-candle envelope is a useful **description** of where a range is — keep the calculation, drop the trigger.

## 5. The output

The original product spec survives intact — which is the encouraging part. What the user always wanted was *"tell me why not, and when to come back."* That was never a prediction. It falls straight out of a level engine:

> **AVAX — $22.40.**
> **What I see:** nearest confluence zone $19.80–20.10 — 0.5 Fib, 4h support held 3×, trendline. 11.6% below spot. Next resistance $23.40, then $24.90.
> **Market:** trending (ADX 31), bandwidth 42nd percentile. Not compressed.
> **If you take a long at the zone:** stop $19.20 (zone low − 1×ATR), risk 4.4% of entry. At 1% account risk that is 0.23 units. First target $23.40 = 1.9R.
> **Come back when:** price is within 2% of $20.10, or the zone invalidates on a close below $19.20.

Every line is checkable after the fact. None of it claims to know what happens next.

## 6. Constraints the measurements handed us

Two findings from the dead experiments that shape this product:

1. **Breakeven round-trip cost 0.309% at 48% weekly turnover** (§14e). Any high-turnover approach needs sub-0.31% execution, and retail spot fees of 0.5–0.8% exceed that. **The analyst design sidesteps this entirely — it has no turnover**, because it doesn't trade.
2. **The equal-weight top-100 alt universe lost 0.436%/week** while majors rose (§14e). This qualifies §14's "frequency comes from breadth": widening the universe adds decay along with opportunity. For an analyst tool, breadth is still fine — describing 100 coins costs nothing and risks nothing — but it should not be sold as a route to more *trades*.

## 7. How we would know this is working

The harness changes job: **validate risk rules and stability, stop hunting for edge.**

| claim | test | verdict standard |
|---|---|---|
| levels are reproducible | perturb price by <0.1%, recompute | marked set must not change |
| levels are meaningful | across history, do marked zones see more reactions than random price bands? | frequency of touch-and-reverse vs random bands — *descriptive*, month-clustered |
| regime labels are stable | recompute across adjacent bars | label must not flip on noise |
| sizing is correct | given entry/stop/account, realised loss when stopped | must equal the stated risk %, to the cent |
| the tool helps the user | journal, over months | user's own expectancy, tracked honestly |

Row 2 is the one genuinely interesting open question, and note how much weaker a claim it is than anything we tested today: *do levels attract reactions more than arbitrary prices?* That is a property of price structure, not a forecast, and if it fails the level engine is decoration.

Row 5 is the only real answer, and it takes months. That is the honest cost of this pivot.

## 8. Migration order

1. **Delete** the score, tiers, and the checklist's S/R (§4 of this doc). Smallest diff, removes the false claim immediately.
2. **Unify the level engine** — one implementation, swing-clustered, touch-counted, fixed anchor, plus the stability test.
3. **Reframe the output** to the §5 format; the Claude call becomes explanation of computed facts rather than trade-plan generation.
4. **Point the journal** at user-entered plans.
5. **Run row 2** of §7 — the only remaining empirical question worth asking.

Steps 1 and 3 are what stop the tool from lying. Everything else is improvement.

## 9. Honest closing note

This product is **not validated either.** We have not shown that a human trades better with it. What we have shown is that its claims are the kind that can be checked cheaply, and that the previous claim could not survive checking.

Four honest failures with a working measurement stack is a better position than one unfalsified hope. The tools (`backtest.ts`, `zonetest.ts`, `panel.ts`, `bootstrap.ts`, all self-checking) are the durable asset, and they are what make the next claim checkable too.
