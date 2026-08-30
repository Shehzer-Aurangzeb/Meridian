import { FlowCursor, nearest, Series } from './panel-build';
import { flowAsOf, FLOW_EMBARGO_MS } from '../../src/common/replay/plan-replay';

const HOUR = 3_600_000;

const series = (pairs: Array<[number, number]>): Series => ({
  ts: Float64Array.from(pairs.map((p) => p[0])),
  value: Float64Array.from(pairs.map((p) => p[1])),
});

describe('FlowCursor', () => {
  it('publishes exactly what flowAsOf publishes, at every bar', () => {
    // The cursor exists only because flowAsOf is O(n) per call and there are
    // millions of rows. If it ever disagrees, the speed bought a wrong answer.
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < 500; i += 1) pairs.push([i * 5 * 60_000, Math.sin(i) * 10 + 100]);
    const s = series(pairs);
    const samples = pairs.map(([ts, value]) => ({ ts: new Date(ts), value }));

    const cursor = new FlowCursor(s);
    for (let bar = 0; bar <= 42; bar += 1) {
      const asOf = bar * HOUR;
      cursor.advance(asOf);
      const expected = flowAsOf(samples, asOf);
      if (expected.length === 0) {
        expect(Number.isNaN(cursor.last())).toBe(true);
      } else {
        expect(cursor.last()).toBe(expected[expected.length - 1].value);
      }
    }
  });

  it('holds a print back until the embargo has passed', () => {
    const s = series([[0, 7]]);
    const cursor = new FlowCursor(s);
    cursor.advance(FLOW_EMBARGO_MS - 1);
    expect(Number.isNaN(cursor.last())).toBe(true);
    cursor.advance(FLOW_EMBARGO_MS);
    expect(cursor.last()).toBe(7);
  });

  it('scores the newest reading against its own trailing window', () => {
    // Four readings a day apart: 1, 2, 3, then 10. Mean 4, population sd 3.5.
    const day = 24 * HOUR;
    const s = series([[0, 1], [day, 2], [2 * day, 3], [3 * day, 10]]);
    const cursor = new FlowCursor(s, 0, 7 * day);
    cursor.advance(3 * day);
    expect(cursor.z()).toBeCloseTo((10 - 4) / Math.sqrt(12.5), 10);
  });

  it('drops readings that fall out of the trailing window', () => {
    const day = 24 * HOUR;
    // At asOf = day 3 with a two-day window, the reading stamped at day 0 is
    // out of scope and 2, 3, 10 remain: mean 5, population sd sqrt(38/3).
    const s = series([[0, 1], [day, 2], [2 * day, 3], [3 * day, 10]]);
    const cursor = new FlowCursor(s, 0, 2 * day);
    cursor.advance(3 * day);
    expect(cursor.z()).toBeCloseTo((10 - 5) / Math.sqrt(38 / 3), 10);
  });

  it('refuses a z-score from a single print instead of dividing by zero', () => {
    const s = series([[0, 5]]);
    const cursor = new FlowCursor(s, 0, HOUR);
    cursor.advance(0);
    expect(cursor.last()).toBe(5);
    expect(Number.isNaN(cursor.z())).toBe(true);
  });

  it('reports how stale the reading is', () => {
    const s = series([[0, 5]]);
    const cursor = new FlowCursor(s, 0, 7 * 24 * HOUR);
    cursor.advance(2 * HOUR);
    expect(cursor.ageMinutes(2 * HOUR)).toBe(120);
  });
});

describe('nearest', () => {
  const lv = (price: number, type: string, touchCount = 3, held = true) => ({
    price,
    type,
    touchCount,
    held,
  });

  it('signs the distance, so a support above spot stays distinguishable', () => {
    const levels = [lv(90, 'support'), lv(110, 'resistance')];
    expect(nearest(levels, 100, 'support').distPct).toBeCloseTo(-10, 10);
    expect(nearest(levels, 100, 'resistance').distPct).toBeCloseTo(10, 10);
    // A support that price has already fallen through is above spot, and that
    // is a different market than one sitting below.
    expect(nearest([lv(110, 'support')], 100, 'support').distPct).toBeCloseTo(10, 10);
  });

  it('picks the closest of its own type, ignoring the other side', () => {
    const levels = [lv(80, 'support'), lv(95, 'support'), lv(96, 'resistance')];
    expect(nearest(levels, 100, 'support').distPct).toBeCloseTo(-5, 10);
  });

  it('returns NaN rather than a number when the side is empty', () => {
    const got = nearest([lv(110, 'resistance')], 100, 'support');
    expect(Number.isNaN(got.distPct)).toBe(true);
    expect(Number.isNaN(got.touches)).toBe(true);
  });
});
