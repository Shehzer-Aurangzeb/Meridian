# Mid-cap direction — test 21

Run 7 September 2026. `pnpm --filter api midcap-direction`.

**Bar 1 PASS. Bars 2, 3 and 4 FAIL. Mid-cap direction is dead on this data.**

Seven of 36 tests cleared |t| > 3.0 against 0.10 expected by chance, and not
one survived pricing, the shuffle, or the persistence gate. Every feature that
cleared is a near-static ranking of which coins are volatile — a coin label
wearing 191 observations as a disguise.

---

## The question

Twenty pre-registered tests found no directional edge in ten liquid majors. The
standard objection is that the majors are the most efficiently priced
instruments in crypto and that any edge lives further down the volume ranking.

This tests that objection directly: the same weekly cross-sectional
methodology, on coins ranked #11–#100 by 30-day volume, with the majors
removed because they are already dead.

The statistical core is `weekly-direction.ts`, **imported rather than copied** —
same IC, same Newey-West lag, same 30-week block bootstrap, same shuffle, same
persistence gate. A second implementation of the same test that happened to
disagree would be indistinguishable from a discovery.

## Bars, pre-registered

```
1  some feature clears |t| > 3.0
2  priced top-3 vs bottom-3, it clears a 50 bp round trip
3  it beats its shuffled control by an interval excluding zero
4  |momentum correlation| < 0.70
   gate: weekly rank persistence < 0.50
```

The fee is **50 bp, not 14**. Mid-cap books are thinner, and quoting a mid-cap
result against a major's round trip would be comparing a wider spread to a
narrower one and calling the difference alpha.

## What the universe actually turned out to be

Asked for 90 coins. Got **31** into the panel, and 37 under a looser warm-up.
This is not a defect in the selection — it is what the mid-cap perp market is:

```
of the 90 coins in the universe, weekly bars available
  >= 190 weeks (full 2023-01)   20
  120-189 weeks                 11
   60-119 weeks                 11
  < 60 weeks                    48
```

Nearly half listed too recently to carry a three-year test at all — BTW first
traded 2026-06-01, ZHIPU and MUU 2026-07-13. **The mid-cap universe that exists
today largely did not exist in 2023**, which is itself an answer to "why not
look further down the ranking": most of what is down there has no history to
look at.

Run both ways, and the verdict is the same:

```
panel 191 weeks x 31 coins (ctx 60, min-weeks 60)   bar 1 passed 7 of 36
panel 191 weeks x 37 coins (ctx 40, min-weeks 40)   bar 1 passed 4 of 36
```

Widening the panel made the survivors *worse*, not better.

## The results

Every feature clearing |t| > 3.0 on the 31-coin panel:

```
feature        h    IC       t      gross bp   net@50   shuffle 95%      persist  momentum
dist20wLow    1w  -0.0857  -4.57      19.0     -31.0   [-61.3, 59.1]      0.87      0.38
dist20wLow    4w  -0.1236  -4.36     117.4     +67.4   [-172.2, 162.0]    0.87      0.38
dist20wLow    2w  -0.0951  -4.24       8.3     -41.7   [-106.9, 100.9]    0.87      0.38
bandWidth     4w  -0.1360  -3.61     300.6    +250.6   [-165.8, 165.2]    0.97     -0.04
bandWidth     2w  -0.0920  -3.25     129.0     +79.0   [-105.2, 107.5]    0.97     -0.04
bandWidth     1w  -0.0732  -3.20      33.7     -16.3   [-65.2, 64.9]      0.97     -0.04
atrPct        4w  -0.1323  -3.02     196.8    +146.8   [-154.7, 160.4]    0.96     -0.39
```

**Not one passes all four.** Three cleared bars 2, 3 and 4 — `bandWidth` at 2w
and 4w, and `atrPct` at 4w — and every one of them died on the persistence gate.

## Why the persistence gate killed everything

```
dist20wLow   weekly rank persistence 0.87
atrPct                               0.96
bandWidth                            0.97
```

A feature whose ordering of the coins is 0.97 correlated with itself **one week
later** is not timing anything. It says the same coins are volatile this week as
last, which is true, free, and has an effective sample size near one. Phase B
caught raw open interest the same way at 0.99 over a 30-day lag; here it is
worse, at a lag of a single week.

`bandWidth @4w` looks spectacular — 300.6 bp gross, 250.6 bp net of a 50 bp fee.
It is a fixed bet that low-volatility mid-caps outperform high-volatility ones,
placed once and held for 3.6 years. The 95% shuffle interval is
`[-165.8, 165.2]` bp, which is the width the honest reader should notice: a book
this concentrated swings by ±165 bp on randomly assigned returns, so 300 bp is
under two shuffle standard deviations from noise.

`dist20wLow` at 0.87 is the same story in a different coat — how far a coin sits
above its 20-week low is mostly a statement about which coins have been in a
downtrend all year.

## What could not be tested, and why

**`oiChange` was dropped.** `/futures/data/openInterestHist` retains about 30
days, and `FlowSample` holds exactly ten symbols — the majors. There is no
open-interest history for any coin in this universe at any price. Filling the
feature from a 30-day window would have turned a 3.6-year question into a
monthly one, so the panel ran 12 features rather than 13.

**Funding was fetched from Binance, not from the database**, for the same
reason. `/fapi/v1/fundingRate` accepts `limit=1000` and caps at 500 — the
endpoint methodology rule 7 was written about, after reading a short page as the
end of history truncated a 2,200-day backfill to 166 days while reporting no
failures. This pages by timestamp and stops only on an empty response.

## The bias that could not be removed

The universe is chosen by **current** volume and tested backwards. Coins that
were liquid in 2023 and have since died are absent; every coin here survived to
be ranked today.

That points one way: it flatters the result. A pass would have needed
discounting for it. **A failure is if anything strengthened by it** — the sample
is already tilted toward the winners, and even so nothing survived.

## Verdict

**Mid-cap direction is dead on this data.**

Seven features cleared |t| > 3.0 against 0.10 expected by chance. All seven were
near-static coin rankings. Three of them priced above a 50 bp fee, and all three
sat inside their own shuffle interval. The objection that the edge lives further
down the volume ranking is not supported here — and nearly half that ranking has
no history to test.

This is test 21. It reaches the same wall as the previous twenty, by the same
route: real statistical signal, none of it timing anything, none of it paying a
fee.

## Reproduce

```
pnpm --filter api midcap-direction
pnpm --filter api midcap-direction -- --ctx 40 --min-weeks 40
```

Candles, funding and the universe are cached under `~/meridian-archive/midcap/`;
delete it to refetch.
