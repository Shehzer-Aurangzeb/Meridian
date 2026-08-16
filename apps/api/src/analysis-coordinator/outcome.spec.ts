import { Candle } from '../common/types/candle.types';
import { TradePlan } from '../analysis/services/trade-plan.service';
import {
  FILL_WINDOW_HOURS,
  isScoreable,
  MAX_HOLD_HOURS,
  OUTCOME_WINDOW_HOURS,
  scorePlans,
} from './outcome';

const HOUR = 3_600_000;
const T0 = 1_770_000_000_000;

const bar = (i: number, low: number, high: number, close = (low + high) / 2): Candle => ({
  time: new Date(T0 + i * HOUR),
  open: close,
  high,
  low,
  close,
  volume: 1,
});

// entry 100, stop 90 => 1R = 10. Targets 110 / 120 / 130.
const longPlan = {
  direction: 'long',
  averageEntry: 100,
  stop: 90,
  riskPerUnit: 10,
  targets: [
    { price: 110, weightPercent: 33 },
    { price: 120, weightPercent: 33 },
    { price: 130, weightPercent: 34 },
  ],
} as TradePlan;

const analysedAt = new Date(T0);

describe('scorePlans', () => {
  it('is PENDING while price has not reached the entry and the window is open', () => {
    const candles = [bar(1, 105, 115)]; // never trades down to 100
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 2 * HOUR);
    expect(r.outcome).toBe('PENDING');
    expect(r.r).toBeNull();
  });

  it('becomes MISSED once the measured fill window has passed', () => {
    // A full series for the elapsed time — a sparse one is now UNSCOREABLE
    // rather than scored against whatever arrived, which is the point of the
    // window guard. None of these bars reaches the entry at 100.
    const candles = Array.from({ length: FILL_WINDOW_HOURS + 1 }, (_, i) =>
      bar(i + 1, 105, 115),
    );
    const [r] = scorePlans(
      [longPlan],
      candles,
      analysedAt,
      T0 + (FILL_WINDOW_HOURS + 1) * HOUR,
    );
    expect(r.outcome).toBe('MISSED');
  });

  it('is OPEN once filled but unresolved, marked to market', () => {
    const candles = [bar(1, 99, 101), bar(2, 100, 105, 105)];
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.outcome).toBe('OPEN');
    expect(r.r).toBeCloseTo(0.5); // 105 vs entry 100, 1R = 10
    expect(r.filledAt).toEqual(new Date(T0 + HOUR));
  });

  it('is STOPPED at exactly -1R', () => {
    const candles = [bar(1, 99, 101), bar(2, 89, 95)];
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.outcome).toBe('STOPPED');
    expect(r.r).toBeCloseTo(-1);
  });

  it('is ALL_TARGETS when the ladder completes', () => {
    const candles = [bar(1, 99, 101), bar(2, 100, 111), bar(3, 110, 121), bar(4, 120, 131)];
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 5 * HOUR);
    expect(r.outcome).toBe('ALL_TARGETS');
    expect(r.targetsHit).toBe(3);
    expect(r.r).toBeCloseTo(0.33 + 0.66 + 1.02);
  });

  it('is PARTIAL when TP1 hit then stopped — and the rest exits at breakeven', () => {
    const candles = [bar(1, 99, 101), bar(2, 100, 111), bar(3, 85, 100)];
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 4 * HOUR);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.r).toBeCloseTo(0.33); // 67% out at entry, not at -1R
  });

  it('does not fill on the analysis bar itself — only candles after it', () => {
    // An empty window cannot fill, however good the plan looks.
    const [r] = scorePlans([longPlan], [], analysedAt, T0 + HOUR);
    expect(r.outcome).toBe('PENDING');
  });

  it('reports a full fill on a plan with no ladder', () => {
    // The fixtures above carry no `entries`, which is the degenerate plan:
    // one leg at the blended price for the whole position. Stated here so the
    // rest of this block is not silently testing a case saved analyses never
    // produce — every real plan has three legs, covered in the block below.
    const candles = [bar(1, 99, 101), bar(2, 100, 105, 105)];
    const [r] = scorePlans([longPlan], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBe(1);
  });

  it('scores each direction independently', () => {
    const shortPlan = {
      direction: 'short',
      averageEntry: 120,
      stop: 130,
      riskPerUnit: 10,
      targets: [{ price: 110, weightPercent: 100 }],
    } as TradePlan;
    // Price rises to 120 (fills the short), then falls to 110 (its target)
    // and through 100 (fills the long).
    const candles = [bar(1, 115, 121), bar(2, 99, 115)];
    const results = scorePlans([longPlan, shortPlan], candles, analysedAt, T0 + 3 * HOUR);
    expect(results.map((r) => r.direction)).toEqual(['long', 'short']);
    expect(results[1].outcome).toBe('ALL_TARGETS');
  });
});

