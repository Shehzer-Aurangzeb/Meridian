/**
 * Phase 1's bars.
 *
 * Each fixture is built so a broken implementation INVERTS the answer rather
 * than merely failing. A leak test that goes green either way proves nothing —
 * the first resolution-leak test in this project leaked one future bar and
 * passed whichever way it was wired.
 */
import { Candle } from '../common/types/candle.types';
import {
  scoreSimTrade,
  toScorablePlan,
  forwardBars,
  ROUND_TRIP_PCT,
  FILL_WINDOW_HOURS,
  MAX_HOLD_HOURS,
} from './sim.scoring';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const HOUR = 3_600_000;

const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  time: new Date(T0 + i * HOUR),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 0,
});

/** Flat bars well away from any level, to pad a series out to full length. */
const flat = (from: number, count: number, price: number): Candle[] =>
  Array.from({ length: count }, (_, i) => bar(from + i, price, price, price, price));

const decidedAt = new Date(T0);
/** Long enough after the decision that the whole window has elapsed. */
const NOW = T0 + (FILL_WINDOW_HOURS + MAX_HOLD_HOURS + 1) * HOUR;

describe('bar 1: a bar that reaches the entry and then the stop is STOPPED', () => {
  // THE KNOWN OFF-BY-ONE. `backtest-plans.ts` resolved from `fillIdx + 1` and
  // so skipped the very bar that decided the trade: 146 of 6,084 trades had a
  // fill bar that breached the stop, and 17 scored better than STOPPED.
  //
  // This fixture rallies hard AFTER the stop bar. Wired correctly the trade is
  // stopped at -1R. Wired from `fillIdx + 1` it survives and rides to +5R, so a
  // regression cannot pass quietly — it flips the sign of the result.
  const candles: Candle[] = [
    bar(0, 105, 106, 104, 105),
    bar(1, 104, 106, 97, 104),
    ...flat(2, 95, 110),
  ];

  const plan = {
    direction: 'long' as const,
    entry: 100,
    stop: 98,
    targets: [{ price: 110, weightPercent: 100 }],
  };

  it('scores STOPPED, not a winner', () => {
    const got = scoreSimTrade(plan, candles, decidedAt, NOW);
    expect(got.outcome).toBe('STOPPED');
    expect(got.grossR).toBeCloseTo(-1, 10);
  });

  it('would have read as a large winner had the fill bar been skipped', () => {
    // The same plan against the same series with the deciding bar removed —
    // exactly what `fillIdx + 1` amounts to. Asserted so the fixture is proven
    // to discriminate rather than assumed to.
    const withoutStopBar = [candles[0], bar(1, 104, 106, 100, 104), ...flat(2, 95, 110)];
    const got = scoreSimTrade(plan, withoutStopBar, decidedAt, NOW);
    expect(got.outcome).toBe('ALL_TARGETS');
    expect(got.grossR as number).toBeGreaterThan(4);
  });
});

describe('bar 2: cost is charged against the stop distance, not the entry', () => {
  // A flat per-trade cost passes any single-plan test. Two plans with the same
  // entry and different stops is the smallest fixture that separates them.
  const targets = [{ price: 200, weightPercent: 100 }];

  it('a 0.5% stop pays four times what a 2% stop pays', () => {
    const tight = toScorablePlan({ direction: 'long', entry: 100, stop: 99.5, targets });
    const wide = toScorablePlan({ direction: 'long', entry: 100, stop: 98, targets });

    expect(tight.riskPercent).toBeCloseTo(0.5, 10);
    expect(wide.riskPercent).toBeCloseTo(2, 10);
    expect(ROUND_TRIP_PCT / tight.riskPercent).toBeCloseTo(0.5, 10);
    expect(ROUND_TRIP_PCT / wide.riskPercent).toBeCloseTo(0.125, 10);
  });

  it('shows up as a different netR on identical price action', () => {
    // Both plans stop out for the same -1R gross. Only the cost differs, so any
    // difference in netR is the cost model and nothing else.
    const candles = [bar(0, 100, 101, 97, 97), ...flat(1, 96, 97)];
    const tight = scoreSimTrade(
      { direction: 'long', entry: 100, stop: 99.5, targets },
      candles,
      decidedAt,
      NOW,
    );
    const wide = scoreSimTrade(
      { direction: 'long', entry: 100, stop: 98, targets },
      candles,
      decidedAt,
      NOW,
    );

    expect(tight.grossR).toBeCloseTo(-1, 10);
    expect(wide.grossR).toBeCloseTo(-1, 10);
    expect(tight.netR).toBeCloseTo(-1.5, 10);
    expect(wide.netR).toBeCloseTo(-1.125, 10);
    expect(tight.netR).not.toBeCloseTo(wide.netR as number, 3);
  });

  it('derives risk rather than trusting a stored number', () => {
    const short = toScorablePlan({ direction: 'short', entry: 100, stop: 102, targets: [] });
    expect(short.riskPerUnit).toBeCloseTo(2, 10);
    expect(short.riskPercent).toBeCloseTo(2, 10);
  });
});

