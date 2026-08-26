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
      data: rowsFor(url, [1_000]),
    }));
    const { prisma, written } = fakePrisma();

    await new FlowCollectorService(prisma).collect(['BTC'], 1);

    expect(written.length).toBe(METRICS.length);
    expect(new Set(written.map((w) => w.symbol))).toEqual(new Set(['BTC']));
    // ...but Binance was asked for the pair.
    expect(mockedGet.mock.calls[0][1]?.params.symbol).toBe('BTCUSDT');
  });

  it('stops paging when a full page does not move the cursor forward', async () => {
    // The failure this guards: an endpoint that ignores startTime and keeps
    // returning the same newest rows. The page is FULL every time, so the
    // short-page check never fires and only the cursor check can stop it.
    // Without that check this loops for ever against Binance.
    const now = 10_000_000_000;
    // Inside the requested window, or the walk stops before it ever pages.
    mockedGet.mockImplementation(async (url: string) => {
      const size = METRICS.find((m) => url.includes(m.path))!.maxRows;
      const times = Array.from({ length: size }, (_, i) => now - size + i);
      return { data: rowsFor(url, times) };
    });
    const { prisma } = fakePrisma();

    const result = await new FlowCollectorService(prisma).collect(['BTC'], 1, now);

    expect(result.failed).toEqual({});
    // Two requests per metric: one that advanced, one that repeated and stopped.
    expect(mockedGet).toHaveBeenCalledTimes(METRICS.length * 2);
  });

  it('does not let one failing endpoint stop the others', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes('openInterestHist')) throw new Error('HTTP 418');
      return { data: rowsFor(url, [1_000]) };
    });
    const { prisma, written } = fakePrisma();

    const result = await new FlowCollectorService(prisma).collect(['BTC', 'ETH'], 1);

    expect(Object.keys(result.failed).sort()).toEqual([
      'BTC:openInterest',
      'ETH:openInterest',
    ]);
    // The other three metrics still landed, for both coins.
    expect(written.length).toBe((METRICS.length - 1) * 2);
  });

  it('reports rows it fetched but already had', async () => {
    mockedGet.mockImplementation(async (url: string) => ({
      data: rowsFor(url, [1_000, 2_000]),
    }));
    const prisma = {
      flowSample: { createMany: jest.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaService;

    const result = await new FlowCollectorService(prisma).collect(['BTC'], 1);

    expect(result.saved).toBe(0);
    expect(result.duplicates).toBe(2 * METRICS.length);
  });

  it('asks only for the window it was given', async () => {
    mockedGet.mockImplementation(async (url: string) => ({ data: rowsFor(url, [1_000]) }));
    const { prisma } = fakePrisma();
    const now = 1_000_000_000;

    await new FlowCollectorService(prisma).collect(['BTC'], 7, now);

    const { startTime, endTime } = mockedGet.mock.calls[0][1]!.params;
    expect(endTime).toBe(now);
    expect(now - startTime).toBe(7 * 86_400_000);
  });
});
