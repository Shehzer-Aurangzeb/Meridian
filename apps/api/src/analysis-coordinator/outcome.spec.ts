import { Candle } from '../common/types/candle.types';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { FILL_WINDOW_HOURS, scorePlans } from './outcome';

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
    const candles = [bar(1, 105, 115)];
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