describe('bar 3: the bar containing the decision cannot fill the trade', () => {
  // Its low and high partly precede the moment the analyst spoke. Filling there
  // takes a price that was gone before the plan existed.
  it('drops bars that opened before the decision', () => {
    const candles = [bar(-1, 105, 106, 95, 105), bar(0, 105, 106, 104, 105)];
    const forward = forwardBars(candles, decidedAt);
    expect(forward).toHaveLength(1);
    expect(forward[0].time.getTime()).toBe(T0);
  });

  it('does not fill on a low that only the earlier bar reached', () => {
    const candles = [bar(-1, 105, 106, 95, 105), ...flat(0, 96, 105)];
    const plan = {
      direction: 'long' as const,
      entry: 100,
      stop: 98,
      targets: [{ price: 110, weightPercent: 100 }],
    };

    expect(scoreSimTrade(plan, candles, decidedAt, NOW).outcome).toBe('MISSED');
    // Proof the fixture discriminates: move that same low into the window and
    // the trade fills.
    const inside = [bar(0, 105, 106, 95, 105), ...flat(1, 95, 105)];
    expect(scoreSimTrade(plan, inside, decidedAt, NOW).outcome).not.toBe('MISSED');
  });
});

describe('unresolved outcomes carry no numbers', () => {
  const plan = {
    direction: 'long' as const,
    entry: 100,
    stop: 98,
    targets: [{ price: 110, weightPercent: 100 }],
  };

  it('is PENDING before the fill window has passed', () => {
    const candles = flat(0, 3, 105);
    const got = scoreSimTrade(plan, candles, decidedAt, T0 + 3 * HOUR);
    expect(got.outcome).toBe('PENDING');
    expect(got.netR).toBeNull();
  });

  it('is OPEN, with a null netR, while a filled trade still has time', () => {
    // Scoring a live position as zero is how §14h read -0.106R instead of
    // -0.202R: an unfinished trade is not a flat one.
    const candles = [bar(0, 105, 106, 99, 101), ...flat(1, 9, 101)];
    const got = scoreSimTrade(plan, candles, decidedAt, T0 + 10 * HOUR);
    expect(got.outcome).toBe('OPEN');
    expect(got.netR).toBeNull();
    expect(got.grossR).toBeNull();
  });

  it('is UNSCOREABLE when the history does not reach back to the decision', () => {
    const candles = flat(40, 50, 105);
    const got = scoreSimTrade(plan, candles, decidedAt, NOW);
    expect(got.outcome).toBe('UNSCOREABLE');
    expect(got.netR).toBeNull();
  });

  it('is EXPIRED once a filled trade runs out of time', () => {
    const candles = [bar(0, 105, 106, 99, 101), ...flat(1, 120, 101)];
    const got = scoreSimTrade(plan, candles, decidedAt, NOW);
    expect(got.outcome).toBe('EXPIRED');
    expect(got.netR).not.toBeNull();
  });
});
