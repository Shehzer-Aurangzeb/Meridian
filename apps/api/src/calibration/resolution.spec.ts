import {
  isTouch, resolveTouch, bounceRate, emptyTally,
  TOUCH_ATR_MULTIPLE, BOUNCE_ATR_MULTIPLE, BREAK_ATR_MULTIPLE, RESOLUTION_WINDOW_BARS,
} from './resolution';
import { Candle } from '../common/types/candle.types';

const bar = (low: number, high: number, close: number): Candle => ({
  time: new Date(0),
  open: (low + high) / 2,
  high,
  low,
  close,
  volume: 1,
});

const ATR = 10;
const support = { center: 100, type: 'support' as const };
const resistance = { center: 100, type: 'resistance' as const };

describe('isTouch', () => {
  it('uses the bar range, not the close', () => {
    // Price traded into the zone and left within the hour. A close-only test
    // would miss exactly the fast rejections a bounce rate is about.
    expect(isTouch(bar(99, 120, 118), support, ATR)).toBe(true);
  });

  it('respects the tolerance band on both sides', () => {
    const tol = TOUCH_ATR_MULTIPLE * ATR; // 1.5
    expect(isTouch(bar(101.4, 101.4, 101.4), support, ATR)).toBe(true);
    expect(isTouch(bar(101.6, 101.6, 101.6), support, ATR)).toBe(false);
    expect(isTouch(bar(98.6, 98.6, 98.6), support, ATR)).toBe(true);
    expect(isTouch(bar(98.4, 98.4, 98.4), support, ATR)).toBe(false);
  });

  it('is not a touch when ATR is unusable', () => {
    expect(isTouch(bar(99, 101, 100), support, 0)).toBe(false);
    expect(isTouch(bar(99, 101, 100), support, NaN)).toBe(false);
  });
});

describe('resolveTouch — support', () => {
  it('bounces when price rises far enough away', () => {
    // Away for a support is UP: 100 + 0.5*10 = 105.
    expect(resolveTouch(support, ATR, [bar(99, 105, 104)])).toBe('bounce');
    expect(resolveTouch(support, ATR, [bar(99, 104.9, 104)])).toBe('neither');
  });

  it('breaks on a CLOSE through, not a wick through', () => {
    // Through for a support is DOWN: 100 - 0.5*10 = 95.
    // A wick to 94 that closes back at 99 is the level holding.
    expect(resolveTouch(support, ATR, [bar(94, 100, 99)])).toBe('neither');
    expect(resolveTouch(support, ATR, [bar(94, 100, 95)])).toBe('break');
  });

  it('calls a bar that does both ambiguous rather than guessing', () => {
    // High reaches 105 AND close is at 95. Intrabar order is unknowable from
    // OHLC, so assigning it either way would be inventing a fact.
    expect(resolveTouch(support, ATR, [bar(94, 105, 95)])).toBe('ambiguous');
  });

  it('takes whichever happens first across bars', () => {
    const flat = bar(99, 101, 100);
    expect(resolveTouch(support, ATR, [flat, bar(94, 100, 95), bar(99, 106, 105)])).toBe('break');
    expect(resolveTouch(support, ATR, [flat, bar(99, 106, 105), bar(94, 100, 95)])).toBe('bounce');
  });
});

describe('resolveTouch — resistance is the mirror, not a sign flip', () => {
  it('bounces DOWN and breaks UP', () => {
    // A sign error here inverts every published probability and nothing throws,
    // so both directions are asserted explicitly.
    expect(resolveTouch(resistance, ATR, [bar(95, 101, 96)])).toBe('bounce');
    expect(resolveTouch(resistance, ATR, [bar(99, 106, 105)])).toBe('break');
  });

  it('does not treat an upward move as a resistance bounce', () => {
    expect(resolveTouch(resistance, ATR, [bar(99, 104, 103)])).toBe('neither');
  });
});

describe('resolveTouch — the window', () => {
  it('stops looking after the window closes', () => {
    const flat = bar(99, 101, 100);
    const after = [...Array(RESOLUTION_WINDOW_BARS).fill(flat), bar(99, 120, 119)];
    expect(resolveTouch(support, ATR, after)).toBe('neither');
  });

  it('resolves on the last bar inside the window', () => {
    const flat = bar(99, 101, 100);
    const after = [...Array(RESOLUTION_WINDOW_BARS - 1).fill(flat), bar(99, 106, 105)];
    expect(resolveTouch(support, ATR, after)).toBe('bounce');
  });

  it('is neither, not a crash, with no bars at all', () => {
    expect(resolveTouch(support, ATR, [])).toBe('neither');
  });

  it('refuses to resolve without a usable ATR', () => {
    expect(resolveTouch(support, 0, [bar(99, 200, 199)])).toBe('neither');
  });
});

describe('bounceRate', () => {
  it('divides by RESOLVED touches and reports what it is silent about', () => {
    const t = { ...emptyTally(), bounce: 60, break: 40, neither: 80, ambiguous: 20 };
    const got = bounceRate(t);
    expect(got.rate).toBeCloseTo(0.6, 10); // 60 of 100 resolved, not of 200
    expect(got.resolved).toBe(100);
    expect(got.total).toBe(200);
    expect(got.unresolvedShare).toBeCloseTo(0.5, 10);
  });

  it('returns null rather than 0/0', () => {
    const got = bounceRate({ ...emptyTally(), neither: 5 });
    expect(got.rate).toBeNull();
    expect(got.unresolvedShare).toBe(1);
  });

  it('handles an empty tally without NaN', () => {
    const got = bounceRate(emptyTally());
    expect(got.rate).toBeNull();
    expect(got.unresolvedShare).toBe(0);
  });
});

describe('the frozen constants', () => {
  it('are the values the calibration was fitted against', () => {
    // These are not tuning knobs. Changing one invalidates every published
    // probability, so a change here must break this test loudly.
    expect(TOUCH_ATR_MULTIPLE).toBe(0.15);
    expect(BOUNCE_ATR_MULTIPLE).toBe(0.5);
    expect(BREAK_ATR_MULTIPLE).toBe(0.5);
    expect(RESOLUTION_WINDOW_BARS).toBe(4);
  });
});
