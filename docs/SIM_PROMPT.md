# The simulation prompt

Phase 0 of [`SIM_JOURNAL_PLAN.md`](SIM_JOURNAL_PLAN.md). Frozen 8 September 2026.

This is the exact text sent to the analyst, and it does not change between
batches. A prompt that drifts makes every batch its own experiment.

---

## The text

```
Act as an expert trading analyst. Below is an analysis my system produced.
Retrieve current information if you need any. Tell me the trade plan to put.

For any coin you would skip, still give the plan you would have placed, and
mark it SKIP.

I'm testing my system, so this trade goes into simulation.
```

Followed by the map payload for one coin.

**Variant A** was chosen: skipped coins still carry a plan. Without it a pass
has no entry, stop or target and cannot be scored in R, which leaves the
take-versus-pass delta — the only comparison this journal can actually make —
resting on realised move alone.

## What is deliberately absent

No summary of the twenty failed directional tests, and no statement that this
project believes direction is unpredictable. The question being asked is what an
analyst does with the map, not what it does when told the map's authors expect
nothing.

**One consequence, recorded because it is not obvious.** `MAP_DISCLAIMERS` is
part of the map payload, and its second entry reads:

> Twenty tests, each with its target set in advance, found nothing that predicts
> direction well enough to cover trading costs.

That is the failure brief, inside the data. So `disclaimers` is **excluded from
the pasted payload** while the stored snapshot keeps it. The snapshot records
what the system held; the paste records what the analyst was shown. They differ
by exactly this one field, always, and that is why it is written down here
rather than left to be rediscovered.

## Collecting a batch

```
pnpm --filter api sim-batch                      # the fitted ten
pnpm --filter api sim-batch --coins BTC,ETH,SOL  # a subset
pnpm --filter api sim-batch --out batch.txt      # to a file
```

Runs in-process against `MapService`, so it needs no server and no token. It
passes the whole universe to the cone, which is what makes the cross-sectional
tilt available — a single-coin call returns the baseline alone.

Each coin prints as its own block, ready to paste. Ask about all ten in one
conversation so the analyst sees the same market for every call, then record
what comes back against the `batchId` the script prints.

## Recording the answers

Until Phase 3 exists, by hand. Per coin: verdict, direction, entry, stop,
targets, and the analyst's own words. Keep the batch id — it is the unit of
evidence, and a batch that cannot be reassembled is ten unpaired observations
instead of one paired one.
