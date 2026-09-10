# The simulation prompt

Phase 0 of [`archive/SIM_JOURNAL_PLAN.md`](archive/SIM_JOURNAL_PLAN.md). Frozen
8 September 2026, extended 9 September 2026 with the PLAN block.

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

Reason in prose first, however you like. Then close each coin with this
block, on its own lines, using these exact labels:

PLAN
symbol: BTC
verdict: TAKE
direction: long
entry: 84120
stop: 82400
targets: 87000 @ 50%, 90500 @ 50%
why: one line, your reason
END

Rules for that block, because it is read by a machine:
- One block per coin, even for a SKIP.
- Plain numbers. No currency signs, no thousands separators, no ranges.
- A single price per target. If you want a zone, pick the number you would
  actually work the order at.
- Target percentages are how much of the position closes there, and they
  must add up to 100.
- The stop goes below the entry for a long and above it for a short.
- Entry, stop and at least one target are required. Do not leave them out,
  and do not write "market" — give the price you would use.
```

Followed by the map payload for one coin.

**The first three paragraphs are unchanged.** The PLAN block was added on
9 September 2026 and asks for no new judgement — it restates, in a fixed
shape, exactly the fields the journal already stored by hand. It names every
column of `SimTrade` a person used to type: verdict, direction, entry, stop,
targets with their weights, and one line of reasoning.

Two of the rules exist because of what the scorer does, not because of taste.
Weights are how much of the position closes at each target, so they must total
100 or the row is rejected. And a target price has to be a single number: a
range cannot be tested against a candle's high.

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

On `/log`, either by typing each row or by pasting the analyst's whole reply
into the box at the top and pressing **Fill the rows**. Keep the batch id — it
is the unit of evidence, and a batch that cannot be reassembled is ten unpaired
observations instead of one paired one.

## Reading a reply back automatically

`POST /sim/parse` sends the pasted text to Gemini and returns draft rows. It
needs `GEMINI_API_KEY`; without it the endpoint says so and the form is filled
by hand instead. Nothing else in the product depends on it.

**It is an extractor, not a second analyst.** The whole design rests on one
rule, and `sim.parse.ts` states it to the model in those terms: report only
what is literally written, and return null for anything that is not. It may not

- derive a stop or a target from a percentage, a risk/reward ratio or an ATR;
- take a price out of the market data or the commentary and use it as a field
  the analyst did not give;
- split weights across targets that were given none, or rescale weights so they
  total 100;
- turn a word like "market" into a number;
- correct a stop that sits on the wrong side of the entry.

A null arrives at the screen as an empty box and the row is listed under
"still needs an entry, a stop or a target". That is the point: a guessed number
scored in R afterwards is indistinguishable from one the analyst really gave,
and it would quietly become evidence.

The response is schema-constrained and read at temperature 0, but a schema only
makes a reply *shaped*. `normaliseRows` re-checks every field: non-finite
numbers become null, an unrecognised verdict or direction becomes null, a coin
outside the batch is dropped, and tickers are reduced to the bare symbol.

### SKIP with a plan attached

An analyst often marks a coin SKIP and writes out the plan anyway — the prompt
asks for exactly that. When it happens, **both halves are kept**: the plan is
extracted in full, and the verdict stays SKIP.

The verdict is never upgraded to TAKE. Taken-versus-passed, paired inside a
batch, is the only comparison this journal can honestly make, and moving a row
between the two arms is editing the result rather than recording it. If every
SKIP with a plan became a TAKE, the passed arm would empty out and the headline
delta would go null — the scoreboard would not be wrong so much as gone.

The row carries `planDespiteSkip`, and `/log` says so in plain words under that
coin. Changing the verdict is one click, and it is a person's call, not the
parser's.
