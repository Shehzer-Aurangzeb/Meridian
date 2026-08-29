import { OutcomeScorerService, outcomeColumns } from './outcome-scorer.service';
import { isTerminalOutcome, PlanOutcome, PlanResult } from './outcome';
import type { PrismaService } from '../prisma/prisma.service';
import type { BinanceService } from '../market-data/market-data.service';
import type { Candle } from '../common/types/candle.types';

const HOUR = 3_600_000;

/** A plan that fills at 100 and stops at 90. Two of them makes a pair. */
const plan = (direction: 'long' | 'short' = 'long') => ({
  direction,
  state: 'ACTIONABLE',
  distanceToZonePercent: direction === 'long' ? 0 : 1,
  entries: [{ price: 100, weightPercent: 100 }],
  averageEntry: 100,
  stop: 90,
  riskPerUnit: 10,
  riskPercent: 10,
  targets: [{ price: 120, weightPercent: 100 }],
  blendedR: 2,
  zone: { low: 99, high: 101, center: 100, type: 'support', sources: ['4h'] },
});

const payload = (plans: unknown[] = [plan()]) => ({
  symbol: 'BTC',
  plans,
  map: { spot: 100 },
  regime: { timeframe: '12h', regime: 'TRENDING', metrics: { adx: 30 } },
  route: 'CONFLUENCE_CHECKLIST',
  timeframes: { regime: '12h' },
});

/** Bars from `start`, one per hour, that fill at 100 then run to `to`. */
function bars(start: number, count: number, to: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(start + (i + 1) * HOUR),
    open: 100,
    high: i === 0 ? 100 : Math.max(100, to),
    low: i === 0 ? 100 : Math.min(100, to),
    close: 100,
    volume: 1,
  }));
}

