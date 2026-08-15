# Meridian

A systematic crypto market analyst. It reads live market data, builds a complete
trade plan the way one specific trading playbook would, and explains its
reasoning in plain language — with every number it quotes computed in
TypeScript, never by the language model.

![A completed analysis — DOT short, laddered entries, ATR stop, targets in R](assets/screenshots/04-analysis-detail.png)

*Every figure above — the zone, the stop, the R multiples, the regime read — is
computed in TypeScript. The model is only allowed to explain them.*

---

## What it is

Meridian answers one question for a coin: **what does the market look like right
now, and what would a disciplined plan be?**

For every symbol it produces:

- **Structure** — multi-timeframe support/resistance, merged into confluence
  zones, with the distance from spot to each zone
- **A regime read** — compression, trending, or mean-reverting, which decides
  which strategy applies
- **A complete plan** — a laddered entry, an ATR-anchored stop, three targets
  with weights, position risk, and the blended reward-to-risk
- **A verdict, with its reasons** — each entry condition marked met or unmet
  *with the value that decided it*, and if it isn't tradeable, the specific
  price that would change that

It says **short** as readily as long, and it says "not yet, come back at $X"
rather than manufacturing a signal.

## What it is not

**It is not a validated-profitable trading system, and it is not financial
advice.** It is an analysis tool that applies a fixed playbook consistently and
shows its work.

That distinction is deliberate, and the measurement section below is why.

![Dashboard — ten coins analysed automatically every eight hours](assets/screenshots/01-dashboard.png)

---

## The design decision that matters

**Deterministic TypeScript owns every number. The language model owns only
interpretation and narration.**

Indicators, swing detection, level clustering, ATR stops, position sizing and
R:R are all computed in plain TypeScript — same input, same output, every time.
Claude receives those numbers and writes the explanation. It is never asked to
calculate anything.

This is enforced, not merely intended. Every price in the model's output is
parsed and checked against the set of computed levels, and narration that quotes
a price the engine never produced is rejected at parse time:

```ts
// apps/api/src/ai/analyst-narration.service.ts
throw new PriceProvenanceError([...new Set(invented)], allowed);
```

A hallucinated support level is a wrong number in a trade plan. Making that a
hard failure rather than a warning is the single most important choice in the
codebase.

---

## Measuring it honestly

The interesting half of this project is the measurement harness, and the result
it produced.

The repo contains a research stack that replays the **exact plans the tool
prints** against historical data — not a simplified proxy of them:

- **Look-ahead is structurally prevented.** Every historical decision is built
  only from candles that had *closed* at that moment (`completedAsOf` requires
  `open + duration <= decision time`). A forming 12h candle already contains
  the next ten hours; including one is the classic way to build a backtest that
  cannot lose.
- **Holdout discipline is enforced by the argument parser**, not by good
  intentions. The newest 30% of history is dropped at load, and the holdout
  cannot be reported without naming a single arm in advance — because a holdout
  that reports every arm has already been spent.
- **Confidence intervals come from a block bootstrap over calendar time.** Ten
  coins inside one week are closer to one observation than to forty.
- **Every non-trivial component has a failing-on-leak self-check** — including
  tests built so that a *broken* implementation inverts the answer rather than
  quietly passing.

### The result

Across **three years, ten coins and ~6,000 simulated trades**, the confluence-zone
core shows **no demonstrated edge**. Counter-trend entries are a coin flip gross;
costs do the rest. Several promising-looking findings were tested and retracted
when the holdout or a control killed them.

That is written here on purpose. Most trading repositories advertise a backtested
return. This one advertises a measurement stack rigorous enough to return a null
and a maintainer willing to publish it.

![History — every analysis, its fill status, and net R after costs](assets/screenshots/03-history.png)

Analyses are logged as they are produced, so live results accumulate against the
plan that was actually printed at the time.

---

## Running it

The analysis path is a single command and needs no database and no Docker:

```bash
pnpm analyze BTC                 # structure, regime, plan, verdict
pnpm analyze ETH --balance 10000 # size the plan against a real balance
pnpm analyze SOL --ai            # add the Claude narration leg
```

**The symbol is the only argument.** The playbook decides the timeframes,
indicators and parameters — there are no knobs to tune per run, by design.
Passing an arbitrary ATR timeframe moved blended R by 10× on identical zones
(0.09R on 1d vs 3.61R on 1h), so a timeframe nobody chose deliberately is a
correctness problem rather than a convenience.

The deterministic analysis runs on its own; `--ai` adds the narration layer.

![Starting an analysis from the web app](assets/screenshots/02-analysis.png)

### Full stack

```bash
pnpm install

cp apps/api/.env.example apps/api/.env.local   # add your keys

# Postgres, only needed for the API + web app
docker run -d --name meridian-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=meridian_db -p 5433:5432 postgres:16-alpine

pnpm db:migrate
pnpm dev
```

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/meridian_db
ANTHROPIC_API_KEY=...
```

### API

```http
POST /analysis/analyze
{ "coin": "BTC", "timeframe": "4h" }
```

---

## Tech stack

| | |
|---|---|
| Backend | NestJS (TypeScript), deployed to AWS Lambda |
| Frontend | Next.js, Tailwind CSS |
| Database | PostgreSQL + Prisma |
| AI | Claude API (narration only) |
| Market data | Binance |
| CI/CD | GitHub Actions → Lambda |

## Project structure

```
apps/
├── api/                 # NestJS backend
│   ├── src/             # indicators, levels, regime, plans, narration
│   └── test/manual/     # the research harness (backtests, holdout, studies)
└── web/                 # Next.js frontend
packages/
└── shared/              # shared TypeScript types
```

The research tools in `apps/api/test/manual/` are standalone and deliberately
**never wired into the analysis path** — a measurement tool that can influence
what it measures is not a measurement tool. Each has a `--self-check`:

```bash
npx ts-node test/manual/holdout.ts --self-check
```

---

## A note on `docs/`

Design notes, research logs and reference material live in `docs/`, which is not
published. Code comments referring to `docs/STATE_OF_PLAY.md` and similar point
at those local working notes — the code stands on its own without them.

---

*Personal, non-commercial project. Nothing here is financial advice.*