/**
 * What a SAVED plan actually looks like: a 20/40/40 ladder across the zone.
 * Zone 96–100, so averageEntry is 97.6 and the stop an ATR below at 92.6.
 */
const laddered = {
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
} as TradePlan;

describe('scorePlans — entry ladder', () => {
  it('opens at the near edge, holding a fifth of the planned position', () => {
    // Price dips to 100 and no further. Under the old model this never filled
    // at all — it never reached 97.6 — so the position simply did not exist.
    const candles = [bar(1, 99, 103, 99), bar(2, 99, 103, 99)];
    const [r] = scorePlans([laddered], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.outcome).toBe('OPEN');
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBeCloseTo(0.2, 10);
    expect(r.filledAt).toEqual(new Date(T0 + HOUR));
    // Entry 100, marked at 99: (99 − 100)/5 = −0.2 per unit on 20% = −0.04R.
    expect(r.r).toBeCloseTo(-0.04, 10);
  });

  it('holds two legs when price works halfway into the zone', () => {
    const candles = [bar(1, 98, 103, 98), bar(2, 98, 103, 98)];
    const [r] = scorePlans([laddered], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.legsFilled).toBe(2);
    expect(r.filledFraction).toBeCloseTo(0.6, 10);
  });

  it('is a full position, at exactly −1R, whenever the stop is reached', () => {
    // The stop sits an ATR BELOW the far leg, so any bar that reaches it has
    // already traded through all three legs. Stop-outs are never partial.
    const candles = [bar(1, 99, 103), bar(2, 92, 99)];
    const [r] = scorePlans([laddered], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.outcome).toBe('STOPPED');
    expect(r.legsFilled).toBe(3);
    expect(r.filledFraction).toBe(1);
    expect(r.r).toBeCloseTo(-1, 10);
  });

  it('cancels the unfilled legs once the first target is taken', () => {
    const candles = [
      bar(1, 98, 103), //  two legs — 60%
      bar(2, 100, 108), // target 107.6 taken; the 96 leg is cancelled here
      bar(3, 96, 99), //   reaches 96, which must no longer fill
    ];
    const [r] = scorePlans([laddered], candles, analysedAt, T0 + 4 * HOUR);
    expect(r.outcome).toBe('ALL_TARGETS');
    expect(r.legsFilled).toBe(2);
    expect(r.filledFraction).toBeCloseTo(0.6, 10);
    // (107.6 − 98.6667)/5 = 1.78667 per unit on 60% = 1.072R.
    expect(r.r).toBeCloseTo(1.072, 6);
  });

  it('mirrors for a short', () => {
    const shortLadder = {
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
    } as TradePlan;
    const candles = [bar(1, 97, 100, 101), bar(2, 97, 101, 101)];
    const [r] = scorePlans([shortLadder], candles, analysedAt, T0 + 3 * HOUR);
    expect(r.outcome).toBe('OPEN');
    expect(r.legsFilled).toBe(1);
    expect(r.filledFraction).toBeCloseTo(0.2, 10);
    expect(r.r).toBeCloseTo(-0.04, 10);
  });
});

/**
 * B10 / C3 / C4 — the replay window.
 *
 * These three defects were one bug in effect: the series was anchored at NOW
 * rather than at the analysis, and neither the fill deadline nor the hold limit
 * was applied. An analysis older than the fetched window was re-scored against
 * a period its entry was never in, so a closed trade could revert to MISSED and
 * a later touch of the same price could manufacture a fill that never happened.
 */
const series = (from: number, count: number, low: number, high: number, close?: number): Candle[] =>
  Array.from({ length: count }, (_, i) => bar(from + i, low, high, close));

