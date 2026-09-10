import { SimTrade } from '@prisma/client';
import { SimService, toPlanInput } from './sim.service';
import { SCORING_WINDOW_HOURS, MIN_AGE_HOURS } from './sim.scoring';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-01T00:00:00Z');

const row = (over: Partial<SimTrade> = {}): SimTrade =>
  ({
    id: 'row1',
    batchId: 'batch1',
    symbol: 'BTC',
    verdict: 'TAKE',
    direction: 'long',
    entry: 100,
    stop: 98,
    targets: [{ price: 110, weightPercent: 100 }],
    rationale: null,
    mapSnapshot: {},
    spotAtDecision: 105,
    usedOutsideData: false,
    decidedAt: new Date(T0),
    createdAt: new Date(T0),
    outcome: null,
    grossR: null,
    netR: null,
    targetsHit: null,
    barsHeld: null,
    filledAt: null,
    scoredAt: null,
    ...over,
  }) as SimTrade;

describe('toPlanInput: stored JSON is parsed, never trusted', () => {
  it('reads a well-formed row', () => {
    const got = toPlanInput(row());
    expect(got).toEqual({
      direction: 'long',
      entry: 100,
      stop: 98,
      targets: [{ price: 110, weightPercent: 100 }],
    });
  });

  it.each([
    ['an unknown direction', { direction: 'sideways' }],
    ['a stop equal to the entry', { stop: 100 }],
    ['a target that is not an object', { targets: [42] }],
    ['a target missing its weight', { targets: [{ price: 110 }] }],
    ['a target whose price is a string', { targets: [{ price: '110', weightPercent: 100 }] }],
  ])('refuses %s rather than scoring it', (_name, over) => {
    expect(toPlanInput(row(over as Partial<SimTrade>))).toBeNull();
  });

  it('accepts an empty target list', () => {
    // A plan with no target can only stop out or expire. That is a real, if
    // poor, plan — 9% of the trades in the retired harness looked like this and
    // every resolved one was a stop-out.
    expect(toPlanInput(row({ targets: [] }))?.targets).toEqual([]);
  });
});

describe('scoreOutstanding: rows are resolved once, after their window closes', () => {
  const now = T0 + (SCORING_WINDOW_HOURS + 10) * HOUR;

  const build = (rows: SimTrade[], candles: unknown = []) => {
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = { simTrade: { findMany: jest.fn().mockResolvedValue(rows), update } };
    const binance = { getCandlesFrom: jest.fn().mockResolvedValue(candles) };
    return {
      service: new SimService(prisma as never, binance as never),
      prisma,
      binance,
      update,
    };
  };

  it('asks for every unsettled row old enough to have a bar, not only finished ones', async () => {
    const { service, prisma } = build([]);
    await service.scoreOutstanding(now);

    const where = prisma.simTrade.findMany.mock.calls[0][0].where;
    expect(where.scoredAt).toBeNull();
    // Was SCORING_WINDOW_HOURS. That is the worst case — filled in the last
    // minute of the fill window, then held the full 72 — and gating every row
    // on it left a trade stopped out at hour 4 unread for another 92, its
    // outcome already settled. `scoreOne` still writes scoredAt only when the
    // candles can no longer change the answer, so nothing is finalised early.
    expect((where.decidedAt.lte as Date).getTime()).toBe(now - MIN_AGE_HOURS * HOUR);
  });

  it('leaves a row unscored when its candles will not load', async () => {
    const { service, binance, update } = build([row()]);
    binance.getCandlesFrom.mockRejectedValue(new Error('Binance unreachable'));

    await expect(service.scoreOutstanding(now)).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves a row unscored when the history does not reach the decision', async () => {
    // A failed fetch and a short one must both retry. Writing UNSCOREABLE would
    // freeze a transient gap as a permanent verdict.
    const { service, update } = build([row()], []);
    await expect(service.scoreOutstanding(now)).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a malformed plan without calling out to the exchange', async () => {
    const { service, binance, update } = build([row({ direction: 'sideways' })]);
    await service.scoreOutstanding(now);
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('stamps scoredAt on a terminal outcome so it is never rescored', async () => {
    const candles = Array.from({ length: SCORING_WINDOW_HOURS + 2 }, (_, i) => ({
      time: new Date(T0 + i * HOUR),
      open: 105,
      high: 106,
      low: i === 1 ? 97 : 104,
      close: 105,
      volume: 0,
    }));

    const { service, update } = build([row()], candles);
    await expect(service.scoreOutstanding(now)).resolves.toBe(1);

    const data = update.mock.calls[0][0].data;
    expect(data.outcome).toBe('STOPPED');
    expect(data.netR).toBeCloseTo(-1.125, 10);
    expect(data.scoredAt).toBeInstanceOf(Date);
  });
});
