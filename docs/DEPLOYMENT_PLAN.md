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

### 1. ✅ DONE — `AnalyzeService` extracted from `test/manual/analyze.ts`

The full pipeline is currently assembled **only inside a test script**: the
coordinator runs there, then `LevelMapService.build`, then
`TradePlanService.buildPlans`. Nothing in `src/` composes those three. Lambda
cannot call it and neither can a route.

- [x] `AnalyzeService.analyze(symbol)` → `AnalysisRecord` — regime, route,
      checklist, squeeze, map, plans, timeframes, durationMs
- [x] `analyze.ts` is now a thin CLI over it; identical output, still no Docker
- [x] Same object is persisted AND returned by the API

Lives in `analysis-coordinator/` because it needs both legs and
`AnalysisCoordinatorModule` already imports `AnalysisModule` — the other
direction would be a cycle.

### 2. ✅ DONE — the whole analysis is persisted

Today the CLI writes JSONL and `CoordinatorRun` is written only by the old SSE
path — and what it stores (`coordinatorResult`) contains regime/route/checklist
but **not the level map or the plans**. The entire level leg is missing from
every saved row.

- [x] `CoordinatorPersistenceService.persistAnalysis()` writes the record into
      `coordinatorPayload`. No migration. Awaited, unlike `persist()` — a
      scheduled run that silently failed to save has done nothing at all.
- [x] ~~Invalidation price as a number column~~ **not needed.** `plan.stop`
      IS the invalidation price; `comeBackWhen` only formats it. And freshness
      is computed on read (item 4), so nothing queries it.
- [x] `run-log.ts` stays JSONL for the CLI, DB for the route. Deliberate: the
      CLI must run without Docker.

### 3. Scheduler — no code needed

`POST /analyses?symbol=BTC` is the entry point; the scheduler calls it once
per coin. Nothing to build here until there is a deployment target to
configure.

- [ ] EventBridge rule, 6–7×/day, coin list as config *(infra, not code)*
- [x] Runs without `--ai` by construction — the route never narrates.
      Narration is a caller's flag, not a pipeline stage.

### 4. ✅ DONE — freshness state

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

- [x] Three states in `freshness.ts`, **computed on read, never stored** — a
      stored state is wrong the moment it is written, and both inputs are free
      at read time (the chart fetches the price anyway; the newest row is one
      indexed query).
- [x] `INVALIDATED` outranks `SUPERSEDED`: price through the stop is
      definitive, structure moving on is not.
- [x] An analysis survives while ANY of its plans does — an invalidated long
      does not kill the short printed beside it.
- [x] `SUPERSEDED` = no zone survives within `SR_DEFAULTS.CLUSTER_THRESHOLD`
      (0.5%) in the newest map. Reused, not picked, so "the same zone" means
      the same thing here as in the clustering.
- [x] No TTL hardcoded anywhere. The 24h figure stays a documentation fact.

### 5. ✅ DONE — read routes

`analyses.controller.ts`, separate from the legacy `/analysis-coordinator`
routes (those stream a regime-leg-only result and predate the level map).

- [x] `POST /analyses?symbol=BTC` — run and save, returns `{ id, analysis }`
- [x] `GET /analyses?symbol=&limit=` — list, payload excluded (50 full level
      maps is a large response nobody reads)
- [x] `GET /analyses/:id` — full payload + `currentPrice` + `freshness`
- [x] 422 on rows that predate the level map, rather than scoring freshness
      off a payload with no plans in it
- [x] **Auth done** — see below. Every route requires a key except health.

### 6. Frontend (no backend work)

