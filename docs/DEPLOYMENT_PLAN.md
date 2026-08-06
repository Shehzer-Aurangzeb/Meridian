# Deployment & Integration Plan

What has to exist before Meridian runs on a schedule and serves a frontend.
Written 6 Aug 2026. Status of the analysis engine itself: `STATE_OF_PLAY.md`.

---

## The goal, in one paragraph

A cron runs the analyst 6–7× a day across a few coins. Every run is saved.
Opening the app shows those analyses; opening one draws its levels, zones,
entries, stop and targets **on a live price chart**, so you can see with your
eyes whether the read was right. Each saved analysis carries a freshness state
so a two-week-old plan is never mistaken for a live one.

Scoring those saved analyses over months IS the forward test.

---

## Architecture

```
EventBridge (cron)  ─┐
                     ├──→  Lambda  ──→  AnalyzeService  ──→  Postgres (Neon)
API Gateway routes  ─┘      │                │
                            │                └─ coordinator → level map → plans
pnpm analyze (local) ───────┴──→ AnalyzeService

browser ──→ Binance WebSocket (live price, no backend involved)
```

**One Lambda, many routes.** Routes are a switch inside one function, not one
function per route. `/analyze` runs the whole pipeline in-process and calls no
other route — route-to-route over HTTP re-invokes Lambda, pays twice, and adds
a cold start.

**The pipeline is a SERVICE, not a route body.** The CLI and the Lambda must
call the same code or a saved analysis cannot be reproduced locally.

**Split a route out only when it earns it.** Narration can run 60s+ and would
hit API Gateway's hard 29s timeout — that one goes async or gets its own
Function URL.

### Database: keep Prisma, host on Neon

Not DynamoDB. Prisma supports relational + MongoDB only, so Dynamo means
deleting the schema that already fits:

- `CoordinatorRun.coordinatorPayload` is a **`Json`** column — the level map
  and plans store with **no migration**.
- `expiresAt` already exists for the freshness state.
- `@@index([symbol, createdAt])` is exactly the frontend's list query.

Neon is serverless Postgres over HTTP, so Lambda needs **no VPC** — which is
what makes it free rather than $48/month.

### Cost

| item | $/month |
|---|---|
| Lambda + API Gateway + EventBridge (~600 req) | ~0 |
| Neon free tier (0.5 GB; ~5 MB/month used) | 0 |
| Claude narration, ~$0.065/run | only on runs that use `--ai` |
| *(rejected)* RDS t4g.micro public | ~15 |
| *(rejected)* RDS private + NAT Gateway | ~48 |

---

## ⚠️ Verify before building anything

`market-data.service.ts` calls `api.binance.com`, which returns **HTTP 451 to
US IP ranges**. It works from a laptop; that says nothing about an AWS region.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.binance.com/api/v3/ping
# run from CloudShell / EC2 in the TARGET region
```

`200` → proceed. `451` → pick a non-US region, or `api.binance.us` (different
symbols, **no futures endpoints, so funding rates die**), or a proxy. This
constraint reaches back into which features survive, so it is question one.

Same trap kills the cheaper GitHub-Actions-cron alternative: its runners are
US-based.

---

## Build list

Ordered. Item 1 unlocks 2, 3 and 5.

### 1. Extract `AnalyzeService` from `test/manual/analyze.ts` ← blocks everything

The full pipeline is currently assembled **only inside a test script**: the
coordinator runs there, then `LevelMapService.build`, then
`TradePlanService.buildPlans`. Nothing in `src/` composes those three. Lambda
cannot call it and neither can a route.

- [ ] `AnalyzeService.analyze(symbol)` → `{ regime, route, checklist, squeeze, map, plans }`
- [ ] `analyze.ts` becomes a thin CLI over it (printing stays in the CLI)
- [ ] Same object is what gets persisted and what the API returns

### 2. Persist the whole analysis

Today the CLI writes JSONL and `CoordinatorRun` is written only by the old SSE
path — and what it stores (`coordinatorResult`) contains regime/route/checklist
but **not the level map or the plans**. The entire level leg is missing from
every saved row.

- [ ] Write the item-1 payload into `coordinatorPayload` (no migration needed)
- [ ] Add the invalidation price as a **number column** — it currently exists
      only inside the `comeBackWhen` prose string, so nothing can query it
- [ ] Point `run-log.ts` at the DB, or keep JSONL as the local fallback

### 3. Scheduler

- [ ] EventBridge rule, 6–7×/day, coin list as config
- [ ] Runs **without** `--ai` — narration is a read-for-you feature and paying
      to narrate analyses nobody reads is spending for nothing

### 4. Freshness state

Two clocks, both needed:

- **State clock (built, not wired):** every plan already prints
  `invalidated on a close below X`. Store X, check it on read.
- **Time clock (measured):** from the 582-trade plan backtest —

  | | |
  |---|---|
  | median time for price to reach the zone | **3h** |
  | filled within 12h | 82% |
  | filled within 24h | 100% |
  | median hold once filled | 13h |

  An analysis older than ~24h is finished. 7 runs/day ≈ one per 3.5h, which
  sits right on the median — the cron cadence is well matched.

- [ ] Three states: `LIVE` / `INVALIDATED` / `SUPERSEDED`
- [ ] `SUPERSEDED` = its zones no longer appear in a freshly built map.
      **Do not hardcode a TTL** — measure zone half-life off the plan backtest
      and use the real number.

### 5. Read routes

- [ ] `GET /analyses?symbol=&from=` — list (index already supports it)
- [ ] `GET /analyses/:id` — full payload for the chart
- [ ] Check what `history.controller.ts` already covers

### 6. Frontend (no backend work)

- [ ] `lightweight-charts` (TradingView's free library)
- [ ] Live price from Binance WebSocket **direct from the browser**
- [ ] Overlay: zones as bands, entries/stop/targets as lines, Fib anchor

The saved record already carries everything needed to draw this — zone edges
and sources, fib anchor, marks per timeframe, entries, stop, targets, spot,
ATR. It is already chart-ready.

---

## Known debt, not blocking

- SSE/REST still calls the legacy `analyzeWithChecklist`, not
  `AnalystNarrationService` (no provenance check on that path).
- `EntryChecklistResult.passed` still holds the retired 3-of-5 verdict; only
  the legacy prompt reads it.
- Five overlapping planning docs want folding into one.

## What deployment does NOT answer

The plan backtest says the printed plans are **flat gross, negative after
costs, and not distinguishable from zero** (`STATE_OF_PLAY.md` §14h). Saving
analyses and watching them on a chart is operational validation — it proves
the live path does what the harness assumed and catches wiring rot. It will
not find an edge the 582 backtested trades missed, because three months of
live running yields ~20–40 trades, which is *less* statistical power, not more.

The value here is the tool being usable and honest, not the tool being proven
profitable.
