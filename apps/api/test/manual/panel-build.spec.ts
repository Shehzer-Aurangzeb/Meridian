import { FlowCursor, nearest, Series, tripleBarrier, crossVenue } from './panel-build';
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

describe('tripleBarrier', () => {
  const bar = (high: number, low: number, close: number) =>
    ({ time: new Date(0), open: close, high, low, close, volume: 0 });

  it('labels +1 when the upper barrier is reached first', () => {
    expect(tripleBarrier([bar(101, 99.9, 100.5), bar(90, 89, 89)], 100, 0.01)).toBe(1);
  });

  it('labels -1 when the lower barrier is reached first', () => {
    expect(tripleBarrier([bar(100.5, 99, 99.2), bar(120, 119, 119)], 100, 0.01)).toBe(-1);
  });

  it('labels 0 when neither barrier is reached in the window', () => {
    expect(tripleBarrier([bar(100.5, 99.6, 100.1), bar(100.4, 99.7, 100)], 100, 0.01)).toBe(0);
  });

  it('breaks a same-bar tie on that bar own close, never on a later bar', () => {
    // OHLC cannot say which barrier came first inside one bar. Using the close
    // keeps the decision inside the bar; anything else would read the future.
    expect(tripleBarrier([bar(101.5, 98.5, 100.4)], 100, 0.01)).toBe(1);
    expect(tripleBarrier([bar(101.5, 98.5, 99.6)], 100, 0.01)).toBe(-1);
  });

  it('touches count, so a barrier reached exactly is reached', () => {
    expect(tripleBarrier([bar(101, 100, 100.5)], 100, 0.01)).toBe(1);
  });
});

describe('crossVenue', () => {
  const N = NaN;

  it('signs the spread and scales it to basis points', () => {
    // Bybit 10 bp above Binance, OKX 10 bp below.
    const [okx, bybit] = crossVenue(100, 99.9, 100.1, N, N, N, N);
    expect(okx).toBeCloseTo(-10, 6);
    expect(bybit).toBeCloseTo(10, 6);
  });

  it('puts an $80,000 coin and a $0.50 coin on the same scale', () => {
    // The whole reason spreads are in bp: a raw price difference would rank the
    // ten coins by their price and nothing else, which is the static tilt the
    // Phase B persistence gate exists to catch.
    const big = crossVenue(80_000, 80_008, N, N, N, N, N)[0];
    const small = crossVenue(0.5, 0.50005, N, N, N, N, N)[0];
    expect(big).toBeCloseTo(small, 6);
  });

  it('needs two venues for a dispersion, not one', () => {
    expect(Number.isNaN(crossVenue(100, N, N, N, N, N, N)[2])).toBe(true);
    expect(crossVenue(100, 101, N, N, N, N, N)[2]).toBeGreaterThan(0);
  });

  it('keeps the readings the surviving venues still support', () => {
    // OKX has real gaps. One missing venue must not delete Bybit's spread.
    const [okx, bybit, disp] = crossVenue(100, N, 100.1, N, N, N, N);
    expect(Number.isNaN(okx)).toBe(true);
    expect(bybit).toBeCloseTo(10, 6);
    expect(disp).toBeGreaterThan(0);
  });

  it('builds the open-interest share from notional on both sides', () => {
    // Binance 100 units at 100 = 10,000. Bybit 300 units at 100 = 30,000.
    // Bybit's share is 30,000 / 40,000.
    expect(crossVenue(100, N, 100, N, N, 100, 300)[4]).toBeCloseTo(0.75, 10);
  });

  it('uses each venue own price for its own notional', () => {
    // Same contract counts, Bybit priced 1% higher: its notional share must
    // rise slightly rather than stay put.
    const same = crossVenue(100, N, 100, N, N, 100, 100)[4];
    const richer = crossVenue(100, N, 101, N, N, 100, 100)[4];
    expect(same).toBeCloseTo(0.5, 10);
    expect(richer).toBeGreaterThan(same);
  });

  it('subtracts funding rather than ratioing it, so a zero is safe', () => {
    expect(crossVenue(100, N, N, 0.0001, 0.0003, N, N)[3]).toBeCloseTo(0.0002, 12);
    expect(crossVenue(100, N, N, 0, 0, N, N)[3]).toBe(0);
  });

  it('returns NaN rather than a number when a side is missing', () => {
    const got = crossVenue(100, N, N, N, N, N, N);
    expect(got.filter((x) => Number.isFinite(x))).toHaveLength(0);
  });
});

describe('venue cursor embargo', () => {
  const HOUR = 3_600_000;
  const series = (pairs: Array<[number, number]>): Series => ({
    ts: Float64Array.from(pairs.map((p) => p[0])),
    value: Float64Array.from(pairs.map((p) => p[1])),
  });

  it('reads the bar that closed AT asOf, not the one before it', () => {
    // The bug this exists for. Venue rows are stamped at bar close, so the row
    // for the decision bar has ts EXACTLY equal to asOf. Under the 5-minute
    // publication embargo, `ts + 5min <= asOf` is false and the cursor silently
    // falls back an hour. The panel then compared Binance at T against the
    // venue at T-1h and called the difference a spread: correlation 0.995 with
    // the one-hour return, and a mean magnitude matching it to 0.2 bp.
    //
    // A bar close has no publication delay -- it is known at the close, which is
    // the same instant the panel reads Binance's own close at.
    const asOf = 3 * HOUR;
    const s = series([[HOUR, 100], [2 * HOUR, 200], [3 * HOUR, 300]]);

    const embargoed = new FlowCursor(s);
    embargoed.advance(asOf);
    expect(embargoed.last()).toBe(200); // an hour stale, which was the bug

    const venue = new FlowCursor(s, 0);
    venue.advance(asOf);
    expect(venue.last()).toBe(300);
  });

  it('still refuses a bar stamped after asOf', () => {
    // Zero embargo is not "read anything". A bar that closes later has not
    // happened yet.
    const s = series([[3 * HOUR, 300], [4 * HOUR, 400]]);
    const c = new FlowCursor(s, 0);
    c.advance(3 * HOUR);
    expect(c.last()).toBe(300);
    expect(c.ageMinutes(3 * HOUR)).toBe(0);
  });
});
