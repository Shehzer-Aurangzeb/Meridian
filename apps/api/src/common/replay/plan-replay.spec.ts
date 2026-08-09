import { Candle } from '../types/candle.types';
import { completedAsOf, scoreLadder, TIMEFRAME_MS } from './plan-replay';

const HOUR = 3_600_000;
const bar = (
  timeMs: number,
  low: number,
  high: number,
  close = (low + high) / 2,
): Candle => ({
  time: new Date(timeMs),
  open: close,
  high,
  low,
  close,
  volume: 1,
});

describe('completedAsOf — the look-ahead guard', () => {
  it('excludes a candle that is still forming', () => {
    // A 12h candle opening at t=0 is complete at t=12h, not before.
    const candles = [bar(0, 1, 2), bar(12 * HOUR, 1, 2)];

    expect(completedAsOf(candles, TIMEFRAME_MS['12h'], 12 * HOUR, 10)).toHaveLength(1);
    expect(completedAsOf(candles, TIMEFRAME_MS['12h'], 12 * HOUR - 1, 10)).toHaveLength(0);
    expect(completedAsOf(candles, TIMEFRAME_MS['12h'], 24 * HOUR, 10)).toHaveLength(2);
  });

  it('keeps the newest candles when trimming to the limit', () => {
    const candles = [0, 1, 2, 3].map((i) => bar(i * HOUR, i, i));
    const got = completedAsOf(candles, HOUR, 4 * HOUR, 2);
    expect(got.map((c) => c.low)).toEqual([2, 3]);
  });
});

describe('scoreLadder', () => {
  // entry 100, stop 90 => 1R = 10. Targets at 110/120/130 = 1R/2R/3R.
  const long = {
    direction: 'long' as const,
    averageEntry: 100,
    stop: 90,
    riskPerUnit: 10,
    targets: [
      { price: 110, weightPercent: 33 },
      { price: 120, weightPercent: 33 },
      { price: 130, weightPercent: 34 },
    ],
  };

  it('a clean stop with nothing hit is exactly -1R', () => {
    const r = scoreLadder([bar(0, 89, 95)], long);
    expect(r.realizedR).toBeCloseTo(-1);
    expect(r.status).toBe('STOPPED');
  });

  it('all three targets blend to the plan R', () => {
    const r = scoreLadder([bar(0, 99, 111), bar(HOUR, 109, 121), bar(2 * HOUR, 119, 131)], long);
    expect(r.realizedR).toBeCloseTo(0.33 * 1 + 0.33 * 2 + 0.34 * 3);
    expect(r.status).toBe('ALL_TARGETS');
    expect(r.targetsHit).toBe(3);
  });

  it('moves the stop to breakeven after TP1, so the rest risks 0R not -1R', () => {
    // TP1 hit, then price collapses through the ORIGINAL stop.
    const r = scoreLadder([bar(0, 99, 111), bar(HOUR, 85, 100)], long);
    expect(r.realizedR).toBeCloseTo(0.33 * 1); // 67% exits at breakeven
    expect(r.status).toBe('PARTIAL');
  });

  it('takes the stop when one bar straddles both — no intrabar ordering exists', () => {
    const r = scoreLadder([bar(0, 89, 131)], long);
    expect(r.realizedR).toBeCloseTo(-1);
    expect(r.targetsHit).toBe(0);
  });

  it('marks unfilled weight to market at the end of the window', () => {
    // TP1 only, window ends with price at 115.
    const r = scoreLadder([bar(0, 99, 111), bar(HOUR, 108, 116, 115)], long);
    expect(r.realizedR).toBeCloseTo(0.33 * 1 + 0.67 * 1.5);
    expect(r.status).toBe('TIMEOUT');
  });

  it('is symmetric for shorts', () => {
    const short = {
      direction: 'short' as const,
      averageEntry: 100,
      stop: 110,
      riskPerUnit: 10,
      targets: [{ price: 90, weightPercent: 100 }],
    };
    expect(scoreLadder([bar(0, 89, 101)], short).realizedR).toBeCloseTo(1);
    expect(scoreLadder([bar(0, 99, 111)], short).realizedR).toBeCloseTo(-1);
  });

  it('rides the whole position when the plan has no targets', () => {
    const r = scoreLadder([bar(0, 99, 105, 105)], { ...long, targets: [] });
    expect(r.realizedR).toBeCloseTo(0.5);
    expect(r.status).toBe('TIMEOUT');
  });
});