function fakes(rows: unknown[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const updateMany: Array<{ ids: string[]; data: Record<string, unknown> }> = [];
  const prisma = {
    coordinatorRun: {
      findMany: jest.fn(async () => rows),
      update: jest.fn(async ({ where, data }: never) => {
        updates.push({ id: (where as { id: string }).id, data });
        return {};
      }),
      updateMany: jest.fn(async ({ where, data }: never) => {
        updateMany.push({ ids: (where as { id: { in: string[] } }).id.in, data });
        return { count: 0 };
      }),
    },
  } as unknown as PrismaService;
  const fetched: string[] = [];
  const binance = {
    getCandlesFrom: jest.fn(async (symbol: string, _i: string, start: number) => {
      fetched.push(`${symbol}@${start}`);
      return bars(start, 100, 80); // fills, then trades down through the stop
    }),
  } as unknown as BinanceService;
  return { prisma, binance, updates, updateMany, fetched };
}

describe('isTerminalOutcome', () => {
  it('treats PARTIAL as finished, because the scorer only emits it when stopped', () => {
    // scoreTrade returns PARTIAL only inside `stopped ? ...`, at which point
    // `remaining` is 0 and the loop has broken. Calling it unresolved would put
    // 83 of 603 production rows back on the re-score list for nothing.
    for (const o of ['STOPPED', 'PARTIAL', 'ALL_TARGETS', 'MISSED', 'EXPIRED']) {
      expect(isTerminalOutcome(o)).toBe(true);
    }
  });

  it('leaves the two that can still move, and the one that is a failure', () => {
    for (const o of ['PENDING', 'OPEN', 'UNSCOREABLE', null, undefined, '']) {
      expect(isTerminalOutcome(o as PlanOutcome)).toBe(false);
    }
  });
});

describe('outcomeColumns', () => {
  it('lifts the LEAD plan out, not the first one', () => {
    // leadPlan prefers ACTIONABLE, then nearest. The short here is neither, so
    // the columns must describe the long even though it is second in the array.
    const plans = [plan('short'), plan('long')] as never[];
    const results: PlanResult[] = [
      { direction: 'short', outcome: 'MISSED', r: null, netR: null, filledAt: null, targetsHit: 0, legsFilled: 0, filledFraction: 0, barsHeld: 0 },
      { direction: 'long', outcome: 'STOPPED', r: -1, netR: -1.025, filledAt: new Date(1000), targetsHit: 0, legsFilled: 1, filledFraction: 1, barsHeld: 4 },
    ];
    const cols = outcomeColumns(plans, results, new Date(0));
    expect(cols.outcome).toBe('STOPPED');
    expect(cols.outcomeDirection).toBe('long');
    expect(cols.netR).toBe(-1.025);
    expect(cols.entryFilledAt).toEqual(new Date(1000));
    // The scalars are a projection of the array, never a second computation.
    expect(cols.outcomePayload).toBe(results);
  });

  it('records "no plan" as an empty result set, not as a missing score', () => {
    const cols = outcomeColumns([], [], new Date(0));
    expect(cols.outcome).toBeNull();
    expect(cols.netR).toBeNull();
    // scoredAt IS set: this row is settled forever and must never be fetched
    // for again. 145 of 603 production rows are this case.
    expect(cols.scoredAt).toEqual(new Date(0));
  });
});

describe('OutcomeScorerService', () => {
  const now = new Date('2026-08-20T00:00:00Z').getTime();

  it('asks only for rows that are unsettled or can still move', async () => {
    const { prisma, binance } = fakes([]);
    await new OutcomeScorerService(prisma, binance).scoreUnresolved({ now });

    const where = (prisma.coordinatorRun.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ scoredAt: null }, { outcome: { in: ['PENDING', 'OPEN'] } }]);
  });

  it('REFUSES to re-score a settled terminal row', async () => {
    // The failure this guards is silent: everything still works, it is just
    // slow again and burning exchange quota. A thrown error is the only way
    // anyone finds out that the filter was dropped.
    const { prisma, binance } = fakes([
      {
        id: 'done_1',
        symbol: 'BTC',
        createdAt: new Date(now - 500 * HOUR),
        coordinatorPayload: payload(),
        outcome: 'STOPPED',
        scoredAt: new Date(now - HOUR),
      },
    ]);

    await expect(
      new OutcomeScorerService(prisma, binance).scoreUnresolved({ now }),
    ).rejects.toThrow(/Refusing to re-score 1 terminal row/);
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
  });

  it('lets the backfill past that guard, because it is the one caller that must', async () => {
    const { prisma, binance, updates } = fakes([
      {
        id: 'done_1',
        symbol: 'BTC',
        createdAt: new Date(now - 500 * HOUR),
        coordinatorPayload: payload(),
        outcome: 'STOPPED',
        scoredAt: new Date(now - HOUR),
      },
    ]);

    const res = await new OutcomeScorerService(prisma, binance).scoreAll({ now });
    expect(res.scored).toBe(1);
    expect(updates[0].data.outcome).toBe('STOPPED');
  });

  it('settles a row that builds no plan WITHOUT fetching anything', async () => {
    // 145 of 603 production rows. The old read path fetched a 98-bar window for
    // every one of them and threw it away fifteen lines later.
    const { prisma, binance, updateMany } = fakes([
      {
        id: 'noplan_1',
        symbol: 'BTC',
        createdAt: new Date(now - 500 * HOUR),
        coordinatorPayload: payload([]),
        outcome: null,
        scoredAt: null,
      },
    ]);

    const res = await new OutcomeScorerService(prisma, binance).scoreUnresolved({ now });

    expect(res.noPlan).toBe(1);
    expect(res.candleFetches).toBe(0);
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
    // One statement for all of them, and settled so it is never revisited.
    expect(updateMany[0].ids).toEqual(['noplan_1']);
    expect(updateMany[0].data.scoredAt).toEqual(new Date(now));
  });

  it('leaves scoredAt null when the window could not be loaded, so it retries', async () => {
    const { prisma, updates } = fakes([
      {
        id: 'row_1',
        symbol: 'BTC',
        createdAt: new Date(now - 500 * HOUR),
        coordinatorPayload: payload(),
        outcome: null,
        scoredAt: null,
      },
    ]);
    const binance = {
      getCandlesFrom: jest.fn(async () => {
        throw new Error('binance down');
      }),
    } as unknown as BinanceService;

    const res = await new OutcomeScorerService(prisma, binance).scoreUnresolved({ now });

    expect(res.unscoreable).toBe(1);
    expect(res.scored).toBe(0);
    // The badge is honest about it...
    expect(updates[0].data.outcome).toBe('UNSCOREABLE');
    // ...but it is NOT settled. A dropped connection is a transport failure,
    // not a verdict, so the next run tries again instead of freezing it.
    expect(updates[0].data.scoredAt).toBeNull();
  });

  it('scores one result per plan, in plan order', async () => {
    const { prisma, binance, updates } = fakes([
      {
        id: 'row_1',
        symbol: 'BTC',
        createdAt: new Date(now - 500 * HOUR),
        coordinatorPayload: payload([plan('long'), plan('short')]),
        outcome: null,
        scoredAt: null,
      },
    ]);

    await new OutcomeScorerService(prisma, binance).scoreUnresolved({ now });

    const stored = updates[0].data.outcomePayload as PlanResult[];
    // The detail page renders outcomes[idx] against plans[idx]. A mismatch here
    // would label the short's result with the long's badge.
    expect(stored.map((r) => r.direction)).toEqual(['long', 'short']);
    expect(stored).toHaveLength(2);
  });

  it('fetches in bounded batches, not one burst', async () => {
    // 1000 rows is a legal page size, and 1000 simultaneous klines requests is
    // how an IP gets banned off the exchange.
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      symbol: 'BTC',
      createdAt: new Date(now - (500 + i) * HOUR),
      coordinatorPayload: payload(),
      outcome: null,
      scoredAt: null,
    }));
    const { prisma } = fakes(rows);

    let live = 0;
    let peak = 0;
    const binance = {
      getCandlesFrom: jest.fn(async (_s: string, _i: string, start: number) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
        return bars(start, 100, 80);
      }),
    } as unknown as BinanceService;

    const res = await new OutcomeScorerService(prisma, binance).scoreUnresolved({ now });

    expect(res.candleFetches).toBe(20);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
