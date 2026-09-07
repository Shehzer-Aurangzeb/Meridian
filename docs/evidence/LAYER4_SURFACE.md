# Layer 4 — the API and presentation

Run 6 September 2026. Bars pre-registered in
[`../PRODUCT_LAYERS.md`](../PRODUCT_LAYERS.md) Layer 4.

**4b PASS. 4c PASS. 4d FAIL under synthetic load, and the failure is upstream.
4a NOT RUN — it needs a person, and cannot be self-certified.**

---

## What the surface serves

```
GET  /map/:symbol                one payload for the whole screen
GET  /map/:symbol/zones | /regime | /liquidity | /shelf-map
POST /map/:symbol/condition      historical analogues, never a simulation
GET  /calibration                how every output has actually performed
GET  /calibration/:output
```

One aggregate because the Lambda ceiling is 120 seconds and a cold start
spends part of it before any handler runs. Six round trips to build one screen
is how a slow start becomes a failed page.

**Three of the four probabilities are permanently null**, each with the
measurement that produced the decision attached:

| field | why |
|---|---|
| `zones[].bounceWithin4h` | Brier worse than the base rate; all twelve bucket keys within 3.7 points of each other |
| `regime.exitWithin24h` | ECE 5.06 against a bar of 5.00, driven by trend persistence drifting between train and holdout |
| crowding / unwind | conditional 11.7% against an 11.1% base rate |

## Bar 4b — the contract. PASS.

22 assertions in `src/map/map.contract.spec.ts`, in the normal suite. A
contract that only holds when someone remembers to run a manual script is not
a contract.

```
n < 200 returns null                      publish() has no branch that emits a
                                          value below the minimum
every probability carries n               Probability = Calibrated | Withheld;
                                          there is no shape carrying a bare number
beyond +-5% is a 400, not a clamp         "not extrapolated" is in the message
warning on few matches OR few blocks      150 matches inside 40 days still warns
```

The clustered-evidence case is the magnitude gate's failure encoded as a test:
17 trades inside one 30-day block once produced an interval of `[2.62, 2.62]`,
zero width, that looked exactly like certainty.

## Bar 4c — the narrator states no direction. PASS.

Enforced twice, because a prompt instruction is a request and a guard is a
rule.

**In the prompt.** `MapNarrationService` keeps the audience constraint — the
reader is not a trader and reads English as a second language — and adds an
explicit prohibition naming the forbidden forms, with the reason: twenty tests
found no directional edge, so a sentence stating one is a claim the system has
measured and cannot make.

**At runtime.** `assertNoDirection` scans generated prose and DISCARDS it if it
states a direction. A failed narration is an optional extra the product does
without; a confident wrong sentence carries the authority of the screen around
it.

```
19 unit tests on the guard
  7 catch forecasts, instructions and objectives
 12 assert it does NOT fire on correct writing
```

That second group is the one that matters. "Over the long term", "as long as
the band stays narrow", "the move was short-lived", "in the short run", "a
shorter horizon" — a guard that flags those gets switched off by whoever
maintains it, and then it protects nothing.

Measured against the live prompt: **0 directional phrases** in its data
section.

## Bar 4d — latency. FAIL, and the number that matters is in the split.

```
assembly (cache warm)     p50 ~400ms across two independent runs
all calls, run 1          n=8   p50 395ms   p95 47,458ms
all calls, run 2          n=12  p50 420ms   p95 234,177ms
```

**Assembly is not the problem.** Nothing in `MapService` computes for ten
seconds; the p50 of ~400ms is the real cost of building the whole payload. The
tail is entirely time spent inside a retry after Binance rate-limited a tight
loop of identical requests — 12 calls, each making about five fetches, is 60
requests in a few seconds, which the production schedule (three runs a day)
does not resemble.

The bar as written is failed and is recorded as failed. Renegotiating it after
seeing the result is the one thing this project does not do.

### What the bar caught, which is the point of having it

`ExpectedMoveService.forUniverse` fetched its ten coins **sequentially** —
ten round trips in series inside a 120-second ceiling, where one slow response
pushes every remaining coin behind it. Now `Promise.all` over the universe.
That defect would not have surfaced without a latency bar.

### What is still unresolved

A deployed cold start adds container pull and Nest boot on top of the assembly
cost, and rate limiting under real traffic is untested. Both need a deploy to
measure. The honest position is that assembly has three orders of magnitude of
headroom against the ceiling and the upstream dependency does not.

## Bar 4a — the misreading test. NOT RUN.

**This cannot be self-certified and has not been.**

> Show the map screen to someone who has not read the design document. Ask what
> it tells them. If they state a direction, a target, or an entry, the layer has
> failed.

It requires a human subject. Building an automated proxy and reporting a pass
would be exactly the kind of number-that-looks-authoritative-and-is-not that
this product exists to avoid.

What the design does to earn a pass, so the test has something to measure:

- no arrows, entry markers, target lines, or any element a reader could act on
- the cone is drawn **symmetrically** and in one colour; an asymmetric or
  one-sided-shaded cone would state a direction
- support and resistance share a colour, because green-up/red-down quietly
  encodes a call — the label says which is which instead
- withheld probabilities render as an expandable **"not published — why?"**
  carrying the measurement, not as "—", which reads as a loading state and
  invites the reader to supply their own guess
- every screen links to `/calibration`, where three of four entries are
  failures shown as prominently as the pass

## Reproduce

```
pnpm --filter api test src/map/map.contract.spec.ts   # 4b
pnpm --filter api test src/ai/direction-guard.spec.ts # 4c
pnpm --filter api layer4-bars                         # 4c prompt side, 4d
```

`layer4-bars` provokes Binance rate limiting when run repeatedly. Leave a few
minutes between runs, or the latency tail measures the backoff rather than the
service.
