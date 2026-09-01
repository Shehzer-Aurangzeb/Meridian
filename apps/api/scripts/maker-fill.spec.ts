import { monthsBetween, parseKlines, fillIndex, indexAt, simulate, daysIn, Minute } from './maker-fill';

const m = (ts: number, high: number, low: number, close: number): Minute => ({ ts, high, low, close });
const MIN = 60_000;

describe('monthsBetween', () => {
  it('walks inclusively across a year boundary', () => {
    expect(monthsBetween('2023-11', '2024-02')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
    expect(monthsBetween('2024-03', '2024-03')).toEqual(['2024-03']);
  });
});

describe('parseKlines', () => {
  const row = '1685577600000,27201.10,27214.20,27200.00,27202.90,436.2,1685577659999,1,1,1,1,0';

  it('reads a file that has a header', () => {
    const got = parseKlines(`open_time,open,high,low,close,v,ct,qv,n,tb,tbq,ig\n${row}`);
    expect(got).toEqual([{ ts: 1685577600000, high: 27214.2, low: 27200, close: 27202.9 }]);
  });

  it('reads a file that has none, without eating the first bar', () => {
    // The archive gained a header partway through its history. Assuming either
    // way costs a silent hole or a NaN bar, so the format is detected.
    expect(parseKlines(row)).toHaveLength(1);
  });
});

describe('fillIndex', () => {
  const bars = [m(0, 101, 99, 100), m(MIN, 102, 100, 101), m(2 * MIN, 105, 103, 104)];

  it('fills a buy when some minute trades down to the price', () => {
    expect(fillIndex(bars, 0, 99.5, 'buy', 3)).toBe(0);
    expect(fillIndex(bars, 1, 100, 'buy', 3)).toBe(1);
  });

  it('fills a sell when some minute trades up to the price', () => {
    expect(fillIndex(bars, 0, 104.9, 'sell', 3)).toBe(2);
  });

  it('gives up when patience runs out, rather than filling late', () => {
    // 104.9 is reached at minute 2, so a patience of 2 must NOT see it.
    expect(fillIndex(bars, 0, 104.9, 'sell', 2)).toBe(-1);
  });

  it('touching exactly counts as filling', () => {
    expect(fillIndex(bars, 0, 99, 'buy', 1)).toBe(0);
  });
});

describe('indexAt', () => {
  const bars = [m(0, 1, 1, 1), m(MIN, 1, 1, 1), m(2 * MIN, 1, 1, 1)];
  it('finds the first minute at or after a timestamp', () => {
    expect(indexAt(bars, 0)).toBe(0);
    expect(indexAt(bars, MIN - 1)).toBe(1);
    expect(indexAt(bars, 2 * MIN)).toBe(2);
    expect(indexAt(bars, 99 * MIN)).toBe(3);
  });
});

describe('simulate', () => {
  /** Flat at 100, then a dip to 98, then back to 100, then a rise to 102. */
  const bars: Minute[] = [];
  for (let i = 0; i < 400; i += 1) {
    const price = i < 100 ? 100 : i < 110 ? 98 : i < 300 ? 100 : 102;
    bars.push(m(i * MIN, price + 0.5, price - 0.5, price));
  }
  // horizon 2h = 120 minutes, so the exit lands at bar 220 and stays inside
  // the fixture. A horizon that runs past the last bar makes `simulate` return
  // null, which is correct and is not what these tests are about.
  const sig = { ts: 100 * MIN, coin: 'BTC', side: 'buy' as const, horizon: 2 };

  it('returns null rather than a trade when the horizon runs past the data', () => {
    // Scoring a trade whose exit never happened is how an unresolved position
    // gets counted at full weight, which this project has already paid for once.
    expect(simulate(bars, { ...sig, ts: 350 * MIN, horizon: 5 }, 15, 0)).toBeNull();
  });

  it('reports no fill when price never comes back to the order', () => {
    // Posting 5% below the reference: nothing here trades that low.
    const got = simulate(bars, sig, 15, 500)!;
    expect(got.entryFilled).toBe(false);
    expect(Number.isNaN(got.grossBp)).toBe(true);
  });

  it('fills at the posted price, not at the price it drifted to', () => {
    // The whole point of a maker order: you get YOUR price or nothing. If this
    // ever returned the market price the fee saving would be double-counted.
    const got = simulate(bars, sig, 15, 0)!;
    expect(got.entryFilled).toBe(true);
    expect(got.entryWaitMin).toBe(0);
  });

  it('signs the return for the side', () => {
    const long = simulate(bars, { ...sig, ts: 200 * MIN }, 15, 0)!;
    const short = simulate(bars, { ...sig, ts: 200 * MIN, side: 'sell' }, 15, 0)!;
    expect(long.grossBp).toBeCloseTo(-short.grossBp, 6);
  });
});

describe('daysIn', () => {
  it('lists a whole past month', () => {
    const got = daysIn('2024-02', new Date('2026-01-01'));
    expect(got).toHaveLength(29); // 2024 is a leap year
    expect(got[0]).toBe('2024-02-01');
    expect(got[28]).toBe('2024-02-29');
  });

  it('stops at today, so an unfinished month is not asked for in full', () => {
    const got = daysIn('2026-08', new Date('2026-08-05T00:00:00Z'));
    expect(got).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
  });

  it('returns nothing for a month that has not started', () => {
    expect(daysIn('2026-12', new Date('2026-08-05T00:00:00Z'))).toEqual([]);
  });
});