describe('isScoreable', () => {
  it('accepts a window that starts at the analysis and covers the elapsed time', () => {
    expect(isScoreable(series(1, 30, 105, 115), analysedAt, T0 + 30 * HOUR)).toBe(true);
  });

  it('accepts an empty series while the first bar is still forming', () => {
    expect(isScoreable([], analysedAt, T0 + HOUR)).toBe(true);
  });

  it('rejects a series that starts LATE — the B10 bug', () => {
    // 30h elapsed, 30 candles supplied, but they begin 20h after the analysis.
    // This is exactly what "the most recent N candles" returned for an old
    // analysis, and scoring it is how STOPPED reverted to MISSED.
    expect(isScoreable(series(21, 30, 105, 115), analysedAt, T0 + 50 * HOUR)).toBe(false);
  });

  it('rejects a series too short for the elapsed time', () => {
    expect(isScoreable(series(1, 3, 105, 115), analysedAt, T0 + 50 * HOUR)).toBe(false);
  });

  it('stops requiring more candles once the whole window has been supplied', () => {
    // A year old, but the full 96-bar window is present: scoreable.
    expect(
      isScoreable(series(1, OUTCOME_WINDOW_HOURS, 105, 115), analysedAt, T0 + 8760 * HOUR),
    ).toBe(true);
  });
});

describe('scorePlans — the replay window', () => {
  it('reports UNSCOREABLE rather than scoring a window it did not intend', () => {
    const [r] = scorePlans([longPlan], series(21, 30, 99, 101), analysedAt, T0 + 50 * HOUR);
    expect(r.outcome).toBe('UNSCOREABLE');
    expect(r.r).toBeNull();
    expect(r.filledAt).toBeNull();
    expect(r.filledFraction).toBe(0);
  });

  it('C3 — rejects a fill later than the fill window', () => {
    // Price sits away from the entry for 30 bars, then touches it at bar 31 —
    // past the 24h deadline. That is not our trade.
    const late = [
      ...series(1, 30, 105, 115),
      ...series(31, 20, 99, 101),
    ];
    const [r] = scorePlans([longPlan], late, analysedAt, T0 + 51 * HOUR);
    expect(r.outcome).toBe('MISSED');
    expect(r.filledAt).toBeNull();
  });

  it('C3 — a fill inside the window is still taken', () => {
    const intime = [
      ...series(1, 10, 105, 115),
      ...series(11, 40, 99, 101, 101),
    ];
    const [r] = scorePlans([longPlan], intime, analysedAt, T0 + 51 * HOUR);
    expect(r.outcome).toBe('OPEN');
    expect(r.filledAt).toEqual(new Date(T0 + 11 * HOUR));
  });

  it('C4 — an unresolved position EXPIRES instead of running forever', () => {
    // Fills on bar 1 and drifts for the whole window without touching 90 or 110.
    const drift = series(1, OUTCOME_WINDOW_HOURS, 99, 101, 101);
    const [open] = scorePlans([longPlan], drift, analysedAt, T0 + 40 * HOUR);
    expect(open.outcome).toBe('OPEN'); // still inside the hold window

    const [done] = scorePlans([longPlan], drift, analysedAt, T0 + 200 * HOUR);
    expect(done.outcome).toBe('EXPIRED');
    expect(done.r).toBeCloseTo(0.1, 10); // marked at 101 against entry 100
  });

  it('no filled plan can hold longer than the shared hold constant', () => {
    const drift = series(1, OUTCOME_WINDOW_HOURS, 99, 101, 101);
    const [r] = scorePlans([longPlan], drift, analysedAt, T0 + 5000 * HOUR);
    expect(r.outcome).toBe('EXPIRED');
    // barsHeld is capped by MAX_HOLD_HOURS inside scoreTrade; the badge cannot
    // represent a longer hold than the backtest measures.
    expect(MAX_HOLD_HOURS).toBe(72);
  });

  it('live and the harness now use the same two windows', () => {
    // The point of the checkpoint: one measurement, not two.
    expect(FILL_WINDOW_HOURS).toBe(24);
    expect(MAX_HOLD_HOURS).toBe(72);
    expect(OUTCOME_WINDOW_HOURS).toBe(96);
  });
});
