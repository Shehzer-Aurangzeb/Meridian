# Meridian — hierarchical timeframes: pre-registration

**Written 27 Aug 2026, before any code. Nothing in Part A is edited after
seeing a result.**

## Why this exists

Seven charts pooled measured worse than three charts pooled: edge over random
+0.064R → −0.066R, 2.6× the bar, wrong direction. The mechanism was measured,
not guessed — planned R fell 2.26 → 1.73 because more zones put the next zone
closer, so every target moved nearer while the stop stayed pinned at one
ATR(4h).

That is not a verdict on multi-timeframe analysis. It is a verdict on **pooling**
— treating a weekly swing high and a 15-minute swing high as two equal votes in
one price-proximity cluster.

They are not the same object. A weekly level is where positions were built and
defended over months. A 15-minute level is where price paused for an hour. No
trader would set a target at a 15m level while trading a 12h setup.

## Primary metric

**Edge over random.** One metric, and every verdict row below is written against
it. The last pre-registration named a primary and then wrote its verdicts
against a secondary; that drafting error is not repeated here.

| config | edge over random | planned R |
|---|---|---|
| 3 charts pooled | +0.064R | 2.26 |
| 7 charts pooled (current) | −0.066R | 1.73 |

## Verdict rows — decided now

| result on edge over random | verdict | action |
|---|---|---|
| ≥ +0.064R | BETTER | keep hierarchical, proceed to volume |
| +0.020R to +0.064R | NEUTRAL | keep hierarchical (structurally sound), proceed to volume |
| < +0.020R | WORSE | revert to 3 charts pooled, proceed to volume anyway |

**Volume comes next regardless.** This experiment decides which level engine to
build it on, not whether to continue.

## Secondary observations — recorded, not deciding

- **Planned R.** Must recover toward 2.2+. If it stays near 1.73, the HTF-target
  rule did not land and the result is uninterpretable — report that rather than
  the verdict.
- Weekly marks per map. Currently ~1 in 50. Should rise materially.
- Trade count, win rate, stopped-out share, bars held, cost per trade.

## Prediction, on record

Planned R recovers to 2.2+. Edge over random lands **NEUTRAL** — roughly the
three-chart number, not better. Better structure, same null.

Reasoning: this fixes how price shape is *organised*, not what class of
information it carries. Swing highs and lows are visible to everyone and have
tested empty four independent ways. A fairer representation of the method should
undo the pooling damage and stop there.

**If it comes back BETTER, be suspicious before being pleased.** Check that the
random control moved too — the control has swung more across revisions than the
strategy has, and it is the weakest instrument in the rig.

## Scope caveat

Three coins, one 80-day window, one seed. Enough to reject a change, not enough
to accept one. A BETTER verdict means "worth carrying forward", not "proven".
