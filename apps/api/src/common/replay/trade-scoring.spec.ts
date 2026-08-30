import { Candle } from '../types/candle.types';
import { aggregate, costOf, ScorablePlan, ScoringConfig, scoreRow, scoreTrade } from './trade-scoring';

/**
 * Nothing here asserts a known defect any more. Every deliberately
 * bug-compatible test from CP0.5 has been rewritten at the checkpoint that
 * fixed it — the opening bar (CP3/CP3.5) and unresolved scoring (CP4).
 */
const bar = (high: number, low: number, close = (high + low) / 2): Candle =>
  ({ time: new Date(0), open: close, high, low, close, volume: 0 }) as Candle;

/**
 * Zone 96–100, so a long ladders 20% at 100 (near edge, reached first, worst
 * price), 40% at 98, 40% at 96 (far edge, best price).
 *
 *   averageEntry = (20·100 + 40·98 + 40·96) / 100 = 97.6
 *   stop 92.6  ->  riskPerUnit = 5.0, and 1R is 5 price units throughout
 */
const long: ScorablePlan = {
  direction: 'long',
  entries: [
    { price: 100, weightPercent: 20 },
    { price: 98, weightPercent: 40 },
    { price: 96, weightPercent: 40 },
  ],
  averageEntry: 97.6,
  stop: 92.6,
  riskPerUnit: 5,
  riskPercent: 5,
  targets: [{ price: 107.6, weightPercent: 100 }],
};

const config: ScoringConfig = {
  fillBars: 3,
  maxBars: 4,
  breakevenAfterTarget: 1,
  roundTripPct: 0.14,
};

describe('costOf', () => {
  it('is the round trip divided by the stop distance', () => {
    expect(costOf(2, 0.14)).toBeCloseTo(0.07, 10);
    expect(costOf(0.5, 0.14)).toBeCloseTo(0.28, 10);
  });

  it('is zero rather than Infinity when there is no risk to divide by', () => {
    expect(costOf(0, 0.14)).toBe(0);
  });
});

