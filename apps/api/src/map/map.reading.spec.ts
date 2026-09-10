import { MapService, barTimeFor, universeKeyFor } from './map.service';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-10T04:00:00Z');

describe('barTimeFor', () => {
  it('collapses every moment in an hour to that hour', () => {
    expect(barTimeFor(T0).toISOString()).toBe('2026-09-10T04:00:00.000Z');
    expect(barTimeFor(T0 + 59 * 60_000).toISOString()).toBe('2026-09-10T04:00:00.000Z');
  });

  it('moves on when the hour does', () => {
    expect(barTimeFor(T0 + HOUR).toISOString()).toBe('2026-09-10T05:00:00.000Z');
  });
});

describe('universeKeyFor', () => {
  it('is order-independent and de-duplicated', () => {
    expect(universeKeyFor(['ETH', 'BTC', 'ETH'], 'BTC')).toBe('BTC,ETH');
    expect(universeKeyFor(['BTC', 'ETH'], 'BTC')).toBe('BTC,ETH');
  });

  it('separates a coin priced alone from the same coin priced in a set', () => {
    // Not a cosmetic difference: the cone is standardised across whichever
    // coins were present, so one alone is the untilted baseline.
    expect(universeKeyFor(undefined, 'BTC')).toBe('BTC');
    expect(universeKeyFor(['BTC', 'ETH'], 'BTC')).not.toBe('BTC');
  });
});

describe('read: one reading per bar, and building happens once', () => {
  const map = (spot: number) => ({ symbol: 'BTC', asOf: 'x', spot }) as never;

  const build = (stored: Record<string, unknown> | null) => {
    const rows = new Map<string, { payload: unknown }>();
    if (stored) rows.set(stored.key as string, { payload: stored.payload });

    const prisma = {
      marketReading: {
        findUnique: jest.fn(({ where }: never) => {
          const w = (where as Record<string, Record<string, unknown>>)
            .symbol_universeKey_barTime;
          const k = `${String(w.symbol)}|${String(w.universeKey)}|${(w.barTime as Date).toISOString()}`;
          return Promise.resolve(rows.get(k) ?? null);
        }),
        create: jest.fn(({ data }: never) => {
          const d = data as Record<string, unknown>;
          const k = `${String(d.symbol)}|${String(d.universeKey)}|${(d.barTime as Date).toISOString()}`;
          rows.set(k, { payload: d.payload });
          return Promise.resolve({});
        }),
      },
    };

    const service = new MapService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, rows };
  };

  it('builds once, then serves the stored reading for the rest of the hour', async () => {
    const { service, prisma } = build(null);
    const spy = jest.spyOn(service, 'build').mockResolvedValue(map(100));

    const first = await service.read('BTC', ['BTC', 'ETH'], T0);
    const second = await service.read('BTC', ['BTC', 'ETH'], T0 + 59 * 60_000);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(prisma.marketReading.create).toHaveBeenCalledTimes(1);
  });

  it('builds again once the hour turns over', async () => {
    const { service } = build(null);
    const spy = jest.spyOn(service, 'build').mockResolvedValue(map(100));

    await service.read('BTC', ['BTC'], T0);
    await service.read('BTC', ['BTC'], T0 + HOUR);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not serve a reading built for a different universe', async () => {
    const { service } = build(null);
    const spy = jest.spyOn(service, 'build').mockResolvedValue(map(100));

    await service.read('BTC', ['BTC', 'ETH'], T0);
    await service.read('BTC', ['BTC'], T0);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('hands the winner’s reading to the loser of a race, not its own', async () => {
    const { service, prisma } = build(null);
    jest.spyOn(service, 'build').mockResolvedValue(map(999));
    // Someone else stored this bar between our lookup and our write.
    prisma.marketReading.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.marketReading.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ payload: map(111) });

    // Two callers in the same hour must not disagree about that hour.
    expect(await service.read('BTC', ['BTC'], T0)).toEqual(map(111));
  });

  it('still renders when the cache table is unreachable', async () => {
    const { service, prisma } = build(null);
    jest.spyOn(service, 'build').mockResolvedValue(map(100));
    prisma.marketReading.findUnique.mockRejectedValue(new Error('no table'));
    prisma.marketReading.create.mockRejectedValue(new Error('no table'));

    // A caching table must never be the reason a page cannot render.
    expect(await service.read('BTC', ['BTC'], T0)).toEqual(map(100));
  });
});
