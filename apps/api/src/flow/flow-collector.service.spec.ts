import axios from 'axios';
import { FlowCollectorService, METRICS, toPair } from './flow-collector.service';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

/** Enough of PrismaService to record what the collector tried to write. */
function fakePrisma() {
  const written: Array<{ symbol: string; metric: string; ts: Date; value: number }> = [];
  const prisma = {
    flowSample: {
      createMany: jest.fn(async ({ data }: { data: typeof written }) => {
        written.push(...data);
        return { count: data.length };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, written };
}

const spec = (metric: string) => METRICS.find((m) => m.metric === metric)!;

describe('toPair', () => {
  it('adds the quote currency, and does not add it twice', () => {
    expect(toPair('btc')).toBe('BTCUSDT');
    expect(toPair('BTCUSDT')).toBe('BTCUSDT');
  });
});

describe('parsers', () => {
  it('reads the named field out of the /futures/data/ shape', () => {
    expect(spec('openInterest').parse({ timestamp: 1000, sumOpenInterest: '42.5' })).toEqual({
      ts: 1000,
      value: 42.5,
    });
    expect(spec('longShortRatio').parse({ timestamp: 1000, longShortRatio: '1.8' })).toEqual({
      ts: 1000,
      value: 1.8,
    });
    expect(spec('takerBuySellRatio').parse({ timestamp: 1000, buySellRatio: '0.9' })).toEqual({
      ts: 1000,
      value: 0.9,
    });
  });

  it('reads the close out of a kline array', () => {
    // [openTime, open, high, low, close, ...]
    expect(spec('premium').parse([1000, '1', '2', '0', '1.5', '99'])).toEqual({
      ts: 1000,
      value: 1.5,
    });
  });

  it('returns null rather than NaN when a row is malformed', () => {
    expect(spec('openInterest').parse({ timestamp: 1000 })).toBeNull();
    expect(spec('openInterest').parse({ sumOpenInterest: '1' })).toBeNull();
    expect(spec('premium').parse([1000, '1'])).toBeNull();
    expect(spec('premium').parse({ notAnArray: true })).toBeNull();
  });
});

describe('FlowCollectorService.collect', () => {
  beforeEach(() => mockedGet.mockReset());

  // Rows must sit inside the requested window or they are correctly discarded.
  const NOW = 10_000_000_000;
  const RECENT = NOW - 3_600_000;

  const rowsFor = (path: string, times: number[]) =>
    path.includes('premiumIndexKlines')
      ? times.map((t) => [t, '1', '2', '0', '1.5'])
      : times.map((t) => ({
          timestamp: t,
          sumOpenInterest: '10',
          longShortRatio: '2',
          buySellRatio: '3',
        }));

  it('stores the bare coin, not the trading pair', async () => {
    mockedGet.mockImplementation(async (url: string) => ({
      data: rowsFor(url, [RECENT]),
    }));
    const { prisma, written } = fakePrisma();

    await new FlowCollectorService(prisma).collect(['BTC'], 1, NOW);

    expect(written.length).toBe(METRICS.length);
    expect(new Set(written.map((w) => w.symbol))).toEqual(new Set(['BTC']));
    // ...but Binance was asked for the pair.
    expect(mockedGet.mock.calls[0][1]?.params.symbol).toBe('BTCUSDT');
  });

  it('stops paging when a full page does not move older', async () => {
    // The failure this guards: an endpoint that clamps endTime and keeps
    // returning the same newest rows. The page is FULL every time, so the
    // short-page check never fires and only the "did we move older" check can
    // stop it. Without that check this loops for ever against Binance.
    const now = 10_000_000_000;
    mockedGet.mockImplementation(async (url: string) => {
      const size = METRICS.find((m) => url.includes(m.path))!.maxRows;
      const times = Array.from({ length: size }, (_, i) => now - size + i);
      return { data: rowsFor(url, times) };
    });
    const { prisma } = fakePrisma();

    const result = await new FlowCollectorService(prisma).collect(['BTC'], 1, now);

    expect(result.failed).toEqual({});
    // Two requests per metric: one that moved older, one that repeated and stopped.
    expect(mockedGet).toHaveBeenCalledTimes(METRICS.length * 2);
  });

  it('pages BACKWARDS, because these endpoints ignore startTime', async () => {
    // The bug this locks down: paging forward from startTime read exactly one
    // page and stopped, capturing 20 days of a 30-day window and losing the
    // rest permanently. Only openInterest is exercised so the row maths is
    // readable; all four share the walk.
    const now = 10_000_000_000;
    const spec = METRICS.find((m) => m.metric === 'openInterest')!;
    const HOUR = 3_600_000;
    const pages: number[][] = [];
    mockedGet.mockImplementation(async (url: string, cfg?: { params?: unknown }) => {
      if (!url.includes(spec.path)) return { data: [] };
      const end = (cfg!.params as { endTime: number }).endTime;
      // A full page of hourly rows ending at endTime, like the real endpoint.
      const times = Array.from({ length: spec.maxRows }, (_, i) => end - (spec.maxRows - 1 - i) * HOUR);
      pages.push(times);
      return { data: rowsFor(url, times) };
    });
    const { prisma, written } = fakePrisma();

    // Ask for a window two pages deep.
    const days = (spec.maxRows * 2 * HOUR) / 86_400_000;
    await new FlowCollectorService(prisma).collect(['BTC'], days, now);

    // It kept going instead of stopping after page one...
    expect(pages.length).toBeGreaterThan(1);
    // ...and each page reached strictly further back than the last.
    expect(Math.min(...pages[1])).toBeLessThan(Math.min(...pages[0]));
    // The stored rows span more than a single page's worth of hours.
    const oi = written.filter((w) => w.metric === 'openInterest').map((w) => w.ts.getTime());
    expect((Math.max(...oi) - Math.min(...oi)) / HOUR).toBeGreaterThan(spec.maxRows);
  });

  it('does not store rows older than the window asked for', async () => {
    const now = 10_000_000_000;
    const spec = METRICS.find((m) => m.metric === 'openInterest')!;
    const from = now - 86_400_000; // one day
    mockedGet.mockImplementation(async (url: string) => {
      if (!url.includes(spec.path)) return { data: [] };
      // Half inside the window, half far older than it.
      return { data: rowsFor(url, [now - 3_600_000, from - 10 * 86_400_000]) };
    });
    const { prisma, written } = fakePrisma();

    await new FlowCollectorService(prisma).collect(['BTC'], 1, now);

    const oi = written.filter((w) => w.metric === 'openInterest');
    expect(oi).toHaveLength(1);
    expect(oi[0].ts.getTime()).toBe(now - 3_600_000);
  });

  it('does not let one failing endpoint stop the others', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes('openInterestHist')) throw new Error('HTTP 418');
      return { data: rowsFor(url, [RECENT]) };
    });
    const { prisma, written } = fakePrisma();

    const result = await new FlowCollectorService(prisma).collect(['BTC', 'ETH'], 1, NOW);

    expect(Object.keys(result.failed).sort()).toEqual([
      'BTC:openInterest',
      'ETH:openInterest',
    ]);
    // The other three metrics still landed, for both coins.
    expect(written.length).toBe((METRICS.length - 1) * 2);
  });

  it('reports rows it fetched but already had', async () => {
    mockedGet.mockImplementation(async (url: string) => ({
      data: rowsFor(url, [RECENT, RECENT + 60_000]),
    }));
    const prisma = {
      flowSample: { createMany: jest.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaService;

    const result = await new FlowCollectorService(prisma).collect(['BTC'], 1, NOW);

    expect(result.saved).toBe(0);
    expect(result.duplicates).toBe(2 * METRICS.length);
  });

  it('starts at now and walks back', async () => {
    const now = 10_000_000_000;
    mockedGet.mockImplementation(async (url: string) => ({
      data: rowsFor(url, [now - 3_600_000]),
    }));
    const { prisma } = fakePrisma();

    await new FlowCollectorService(prisma).collect(['BTC'], 7, now);

    const params = mockedGet.mock.calls[0][1]!.params;
    expect(params.endTime).toBe(now);
    // startTime is deliberately NOT sent: these endpoints ignore it, and
    // sending it invited the forward-paging bug back.
    expect(params.startTime).toBeUndefined();
  });
});
