import { pageBack, Sample } from './venue-backfill';

const HOUR = 3_600_000;

/** A fake venue holding `n` hourly bars ending at `end`, served newest-first. */
const venue = (end: number, n: number, pageRows: number) => {
  const all: Sample[] = Array.from({ length: n }, (_, i) => ({
    symbol: 'BTC',
    metric: 'fake',
    ts: end - i * HOUR,
    value: i,
  }));
  const calls: number[] = [];
  return {
    calls,
    source: {
      metric: 'fake',
      pageRows,
      stepMs: HOUR,
      page: async (_coin: string, cursor: number): Promise<Sample[]> => {
        calls.push(cursor);
        return all.filter((r) => r.ts <= cursor).slice(0, pageRows);
      },
    },
  };
};

describe('pageBack', () => {
  const END = Date.parse('2026-01-10T00:00:00Z');

  it('walks back across pages until `from` is reached', async () => {
    const v = venue(END, 500, 100);
    const got = await pageBack(v.source, 'BTC', END - 300 * HOUR, END, 0);
    expect(got).toHaveLength(301);
    expect(Math.min(...got.map((r) => r.ts))).toBe(END - 300 * HOUR);
    expect(v.calls.length).toBeGreaterThan(2);
  });

  it('does not treat a short page as the end of history', async () => {
    // The trap this exists for: /fapi/v1/fundingRate accepts limit=1000 and
    // caps at 500, so the FIRST page looked short, was read as the live edge,
    // and a 2,200-day backfill silently collected 166 days per coin while
    // reporting no failures. A page shorter than asked for is normal; the only
    // real end is a page that yields nothing older.
    const v = venue(END, 400, 7); // every page is "short" against any expectation
    const got = await pageBack(v.source, 'BTC', END - 300 * HOUR, END, 0);
    expect(got).toHaveLength(301);
  });

  it('stops when the venue stops going back, rather than looping', async () => {
    const v = venue(END, 50, 100);
    const got = await pageBack(v.source, 'BTC', END - 10_000 * HOUR, END, 0);
    expect(got).toHaveLength(50);
    // One page returns everything, the second makes no progress and ends it.
    expect(v.calls).toHaveLength(2);
  });

  it('returns nothing, and does not hang, on a venue with no data', async () => {
    const v = venue(END, 0, 100);
    expect(await pageBack(v.source, 'BTC', END - 100 * HOUR, END, 0)).toEqual([]);
    expect(v.calls).toHaveLength(1);
  });

  it('drops rows older than `from` rather than storing them', async () => {
    const v = venue(END, 500, 100);
    const from = END - 50 * HOUR;
    const got = await pageBack(v.source, 'BTC', from, END, 0);
    expect(got.every((r) => r.ts >= from)).toBe(true);
  });
});