- [ ] `lightweight-charts` (TradingView's free library)
- [ ] Live price from Binance WebSocket **direct from the browser**
- [ ] Overlay: zones as bands, entries/stop/targets as lines, Fib anchor

The saved record already carries everything needed to draw this — zone edges
and sources, fib anchor, marks per timeframe, entries, stop, targets, spot,
ATR. It is already chart-ready.

---

### 7. ✅ DONE — auth (login + machine key)

```
  browser  ──POST /auth/login {password}──→  scrypt-verify vs MERIDIAN_PASSWORD_HASH
           ←──────{ token, expiresIn }────   HMAC-signed, 30d, stateless
           ──Authorization: Bearer <token>─→  ┐
                                              ├→ AuthGuard → handler
  cron     ──x-api-key: <key>───────────────→ ┘
```

Two credentials, one door, because they fail differently. A session token
expires and is issued against a password, so a browser can hold it without
ever holding the password. A static key never expires — exactly what a cron
needs and exactly what a browser must not have, since anything shipped to a
browser is readable in devtools and a static key read there is permanent
access.

**No JWT.** Nothing outside this API reads these tokens, and JWT's value is
that a *third party* can validate one. What would remain is its failure
surface: the `alg` header, which libraries have repeatedly been talked into
honouring as `none`. The format here has no algorithm field —
`v1.<payload>.<HMAC-SHA256>`, one rule, anything else rejected. Swap for
`@nestjs/jwt` the day an API Gateway authorizer needs to validate a token.

**No refresh token.** Access+refresh shortens the window on a stolen access
token and revokes sessions across many users. One user, one device: it buys a
token store, rotation and a revocation list to maintain. Rotating
`MERIDIAN_TOKEN_SECRET` is the log-out-everywhere button. Add refresh when
there is a second user, or when the token lives somewhere you do not control.

Setup — writes both env values:

```bash
npx ts-node src/auth/session-token.ts 'your password'   # >> .env.local
```

Verified over HTTP: login with the wrong password 401s, `/auth/me` 401s
unauthenticated and 200s with a token, a token with one character flipped
401s, and the legacy routes accept the same token.

### 7b. The guard itself

`ApiKeyGuard`, registered as a **global** `APP_GUARD` in AppModule. Global
rather than per-controller: a guard on the new routes only would leave every
legacy `/analysis-coordinator` and `/analysis/history` route open, which is
the same hole with extra steps. Opt OUT with `@Public()`, never opt in.

- [x] `x-api-key: <key>` or `Authorization: Bearer <key>`
- [x] **Fails closed at boot.** A missing or <16-char `MERIDIAN_API_KEY`
      throws on startup rather than disabling auth. "No key configured means
      everything is allowed" is how these guards end up protecting nothing.
- [x] Constant-time compare, both sides SHA-256'd first — `timingSafeEqual`
      throws on unequal lengths, so hashing makes a wrong-length key fail by
      value instead of through an exception path.
- [x] `@Public()` on health and the banner only. An uptime check that needs a
      secret is not an uptime check.
- [x] Throttler runs before it, so brute-force attempts are rate-limited
      before the key is ever compared.
- [x] `x-api-key` added to CORS `allowedHeaders` — without it the browser
      preflight blocks the request and you get a CORS error instead of a 401.
- [x] Swagger `addApiKey` so /docs can authorise.

Verified over HTTP against a booted server:

| request | no cred | wrong cred | correct cred |
|---|---|---|---|
| `GET /health/live`, `GET /` | 200 | — | — |
| `GET /analyses` | 401 | 401 | past the guard |
| `POST /analyses?symbol=BTC` | 401 | — | — |
| `GET /analysis/history/BTC` *(legacy)* | 401 | — | — |
| `POST /analysis-coordinator/coordinate` *(legacy)* | 401 | — | — |

**Two things this does not cover.** Swagger UI at `/docs` is served outside
Nest's guard chain, so the page itself is reachable without a key (the API
calls it makes are not). And `@Sse('stream')` is unusable from a browser now:
`EventSource` cannot set headers. That path is legacy and parked — if it is
ever revived it needs a query token or fetch-based streaming.

## Verified

`pnpm test` — 214 tests, 14 suites. Includes a DI-graph test that boots
`AnalysisCoordinatorModule` with Prisma overridden, because a missing provider
is a runtime failure Nest cannot typecheck. It caught two things on first run:
a `?limit=-5` that returned one row instead of the default, and the fact that
`CACHE_MANAGER` reaches `BinanceService` only via AppModule's `isGlobal` cache.

**Verified against a live database, 7 Aug 2026.** Full flow exercised end to
end: login → `POST /analyses?symbol=BTC` (201, 611ms, id returned, both plans
persisted) → `GET /analyses` (28 rows incl. 25 legacy) → `GET /analyses/:id`
(payload + live price + freshness `LIVE`). Error branches on real data: legacy
May row → 422, unknown id → 404, `symbol=../etc` → 400, `limit=abc` → default.
`/health` reports cache/binance/database all ok.

One bug found and fixed by that run: an unlisted symbol returned **500**.
`POST /analyses?symbol=NOTACOIN` answered "Internal server error" for what is
a typo — an outage signal for a caller mistake. Binance flags it with code
-1121, so both throw sites in `market-data.service.ts` now route through one
classifier that returns 404 for an unknown pair and leaves every other failure
a 500, since those are genuinely ours. The CLI gets the same readable message
instead of a stack.