describe('scoreTrade — entry ladder', () => {
  it('opens on the near edge, not on the blended average', () => {
    // High enough to miss 98 entirely: only the 100 leg can fill.
    const forward = [bar(103, 99), bar(103, 99), bar(103, 99), bar(103, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.filled).toBe(true);
    expect(r.fillIndex).toBe(0);
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBeCloseTo(0.2, 10);
    // Realised entry is the leg price, not 97.6.
    expect(r.entryPrice).toBeCloseTo(100, 10);
  });

  it('a bar that reaches the ORIGINAL stop has already filled every leg', () => {
    // Load-bearing, and not obvious until you draw it: the stop sits an ATR
    // BEYOND the far edge, so any bar whose low reaches the stop has already
    // traded through all three leg prices on the way down. A stop-out at the
    // original stop is therefore always a full-size, exactly −1R loss — the
    // same as the old single-fill model gave.
    //
    // Partial-size LOSSES are only reachable two ways: a breakeven stop after
    // TP1 has cancelled the remaining legs, or a mark-to-market at the end of
    // the hold window. Both are covered below.
    const forward = [bar(103, 99), bar(100, 92), bar(103, 99), bar(103, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.legsFilled).toBe(3);
    expect(r.filledFraction).toBe(1);
    expect(r.status).toBe('STOPPED');
    expect(r.entryPrice).toBeCloseTo(long.averageEntry, 10);
    expect(r.grossR).toBeCloseTo(-1, 10);
    expect(r.costR).toBeCloseTo(costOf(5, 0.14), 10);
  });

  it('holds one leg to the end of the window and marks a fraction to market', () => {
    // Touches 100 and never goes deeper: 20% of size, entry 100, closing 99.
    const forward = [bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBeCloseTo(0.2, 10);
    expect(r.status).toBe('TIMEOUT');
    // (99 − 100) / 5 = −0.2 per unit, times the 20% held = −0.04R.
    expect(r.grossR).toBeCloseTo(-0.04, 10);
    // Cost is paid on 20% of size, not on the whole plan.
    expect(r.costR).toBeCloseTo(costOf(5, 0.14) * 0.2, 10);
  });

  it('holds two legs to the end of the window', () => {
    const forward = [bar(103, 98, 98), bar(103, 98, 98), bar(103, 98, 98), bar(103, 98, 98)];
    const r = scoreTrade(forward, long, config);
    expect(r.legsFilled).toBe(2);
    expect(r.filledFraction).toBeCloseTo(0.6, 10);
    // (20·100 + 40·98) / 60 = 98.6667
    expect(r.entryPrice).toBeCloseTo(98.6666667, 6);
    expect(r.status).toBe('TIMEOUT');
    // (98 − 98.6667) / 5 = −0.13333, times 0.6 = −0.08
    expect(r.grossR).toBeCloseTo(-0.08, 6);
  });

  it('fills all three legs, then reaches target', () => {
    const forward = [bar(103, 96), bar(108, 100), bar(108, 100), bar(108, 100)];
    const r = scoreTrade(forward, long, config);
    expect(r.legsFilled).toBe(3);
    expect(r.filledFraction).toBe(1);
    expect(r.status).toBe('ALL_TARGETS');
    expect(r.grossR).toBeCloseTo(2, 10); // (107.6 − 97.6) / 5
  });

  it('a fully filled trade is identical to the old single-fill model', () => {
    // The invariant that makes this checkpoint attributable: when all legs
    // fill, the realised entry IS `averageEntry` by construction, so nothing
    // about a full trade moves. Everything that moves is a partial fill.
    const forward = [bar(103, 96), bar(108, 100), bar(108, 100), bar(108, 100)];
    const r = scoreTrade(forward, long, config);
    expect(r.entryPrice).toBeCloseTo(long.averageEntry, 10);
    expect(r.costR).toBeCloseTo(costOf(5, 0.14), 10);
  });

  it('fills two or three legs in a single wide bar', () => {
    const gap = [bar(103, 95), bar(108, 100), bar(108, 100), bar(108, 100)];
    const r = scoreTrade(gap, long, config);
    expect(r.legsFilled).toBe(3);
    expect(r.fillIndex).toBe(0);
    expect(r.entryPrice).toBeCloseTo(97.6, 10);
  });

  it('cancels an unfilled leg once the first target is hit', () => {
    const laddered: ScorablePlan = {
      ...long,
      targets: [
        { price: 107.6, weightPercent: 50 },
        { price: 112.6, weightPercent: 50 },
      ],
    };
    // Breakeven off, so the stop cannot end the trade before bar 2 is reached
    // and the cancellation is the only thing under test.
    const noBreakeven = { ...config, breakevenAfterTarget: 0 };
    const forward = [
      bar(103, 98), //  legs 1 and 2 fill — 60%
      bar(108, 99), //  TP1 at 107.6 — remaining legs cancelled here
      bar(103, 96), //  reaches the 96 leg, which must NOT fill
      bar(103, 99),
    ];
    const r = scoreTrade(forward, laddered, noBreakeven);
    expect(r.legsFilled).toBe(2);
    expect(r.filledFraction).toBeCloseTo(0.6, 10);
    expect(r.targetsHit).toBe(1);
    expect(r.status).toBe('TIMEOUT');
  });

  it('cancels an unfilled leg at the end of the hold window', () => {
    const forward = [
      bar(103, 98), // legs 1 and 2 — 60%
      bar(103, 99),
      bar(103, 99),
      bar(103, 99), // maxBars is 4 and the fill bar counts, so this is the last
      bar(103, 99), // past the window
      bar(103, 90), // past the window: must neither fill leg 3 nor stop
    ];
    const r = scoreTrade(forward, long, config);
    expect(r.legsFilled).toBe(2);
    expect(r.status).toBe('TIMEOUT');
    expect(r.barsHeld).toBe(4);
  });

  it('reports NO_FILL when no leg is reached inside the fill window', () => {
    const forward = [bar(110, 101), bar(112, 102), bar(111, 104), bar(103, 95)];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('NO_FILL');
    expect(r.filled).toBe(false);
    expect(r.legsFilled).toBe(0);
    expect(r.barsToFill).toBeNull();
  });

  it('counts barsToFill from the decision bar, so the first forward bar is 1', () => {
    const forward = [bar(110, 101), bar(103, 99), bar(103, 99), bar(103, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.fillIndex).toBe(1);
    expect(r.barsToFill).toBe(2);
  });

  it('moves breakeven to the REALISED entry, not the planned one', () => {
    const laddered: ScorablePlan = {
      ...long,
      targets: [
        { price: 107.6, weightPercent: 50 },
        { price: 112.6, weightPercent: 50 },
      ],
    };
    const forward = [
      bar(103, 98), //  two legs — realised entry 98.6667
      bar(108, 99), //  TP1, stop moves to 98.6667 (not to 97.6)
      bar(99, 98), //   dips to 98 — below 98.6667, so this stops it
      bar(103, 99),
    ];
    const r = scoreTrade(forward, laddered, config);
    expect(r.status).toBe('PARTIAL');
    // TP1 half: 0.5 · 0.6 · (107.6 − 98.6667)/5 = +0.536
    // rest at breakeven: 0.5 · 0.6 · 0 = 0
    expect(r.grossR).toBeCloseTo(0.536, 6);
  });

  it('mirrors exactly for a short', () => {
    const short: ScorablePlan = {
      direction: 'short',
      entries: [
        { price: 100, weightPercent: 20 }, // near edge = bottom of the zone
        { price: 102, weightPercent: 40 },
        { price: 104, weightPercent: 40 }, // far edge = top
      ],
      averageEntry: 102.4,
      stop: 107.4,
      riskPerUnit: 5,
      riskPercent: 5,
      targets: [{ price: 92.4, weightPercent: 100 }],
    };
    // One leg only, held to the window end — the mirror of the long case.
    const partial = [bar(100, 97, 101), bar(101, 97, 101), bar(101, 97, 101), bar(101, 97, 101)];
    const p = scoreTrade(partial, short, config);
    expect(p.legsFilled).toBe(1);
    expect(p.entryPrice).toBeCloseTo(100, 10);
    expect(p.filledFraction).toBeCloseTo(0.2, 10);
    expect(p.status).toBe('TIMEOUT');
    // Short: (entry 100 − close 101) / 5 = −0.2 per unit, times 0.2 = −0.04
    expect(p.grossR).toBeCloseTo(-0.04, 10);

    // And the same stop invariant holds upward: reaching 107.4 means every leg
    // at 100/102/104 was passed on the way.
    const stopped = [bar(100, 97), bar(108, 99), bar(101, 97), bar(101, 97)];
    const s = scoreTrade(stopped, short, config);
    expect(s.legsFilled).toBe(3);
    expect(s.entryPrice).toBeCloseTo(102.4, 10);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(-1, 10);

    // A clean run to target, fully filled.
    const won = [bar(104, 97), bar(101, 92), bar(101, 92), bar(101, 92)];
    const w = scoreTrade(won, short, config);
    expect(w.legsFilled).toBe(3);
    expect(w.status).toBe('ALL_TARGETS');
    expect(w.grossR).toBeCloseTo(2, 10); // (102.4 − 92.4) / 5
  });

  it('treats a plan with no ladder as one leg at the blended entry', () => {
    const flat: ScorablePlan = { ...long, entries: [] };
    const forward = [bar(103, 97.6), bar(108, 100), bar(108, 100), bar(108, 100)];
    const r = scoreTrade(forward, flat, config);
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBe(1);
    expect(r.entryPrice).toBeCloseTo(97.6, 10);
    expect(r.grossR).toBeCloseTo(2, 10);
  });
});

describe('scoreTrade — resolution', () => {
  it('resolves ON the opening bar: fill then stop is a loss, not a survival', () => {
    // Bar 0 reaches every leg and then drives through the 92.6 stop. It used to
    // read as ALL_TARGETS, because resolution started at fillIndex + 1 and the
    // breach was invisible — the trade "survived" a bar it was never alive for.
    const forward = [bar(100, 90), bar(108, 100), bar(108, 100), bar(108, 100)];
    const r = scoreTrade(forward, long, config);
    expect(r.fillIndex).toBe(0);
    expect(r.legsFilled).toBe(3);
    expect(r.status).toBe('STOPPED');
    expect(r.grossR).toBeCloseTo(-1, 10);
    expect(r.barsHeld).toBe(1);
  });

  it('does NOT register a target on the opening bar, and leaves the legs live', () => {
    // Bar 0 dips to the near edge and rallies through 107.6. Taking that target
    // would require knowing price hit 100 BEFORE 107.6, which OHLC cannot say —
    // and if the order was the other way the trade did not exist yet. So no
    // target, and the unfilled legs are still live for bar 1 to fill.
    const forward = [bar(108, 100, 100), bar(103, 96, 99), bar(103, 99, 99), bar(103, 99, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.fillIndex).toBe(0);
    expect(r.targetsHit).toBe(0);
    expect(r.status).toBe('TIMEOUT');
    // Legs 2 and 3 fill on bar 1 — they were never cancelled.
    expect(r.legsFilled).toBe(3);
    expect(r.filledFraction).toBe(1);
    expect(r.entryPrice).toBeCloseTo(97.6, 10);
    expect(r.grossR).toBeCloseTo(0.28, 10); // (99 − 97.6) / 5, full size
  });

  it('registers that target on the NEXT bar, if price is still there', () => {
    // Same opening bar, but 107.6 is reached again on bar 1 — now it is ours.
    const forward = [bar(108, 100, 100), bar(108, 100, 100), bar(103, 99, 99), bar(103, 99, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.targetsHit).toBe(1);
    expect(r.status).toBe('ALL_TARGETS');
    expect(r.barsHeld).toBe(2);
    // 20% of size, entry 100: 0.2 · (107.6 − 100)/5 = 0.304
    expect(r.legsFilled).toBe(1);
    expect(r.grossR).toBeCloseTo(0.304, 10);
  });

  it('still stops on the opening bar when it spans the stop AND a target', () => {
    // Stop before target, exactly as on every later bar. This is the half of
    // the fill-bar rule that is physically forced and it must not have moved.
    const forward = [bar(108, 90), bar(103, 99), bar(103, 99), bar(103, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('STOPPED');
    expect(r.targetsHit).toBe(0);
    expect(r.grossR).toBeCloseTo(-1, 10);
    expect(r.barsHeld).toBe(1);
  });

  it('does not arm breakeven on the opening bar, so the next bar stops at full risk', () => {
    // Bar 0 spans the near edge and TP1; bar 1 drops through the stop. If the
    // target had registered on bar 0 the stop would have moved to the realised
    // entry and this would exit flat. It exits at −1R.
    const forward = [bar(108, 100, 100), bar(103, 92, 95), bar(103, 99), bar(103, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('STOPPED');
    expect(r.targetsHit).toBe(0);
    expect(r.grossR).toBeCloseTo(-1, 10);
  });

  it('mirrors for a short opening bar', () => {
    const short: ScorablePlan = {
      direction: 'short',
      entries: [
        { price: 100, weightPercent: 20 },
        { price: 102, weightPercent: 40 },
        { price: 104, weightPercent: 40 },
      ],
      averageEntry: 102.4,
      stop: 107.4,
      riskPerUnit: 5,
      riskPercent: 5,
      targets: [{ price: 92.4, weightPercent: 100 }],
    };
    // Rises through all three legs and on through the 107.4 stop, in one bar.
    const stopped = scoreTrade(
      [bar(108, 99), bar(101, 97), bar(101, 97), bar(101, 97)],
      short,
      config,
    );
    expect(stopped.status).toBe('STOPPED');
    expect(stopped.grossR).toBeCloseTo(-1, 10);

    // Reaches the 100 leg and falls through 92.4 in the same bar: no target.
    const spanning = scoreTrade(
      [bar(100, 92, 100), bar(101, 97, 99), bar(101, 97, 99), bar(101, 97, 99)],
      short,
      config,
    );
    expect(spanning.targetsHit).toBe(0);
    expect(spanning.status).toBe('TIMEOUT');
    expect(spanning.legsFilled).toBe(1);
    // Short, 20% at 100, marked at 99: (100 − 99)/5 · 0.2 = +0.04
    expect(spanning.grossR).toBeCloseTo(0.04, 10);
  });

  it('leaves a trade whose opening bar touched neither alone', () => {
    // The load-bearing invariant: this fix can only move trades whose fill bar
    // itself reached the stop or a target. Bar 0 fills at 100 and does nothing
    // else, so every number here is what it was before the change.
    const forward = [bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99)];
    const r = scoreTrade(forward, long, config);
    expect(r.fillIndex).toBe(0);
    expect(r.legsFilled).toBe(1);
    expect(r.entryPrice).toBeCloseTo(100, 10);
    expect(r.status).toBe('TIMEOUT');
    expect(r.grossR).toBeCloseTo(-0.04, 10);
  });

  it('marks unresolved size to market at the last bar of the hold window', () => {
    const forward = [bar(103, 96), bar(103, 100, 102.6), bar(103, 100, 102.6), bar(103, 100, 102.6)];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('TIMEOUT');
    expect(r.targetsHit).toBe(0);
    expect(r.grossR).toBeCloseTo(1, 10); // (102.6 − 97.6) / 5
  });

  it('stops resolving after maxBars', () => {
    const forward = [
      bar(103, 96),
      bar(103, 100, 102.6),
      bar(103, 100, 102.6),
      bar(103, 100, 102.6), // maxBars is 4 counting the fill bar — the last one
      bar(103, 100, 102.6),
      bar(140, 130, 140), // past the window — must not count
    ];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('TIMEOUT');
    expect(r.barsHeld).toBe(4);
    expect(r.grossR).toBeCloseTo(1, 10);
  });

  it('tolerates a forward series that runs out mid-hold', () => {
    // The harness no longer produces this — it reserves the whole window before
    // the end of the series — but the golden set and the live path can, so it
    // must still mark to market rather than throw or invent bars.
    const forward = [bar(103, 96), bar(103, 100, 102.6)];
    const r = scoreTrade(forward, long, config);
    expect(r.status).toBe('TIMEOUT');
    expect(r.barsHeld).toBe(2);
  });

  it('marks to market on the opening bar when it is the only one', () => {
    // Was 0R over 0 bars: the position existed but no bar was ever examined, so
    // it was worth nothing by construction. It is worth its own close.
    const r = scoreTrade([bar(103, 96, 99.6)], long, config);
    expect(r.filled).toBe(true);
    expect(r.barsHeld).toBe(1);
    expect(r.status).toBe('TIMEOUT');
    expect(r.grossR).toBeCloseTo(0.4, 10); // (99.6 − 97.6) / 5
  });
});

describe('scoreRow', () => {
  it('keeps an unresolved trade at its mark, including the cost it paid', () => {
    // This used to return 0 for TIMEOUT, discarding both. `profile()` then
    // binned the zeros as losses.
    expect(scoreRow({ status: 'TIMEOUT', netR: 5 })).toBe(5);
    expect(scoreRow({ status: 'TIMEOUT', netR: -0.07 })).toBe(-0.07);
  });

  it('keeps the realised R of a resolved trade', () => {
    expect(scoreRow({ status: 'STOPPED', netR: -1 })).toBe(-1);
    expect(scoreRow({ status: 'PARTIAL', netR: 0.2 })).toBe(0.2);
    expect(scoreRow({ status: 'ALL_TARGETS', netR: 1.5 })).toBe(1.5);
  });
});

describe('aggregate', () => {
  const rows = [
    { status: 'ALL_TARGETS', netR: 2 },
    { status: 'STOPPED', netR: -1 },
    { status: 'STOPPED', netR: -1 },
    { status: 'TIMEOUT', netR: 1.4 }, // an OPEN winner
  ];

  it('counts an unresolved winner as a win, not a loss', () => {
    const a = aggregate(rows);
    expect(a.wins).toBe(2); // the +2 and the open +1.4
    expect(a.winRate).toBeCloseTo(0.5, 10);
    // Under the old rule the open trade scored 0 and landed in `x <= 0`:
    // 1 win in 4, expectancy (2 − 1 − 1 + 0)/4 = 0.
    expect(a.expectancy).toBeCloseTo(0.35, 10); // (2 − 1 − 1 + 1.4)/4
  });

  it('reports the open positions and their mark', () => {
    const a = aggregate(rows);
    expect(a.unresolved).toBe(1);
    expect(a.unresolvedMeanR).toBeCloseTo(1.4, 10);
    expect(a.nResolved).toBe(3);
  });

  it('reports expectancy with the open positions dropped, and the gap', () => {
    const a = aggregate(rows);
    expect(a.expectancyResolved).toBeCloseTo(0, 10); // (2 − 1 − 1)/3
    expect(a.markingGap).toBeCloseTo(0.35, 10);
  });

  it('is the plain mean when nothing is unresolved — the gap is zero', () => {
    const a = aggregate(rows.filter((r) => r.status !== 'TIMEOUT'));
    expect(a.unresolved).toBe(0);
    expect(a.expectancy).toBeCloseTo(0, 10);
    expect(a.expectancy).toBe(a.expectancyResolved);
    expect(a.markingGap).toBeCloseTo(0, 10);
  });

  it('treats exactly 0R as a loss, not a win', () => {
    const a = aggregate([{ status: 'PARTIAL', netR: 0 }]);
    expect(a.wins).toBe(0);
    expect(a.avgLose).toBe(0);
  });

  it('does not divide by zero on an empty set or an all-wins set', () => {
    const empty = aggregate([]);
    expect(empty.n).toBe(0);
    expect(Number.isNaN(empty.expectancy)).toBe(true);
    expect(Number.isNaN(empty.markingGap)).toBe(true);

    const allWins = aggregate([{ status: 'ALL_TARGETS', netR: 1 }]);
    expect(allWins.winRate).toBe(1);
    expect(Number.isNaN(allWins.payoff)).toBe(true);
  });

  it('totalR is the sum of the scored rows, unresolved included', () => {
    expect(aggregate(rows).totalR).toBeCloseTo(1.4, 10);
  });

  it('does not book a trade that never entered as a finished loss', () => {
    // A NO_FILL row sits at exactly 0.0R. It used to count as RESOLVED (only
    // TIMEOUT was unresolved) and 0 is a loss, so a plan that never triggered
    // arrived as a losing trade that had finished.
    const withNoFill = [...rows, { status: 'NO_FILL', netR: 0 }];
    const a = aggregate(withNoFill);

    expect(a.nResolved).toBe(3); // unchanged: the +2 and the two −1s
    expect(a.expectancyResolved).toBeCloseTo(0, 10); // (2 − 1 − 1)/3
    expect(a.unresolved).toBe(2); // the open winner AND the unfilled row

    // Not in the win/loss population either, so the rate is still 2 of 4.
    expect(a.wins).toBe(2);
    expect(a.winRate).toBeCloseTo(0.5, 10);
  });
});

describe('scoreTrade — the re-analysis exit', () => {
  // Fills 20% at 100 on bar 0, then drifts sideways well clear of the stop and
  // the target. Left alone this is a TIMEOUT marked at the last close.
  const drift = [bar(101, 99, 100), bar(101, 99, 100), bar(102, 100, 101), bar(101, 99, 99)];

  it('is inert when no signal is configured', () => {
    const r = scoreTrade(drift, long, { ...config, maxBars: 4 });
    expect(r.status).toBe('TIMEOUT');
  });

  it('closes at the signalling bar CLOSE, and the outcome is resolved', () => {
    const r = scoreTrade(drift, long, {
      ...config,
      maxBars: 4,
      exitSignal: (i) => i === 2,
    });

    expect(r.status).toBe('SIGNAL_EXIT');
    expect(r.barsHeld).toBe(3);
    // 20% of size, entered at 100, out at bar 2's close of 101 -> +1/5 R on a
    // fifth of the position.
    expect(r.grossR).toBeCloseTo(0.2 * ((101 - 100) / 5), 10);
    // Resolved, not marked to market: the harness must not count it as open.
    expect(r.status === 'TIMEOUT').toBe(false);
  });

  it('never overrides a bar that resolved on its own terms', () => {
    // Bar 1 reaches the stop at 92.6. A signal on the same bar must not turn a
    // loss into a smaller exit at the close.
    const stopped = [bar(101, 99, 100), bar(100, 92, 95), bar(101, 99, 100)];
    const r = scoreTrade(stopped, long, {
      ...config,
      maxBars: 4,
      exitSignal: (i) => i === 1,
    });

    expect(r.status).toBe('STOPPED');
    // A full −1R, not a fifth of one: the stop sits below every leg, so the bar
    // that reached it traded through all three on the way. That is the reason
    // every stopped trade in the backtest is 100% filled.
    expect(r.grossR).toBeCloseTo(-1, 10);
    expect(r.filledFraction).toBe(1);
  });

  it('cannot resurrect a position it already closed at a target', () => {
    const won = [bar(101, 99, 100), bar(108, 99, 108), bar(101, 99, 100)];
    const r = scoreTrade(won, long, { ...config, maxBars: 4, exitSignal: (i) => i === 1 });
    expect(r.status).toBe('ALL_TARGETS');
  });
});
