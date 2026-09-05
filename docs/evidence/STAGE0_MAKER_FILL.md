# Stage 0 — would the limit order have filled, and would it have paid?

Run 1 September 2026. `pnpm --filter api maker-fill --dir <1m archive>
--signals <phase-d signals>`. Signals are Phase D's own book, one row per leg,
written from inside `score_book` so the simulated trades cannot drift from the
scored ones.

**No.** On the larger sample the strategy loses money gross, before any fee at
all, with an interval entirely below zero.

---

## Why this was run

Every phase charged a 14 bp round trip, which is TAKER on both sides. Resting a
limit order costs roughly 3.6 bp, and Phase D's best holdout row earned 5.82 bp.
So the entire question of whether any of this is tradeable turned on whether
those orders fill — which had never been measured.

1-minute klines rather than 1-hour on purpose. "Price came back within the hour"
is nearly always true and would report a fill rate near 100% while teaching
nothing.

## The result

```
                       legs   gross bp   95% interval       net@3.6 bp        verdict
holdout (182 days)    1,098     +10.81   [  0.81, 19.93]   [-2.79, 16.33]   inconclusive
dev     (3.1 years)   6,912      -8.20   [-13.33, -2.75]   [-16.93, -6.35]   FAILS
```

Both at 2 bp inside the reference price, an 88-92% fill rate.

`dev` is not in-sample. Those are the purged K-fold predictions — a legitimate
out-of-sample measurement over 3.1 years with six times the legs of the holdout
and an interval that never touches zero.

The holdout is 183 trades over 182 days and its interval spans zero. The larger,
longer, tighter measurement is the one to believe, and it says the strategy
loses 8.20 bp **before the fee is charged at all**. Making the fee cheaper
cannot fix a negative gross.

## Three things worth keeping from the run

**A 99% fill rate is a broken test, not good news.** At 0 bp inside — posting at
the last traded price — the fill rate is 99.0% with a median wait of **0
minutes**. An order that fills in the first minute at the last traded price was
marketable, which is a TAKER order paying ~9 bp round trip. The first version of
this run charged a 3.6 bp maker fee against those fills and reported +1.31 bp.
That number was wrong and is retracted here.

**Posting further away looks better and is not.** Gross rises from 4.91 to 27.23
bp as the order is posted from 0 to 20 bp inside. Almost all of it is mechanical:
post X bp better on the way in and the way out and 2X is booked whether or not
the signal is worth anything. Net of that discount the edge is flat and then
negative:

```
post inside  fill %  gross bp  2x discount  edge net of it
        0 bp    99.0      4.91            0            4.91
        1 bp    92.0      6.75            2            4.75
        2 bp    88.3     10.81            4            6.81
        5 bp    78.9     13.09           10            3.09
       10 bp    62.1     18.45           20           -1.55
       20 bp    36.4     27.23           40          -12.77
```

At 10 and 20 bp inside the signal contributes *negatively* and every unit of
profit is spread capture. That is market making, a different business, and a
kline simulator is the wrong instrument for it — queue position, inventory and
adverse selection are the entire game there.

**The fills were BETTER than the misses, which was not the prediction.**

```
improve   fill %   fills (ref)   misses (ref)   difference   n missed
   0 bp     99.0        +5.34         -30.62       +35.96         11
   2 bp     88.3        +9.93         -32.21       +42.14        129
   5 bp     78.9        +8.60          -8.55       +17.15        232
  10 bp     62.1        +9.29          -2.09       +11.38        416
  20 bp     36.4        +7.20          +3.70        +3.50        698
```

Adverse selection was the expected failure. Instead the fills are favourably
selected, and there is a mechanism: this is a mean-reversion strategy, so a buy
fills exactly when the dislocation deepens, which is more setup rather than
less. But note the difference collapsing from +35.96 on eleven misses to +3.50
on 698 — the effect shrinks as the sample grows, which is what small-sample
noise looks like, and the row with the most data shows the least effect.

It is moot anyway. Favourable selection on a negative gross is still negative.

## What this does NOT establish

The fill rates here are an **upper bound and nothing more**. A 1-minute bar says
price traded between its low and high. It does not say where in the queue the
order sat, or whether the touch was a single print of three contracts. Real
filling is worse than every number above.

That asymmetry is why the test was worth running: it can kill an idea cheaply
and it cannot bless one. It killed this one.

## Where this leaves road 1

Road 1 was "pay a smaller fee". It rested on Phase D's holdout figure of 5.82 bp
gross, and the assumption that a limit order would fill.

The order does fill, more often than expected, and favourably. And the gross it
fills into is **negative over the longer sample**. A cheaper fee multiplies a
negative number by one.

Road 1 is closed. What is not closed is road 2 — data this panel does not
contain — and the ranking there is unchanged: cross-exchange dispersion first
(free, all ten coins, genuinely orthogonal to everything in 160 columns), then
Deribit implied volatility and skew (free, forward-looking, but only BTC and ETH
have liquid options).