## 8. ✅ DONE — legacy surface deleted

2,944 lines removed. Route count 22 → 12. Every deletion was provably dead,
not merely unused:

| deleted | why |
|---|---|
| `POST /analysis/analyze` | superseded by `POST /analyses`; sole writer of `TradeAnalysis` |
| `GET /analysis/history/:coin` | superseded by `GET /analyses?symbol=` |
| `GET /analysis/validate/:coin` | already carried `@deprecated Not consumed by frontend` |
| `SSE /analysis-coordinator/stream` | regime-leg only; unusable from a browser since auth (EventSource cannot set headers) |
| `POST /analysis-coordinator/coordinate` | regime-leg only, legacy Claude prompt |
| `POST /analysis-coordinator/portfolio-scan` | scanner not in the product |
| `GET /analysis/performance/*` | both data sources dead: `TradeAnalysis` (nothing writes it) and `aiPayload`/`aiAction` (null on every new row) |
| `ClaudeService`, `ClaudePromptService` | last consumers were the controllers above |
| `MultiTimeframeScannerService` | only consumer was the scan route |

That closes two long-standing debts by deletion rather than repair: the SSE
path that still used the legacy prompt, and `checklistResult.passed`, whose
only reader was `ClaudePromptService`.

`replay.ts` and `plan-replay.ts` consolidated into `src/common/replay/` —
`performance/` would otherwise be a folder named after a service that no
longer exists.

**Kept, though currently unused:** `/analysis/*` risk-management (6 routes —
position sizing, leverage constraints). Implemented, playbook-derived, and
plausibly wanted by the frontend. Unused is not the same as dead.

## 9. ✅ DONE — outcome scoring (the pass/fail badge)

`GET /analyses/:id` now returns `outcomes[]` alongside `freshness`, computed
on read from the same code the plan backtest uses (`findFirstFill`,
`scoreLadder`) — a badge scored differently from the harness would quietly
disagree with every number in STATE_OF_PLAY.md §14h.

```
PENDING   price has not reached the entry, still inside the fill window
MISSED    never reached it, and the window has passed
OPEN      filled, unresolved, marked to market
STOPPED / PARTIAL / ALL_TARGETS   with the realised R
```

`FILL_WINDOW_HOURS = 24` is measured, not guessed: across the 582 backtested
trades, 100% of plans that ever filled did so within 24h, median 3h.

Live, one hour after the analyses were taken:

```
LINK  LIVE  long:PARTIAL +0.19R · short:PENDING
AVAX  LIVE  long:PENDING · short:OPEN +0.00R
SOL   LIVE  short:OPEN -0.24R · long:PENDING
ETH   LIVE  short:OPEN +0.07R · long:PENDING
BTC   LIVE  long:PENDING · short:PENDING
```

## 10. ✅ DONE — /docs no longer mounted in production

`SwaggerModule.setup` sits outside Nest's guard chain, so `AuthGuard` cannot
protect it. Rather than bolt basic-auth middleware onto a page nobody needs
deployed, it is simply not mounted unless `NODE_ENV=local` or
`ENABLE_DOCS=true`.

## 11. Remaining: the Lambda handler

The compiled build is verified — `pnpm build` succeeds and `node dist/src/main.js`
boots, serves `/health/live` 200 and `/analyses` 401. What is not written is
the handler, because its shape depends on a decision not yet made:

- **`@codegenie/serverless-express`** — one handler file, one dependency,
  plain zip deploy. Standard for Nest.
- **AWS Lambda Web Adapter** — a layer or container image, **zero code and
  zero dependencies**: the same artifact runs locally and in Lambda.

Pick the deployment shape (SAM / CDK / Serverless / container) and the
handler follows in minutes. Writing it before that is scaffolding that gets
thrown away.

### Prod environment

```
MERIDIAN_API_KEY        machine credential for the scheduler
MERIDIAN_TOKEN_SECRET   session signing key — rotating it logs everyone out
MERIDIAN_PASSWORD_HASH  from: npx ts-node src/auth/session-token.ts '<pw>'
DATABASE_URL            Neon
CORS_ORIGINS            the Vercel domain
ANTHROPIC_API_KEY       only if something narrates
ENABLE_DOCS             omit
```

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
