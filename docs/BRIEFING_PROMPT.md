# The prompt

Copy everything inside the block and paste it with
`BRIEFING_FOR_REVIEW.md` attached.

---

```
I have a systematic crypto analysis system called Meridian. Over about six weeks
I have run nineteen pre-registered directional tests against it and not one has
cleared its bar. I want your honest read on whether this is fixable, and how.

The attached document is a full briefing: what runs in production, what is
deprecated, every test and its result, the data I hold, and the methodology rules
each defect taught me. Read it before answering. It is deliberately written not to
oversell — the whole point is that the system does not currently have an edge.

THE SHORT VERSION

I can find information. I cannot find information big enough to pay a fee.

Seven Binance feature families clear |t| > 3.0. Cross-venue price dislocation
clears at |t| = 9.77. Combining them with ridge gives 1.01 basis points per
trade. Gradient-boosted trees give 0.34. A round trip costs 14 bp taker, 3.6 bp
maker. And a fill simulation on 1-minute bars showed the gross is negative over
3.1 years anyway, so a cheaper fee does not help.

WHAT I WANT

Two end states are acceptable and I would be happy with either:

  A. An analysis I can trust. The tool describes the market accurately and its
     outputs are calibrated. It does not have to predict returns. It has to be
     honest and useful.

  B. A system with a real edge that survives costs out of sample.

I am open to changing anything — features, timeframes, target, universe, bar
size, the whole technique. Nothing in the current approach is sacred. If the
right answer is "drop the confluence-zone framing entirely and do X", say that.
If the right answer is "there is no retail edge in this data, go build A", say
that too and tell me what A should look like.

RULES FOR YOUR ANSWER

1. Price every proposal in BASIS POINTS against a 14 bp round trip. Not in
   t-stats, not in information coefficients. Section 3 of the briefing has two
   cases where |t| > 6 came with a flat or inverted money profile, so a t-stat
   alone is not evidence here.

2. Say what would FALSIFY your proposal, before it runs.

3. Do not violate any rule in section 5 of the briefing. Each one came out of a
   real defect that produced a confident wrong answer.

4. Be honest about effective sample size. On this data effective n runs one to
   two orders of magnitude below raw n.

5. Do not propose paid data before something proves itself on free data.

DO NOT SUGGEST

  - "Try more features." Nineteen tests say feature count is not the constraint.
  - "Use a neural network." 320,000 rows with effective n two orders lower is
    not deep-learning territory, and trees already bought nothing over ridge.
  - Anything whose headline result is a t-stat.

SPECIFIC QUESTIONS

  1. Is the framing wrong? I test features against forward returns
     cross-sectionally. Is there a better question to ask of this data?
  2. Is there a target I have not tried? I have used raw return,
     volatility-scaled return, and triple-barrier labels.
  3. Is the universe wrong? Ten liquid majors.
  4. Is 1 hour the wrong bar?
  5. What data would you get next, and what would it be worth in bp?
  6. Should I switch the collector off? It writes 29.4 million rows and has zero
     production consumers, and every feature built on it has failed.
  7. If there is no edge here for a retail participant, what does end state A
     actually look like? What would make the analysis trustworthy and useful
     without predicting returns?

Start with your overall read: is this fixable, or is the honest answer that the
edge is not there? Then take the questions in whatever order matters most. I
would rather have a short, blunt answer than a long, encouraging one.
```

---

## Notes for me, not for the model

- Attach `BRIEFING_FOR_REVIEW.md`. If the model can read a repo, also point it at
  `docs/evidence/` — every document there states its bar before the run.
- The briefing names the deprecated surface explicitly (`src/risk-management/`,
  and the stale `lib/api/generated/schema.ts`) so review effort does not go
  there.
- If the answer comes back with a t-stat as its headline, it did not read
  section 5.
