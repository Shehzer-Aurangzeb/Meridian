# The state of Meridian — 9 September 2026

What runs today. Every claim below was checked against the code in this
repository on the date above, not recalled. Where a number comes from a
research run rather than from code, it says which document holds it.

This document is deliberately short. The long ledgers are history now and live
in [`archive/`](archive/); the experiments and their bars live in
[`evidence/`](evidence/README.md).

---

## What Meridian is

A **market-state mapper**. It reads the market and describes what it is doing —
how far price is likely to travel, where the levels are, whether the market is
compressing, trending or ranging. It does not forecast direction.

It has never placed an order and contains no code that could: no exchange
authentication, no order endpoint, no request signing.

The pivot to this shape happened in commit `8be67bd`, and the directional trade
planner that preceded it was deleted in `a2056ff`. Twenty pre-registered
directional tests were run before that decision and none cleared its bar. The
reasoning is in [`archive/BRIEFING_FOR_REVIEW.md`](archive/BRIEFING_FOR_REVIEW.md)
and the design that replaced it is in
[`END_STATE_A_DESIGN.md`](END_STATE_A_DESIGN.md).

## The stack

| piece | what | where |
|---|---|---|
| API | NestJS, single Lambda behind API Gateway HTTP | AWS, container image, 120 s timeout |
| Database | PostgreSQL via Prisma 7 | Neon in production; Docker `meridian-postgres` on `localhost:5433` locally |
| Web | Next.js 14 App Router | Vercel |

## What the API serves

Four controllers: `auth`, `health`, `map`, `sim`.

```
GET  /map/:symbol              the whole reading
GET  /map/:symbol/zones
GET  /map/:symbol/regime
GET  /map/:symbol/liquidity
GET  /map/:symbol/shelf-map
POST /map/:symbol/condition
GET  /calibration              how every published number has actually done
GET  /calibration/:output
POST /sim                      record a batch of analyst calls
GET  /sim
GET  /sim/stats
GET  /sim/:id
```

`/map/:symbol` takes a `universe` parameter. It is not optional in practice:
the expected-move cone's tilt is standardised across whichever coins were
priced together, so a coin priced alone gets the untilted baseline — a weaker
number wearing the same shape.

## What the calibration page admits

Four outputs were tested. **One is published; three are withheld** and served
as nulls, with the reason attached:

| output | status |
|---|---|
| `expected-move-cone` | PUBLISHED |
| `zone-bounce-4h` | WITHHELD |
| `regime-exit-24h` | WITHHELD |
| `unwind-lift-24h` | WITHHELD |

This is the part of the product that makes the rest worth believing, and it is
why the map screen leads with the one number that earned its place.

## What the web app is

Five signed-in pages behind a single password:

| route | what |
|---|---|
| `/map` | the reading for one coin: chart, expected move, state, levels |
| `/log` | record one batch of ten analyst calls against ten readings |
| `/history` | the journal, and the scoreboard over it |
| `/history/[id]` | one call, with the reading it was given, frozen |
| `/calibration` | how every number has actually done |

## The simulated-trade journal

The map produces a reading; an outside analyst reads it and returns a plan. The
journal records both, freezes the reading alongside the call, and scores the
result once 96 hours have passed. Shipped in `456aa62`.

Ten coins per batch, and a coin the analyst passes on is recorded exactly like
one it takes. That is the whole point: the comparison the record can honestly
make is between the calls taken and the calls passed on **within one batch**,
which cancels whatever the market did that week. The headline figure is that
paired difference, resampled over 14-day blocks, and it is withheld entirely
below four blocks.

The prompt the analyst is given is frozen in
[`SIM_PROMPT.md`](SIM_PROMPT.md). It deliberately excludes the failure brief.

**What this cannot show:** whether an analyst can trade profitably. When that
was measured properly on a similar record the margin of error alone came to
0.318R, and 0.301 of that was the random comparison by itself. Any figure a
person can build by hand sits inside that range. See §7 of
[`archive/ROADMAP.md`](archive/ROADMAP.md).

## Known gaps

**Migrations are not applied in production, and nothing applies them.** There
is no `prisma migrate deploy` step anywhere in `.github/` or `infra/`. Three
migrations exist locally that `main` does not have:

```
20260905000000_add_book_profile
20260905010000_drop_trade_outcome_columns   ← destructive
20260908162407_add_sim_trade
```

The middle one drops the trade-outcome columns. The only surviving copy of the
843 forward-test rows those columns held is a local dump at
`~/meridian-archive/coordinator-run-20260905.sql`. Merging to `main` **is** the
deploy, so it must not happen before the migrations are applied by hand and
that dump is somewhere other than one laptop.

**Frontend work is open.** See [`FRONTEND_AUDIT.md`](FRONTEND_AUDIT.md).

**Everything under `archive/` and `reference/` that is not whitelisted in
`.gitignore` exists on exactly one laptop.** That is a real risk and it is not
solved.
