import { CacheModule } from '@nestjs/cache-manager';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnalysesController, RESULTS_EPOCH } from './analyses.controller';
import { AnalyzeService } from './analyze.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { AnalystNarrationService } from '../ai/analyst-narration.service';
import { OutcomeScorerService } from './outcome-scorer.service';
import { AnalysisCoordinatorModule } from './analysis-coordinator.module';

const payload = {
  symbol: 'BTC',
  map: { spot: 100, zones: [{ center: 100 }] },
  plans: [
    {
      direction: 'long',
      state: 'ACTIONABLE',
      stop: 90,
      zone: { low: 98, high: 102, center: 100, type: 'support', sources: ['1h', '4h'] },
      distanceToZonePercent: -0.5,
      entries: [
        { price: 102, weightPercent: 20 },
        { price: 100, weightPercent: 40 },
        { price: 98, weightPercent: 40 },
      ],
      averageEntry: 99.6,
      riskPercent: 1,
      riskPerUnit: 9.6,
      targets: [{ price: 110, rMultiple: 2, weightPercent: 100, source: '4h' }],
      blendedR: 2,
    },
  ],
  regime: { timeframe: '12h', regime: 'TRENDING', metrics: { adx: 30 } },
  route: 'CONFLUENCE_CHECKLIST',
  checklist: null,
  timeframes: { regime: '12h' },
};

describe('AnalysesController', () => {
  const prisma = {
    coordinatorRun: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const binance = {
  getCurrentPrice: jest.fn(),
  getCandlesPaged: jest.fn(),
  getCandlesFrom: jest.fn(),
};
  const analyzer = { analyze: jest.fn() };
  const persistence = { persistAnalysis: jest.fn() };
  const narrator = { narrate: jest.fn() };
  const scorer = { scoreUnresolved: jest.fn() };

  const controller = new AnalysesController(
    analyzer as unknown as AnalyzeService,
    persistence as unknown as CoordinatorPersistenceService,
    prisma as unknown as PrismaService,
    binance as unknown as BinanceService,
    narrator as unknown as AnalystNarrationService,
    scorer as unknown as OutcomeScorerService,
  );

  /** One stored result, as it comes back out of JSONB — filledAt is a string. */
  const stored = (over: Record<string, unknown> = {}) => [
    {
      direction: 'long',
      outcome: 'STOPPED',
      r: -1,
      netR: -1.1,
      filledAt: '2026-08-20T00:00:00.000Z',
      targetsHit: 0,
      legsFilled: 1,
      filledFraction: 0.2,
      barsHeld: 3,
      ...over,
    },
  ];

  beforeEach(() => jest.clearAllMocks());

  it('rejects a symbol that is not a symbol', async () => {
    await expect(controller.run('../etc/passwd')).rejects.toThrow(HttpException);
    await expect(controller.run('')).rejects.toThrow(HttpException);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('runs, persists, and returns the id with the analysis', async () => {
    analyzer.analyze.mockResolvedValue(payload);
    persistence.persistAnalysis.mockResolvedValue({ id: 'run_1' });

    expect(await controller.run('btc')).toEqual({ id: 'run_1', analysis: payload });
    expect(analyzer.analyze).toHaveBeenCalledWith('BTC');
  });

  it('bounds the list by a date window and admits when it hit the ceiling', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    const asked = await controller.list(undefined, undefined, undefined, '30');
    const { gte } = prisma.coordinatorRun.findMany.mock.calls[0][0].where.createdAt;
    // Thirty days means thirty days. The epoch does not shorten it.
    expect(Math.abs((gte as Date).getTime() - (Date.now() - 30 * 86_400_000))).toBeLessThan(
      1000,
    );
    expect(asked.from).toBe((gte as Date).toISOString());

    // Exactly `take` rows back means there may be more the caller cannot see —
    // a scoreboard built on a silently truncated list describes a subset.
    prisma.coordinatorRun.findMany.mockResolvedValue(new Array(50).fill({ id: 'x' }));
    expect((await controller.list()).truncated).toBe(true);
    prisma.coordinatorRun.findMany.mockResolvedValue([{ id: 'x' }]);
    expect((await controller.list()).truncated).toBe(false);
  });

  it('leaves the list a plain database read unless status is asked for', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list();
    // The payload is the expensive column and Binance is the expensive call.
    // Neither belongs in the dashboard's row-counting fetch.
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].select.coordinatorPayload).toBe(
      false,
    );
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].select.outcomePayload).toBe(false);
    expect(binance.getCurrentPrice).not.toHaveBeenCalled();
  });

  it('reads the stored outcome and fetches NO candles at all', async () => {
    const rows = [
      { id: 'a', symbol: 'BTC', createdAt: new Date(0), coordinatorPayload: payload, outcomePayload: stored() },
      { id: 'b', symbol: 'BTC', createdAt: new Date(0), coordinatorPayload: payload, outcomePayload: stored() },
      { id: 'c', symbol: 'ETH', createdAt: new Date(0), coordinatorPayload: payload, outcomePayload: stored() },
    ];
    prisma.coordinatorRun.findMany.mockResolvedValue(rows);
    prisma.coordinatorRun.findFirst.mockResolvedValue({ coordinatorPayload: payload });
    binance.getCurrentPrice.mockResolvedValue(100);

    const result = await controller.list(undefined, undefined, 'true');

    // Price is still shared across rows of the same coin — two coins, two calls.
    expect(binance.getCurrentPrice).toHaveBeenCalledTimes(2);
    // THE point of the change. Scoring 603 rows from raw candles on every
    // request was 92% of a 32-second response, and the window could not be
    // shared because each row is anchored to its own createdAt. Not fewer
    // fetches — none.
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
    expect(binance.getCandlesPaged).not.toHaveBeenCalled();

    const first = result.analyses[0] as { status: { netR: number | null } };
    expect(first.status).toMatchObject({
      direction: 'long',
      outcome: 'STOPPED',
      netR: -1.1,
      targetsHit: 0,
      filledAt: '2026-08-20T00:00:00.000Z',
      // The ladder, stop and targets a card draws — projected, not the whole plan.
      plan: { entries: [102, 100, 98], stop: 90, targets: [110] },
    });
    // Neither payload is returned: one is large, the other is projected into
    // `status` already.
    expect(result.analyses[0]).not.toHaveProperty('coordinatorPayload');
    expect(result.analyses[0]).not.toHaveProperty('outcomePayload');
  });

  it('says "not scored" rather than inventing a verdict for an unscored row', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([
      { id: 'a', symbol: 'BTC', createdAt: new Date(0), coordinatorPayload: payload, outcomePayload: null },
    ]);
    prisma.coordinatorRun.findFirst.mockResolvedValue(null);
    binance.getCurrentPrice.mockResolvedValue(100);

    const result = await controller.list(undefined, undefined, 'true');

    // A row the job has not reached is not MISSED and not a loss. It is not
    // knowable yet, which is exactly what UNSCOREABLE means.
    expect((result.analyses[0] as { status: { outcome: string } }).status.outcome).toBe(
      'UNSCOREABLE',
    );
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
  });

  it('scores a freshly created analysis on the write path', async () => {
    analyzer.analyze.mockResolvedValue(payload);
    persistence.persistAnalysis.mockResolvedValue({ id: 'new_1' });

    await controller.run('BTC');

    // Without this the new row would read "not scored" until the next
    // scheduled run, because no read path scores anything any more.
    expect(scorer.scoreUnresolved).toHaveBeenCalledWith({ ids: ['new_1'] });
  });

  it('drops the status of a coin Binance cannot serve, not its row', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([
      { id: 'a', symbol: 'BTC', createdAt: new Date(0), coordinatorPayload: payload, outcomePayload: stored() },
    ]);
    prisma.coordinatorRun.findFirst.mockResolvedValue(null);
    binance.getCurrentPrice.mockRejectedValue(new Error('binance down'));

    const result = await controller.list(undefined, undefined, 'true');
    expect(result.count).toBe(1);
    expect((result.analyses[0] as { status: unknown }).status).not.toBeUndefined();
  });

  it('defaults to the epoch but never traps the caller behind it', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);

    // No window asked for: start at the planner boundary.
    const plain = await controller.list();
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(
      RESULTS_EPOCH,
    );
    expect(plain.from).toBe(RESULTS_EPOCH.toISOString());

    // Ten years asked for: ten years given. The first version clamped this to
    // the epoch, which left NO request able to show the older rows — a caller
    // could not tell whether they were hidden or deleted.
    const wide = await controller.list(undefined, undefined, undefined, '3650');
    const gte = prisma.coordinatorRun.findMany.mock.calls[1][0].where.createdAt.gte;
    expect(gte.getTime()).toBeLessThan(RESULTS_EPOCH.getTime());
    expect(wide.from).toBe(gte.toISOString());

    // And every response says where the boundary is, so the consumer can leave
    // pre-epoch rows out of its totals rather than out of its list.
    expect(wide.epoch).toBe(RESULTS_EPOCH.toISOString());
    expect(plain.epoch).toBe(RESULTS_EPOCH.toISOString());
  });

  it('caps and floors the list limit rather than trusting the query', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(undefined, '9999');
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].take).toBe(1000);
    // A nonsense limit falls back to the default, it does not clamp to 1 row.
    await controller.list(undefined, '-5');
    expect(prisma.coordinatorRun.findMany.mock.calls[1][0].take).toBe(50);
    await controller.list(undefined, 'abc');
    expect(prisma.coordinatorRun.findMany.mock.calls[2][0].take).toBe(50);
  });

  it('404s an unknown id', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue(null);
    await expect(controller.detail('nope')).rejects.toThrow(HttpException);
  });

  it('returns freshness computed against the live price and the newest row', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'run_1',
      symbol: 'BTC',
      createdAt: new Date(0),
      coordinatorPayload: payload,
      outcomePayload: null,
    });
    prisma.coordinatorRun.findFirst.mockResolvedValue({
      coordinatorPayload: { map: { zones: [{ center: 500 }] } },
    });
    binance.getCurrentPrice.mockResolvedValue(120);

    const res = await controller.detail('run_1');
    // Price is above the long's stop so it is not invalidated, but the newest
    // map kept none of its zones.
    expect(res.freshness).toBe('SUPERSEDED');
    expect(res.currentPrice).toBe(120);
    // Nothing has scored this row yet. That is not "passed by" — it is not
    // knowable, and saying MISSED would be the bug this replaces.
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['UNSCOREABLE']);
    expect(res.outcomes[0].r).toBeNull();
    // The detail page is a read path too.
    expect(binance.getCandlesFrom).not.toHaveBeenCalled();
    // The newest-row lookup must exclude the row being read, or every
    // analysis would be compared against itself and never go stale.
    expect(prisma.coordinatorRun.findFirst.mock.calls[0][0].where).toEqual({
      symbol: 'BTC',
      id: { not: 'run_1' },
    });
  });
});

describe('AnalysisCoordinatorModule wiring', () => {
  it('resolves the full DI graph without a database', async () => {
    // A missing provider is a RUNTIME failure in Nest, so typecheck cannot
    // catch it. Prisma is overridden because the graph is the thing under
    // test, not Postgres — and Docker is not a dependency of `pnpm test`.
    process.env.ANTHROPIC_API_KEY ??= 'test-key-not-used';

    const moduleRef = await Test.createTestingModule({
      // CacheModule is registered `isGlobal: true` in AppModule, so this
      // module never imports it — outside a full app boot it has to be
      // supplied the same way, global included, or BinanceService cannot
      // resolve CACHE_MANAGER.
      imports: [CacheModule.register({ isGlobal: true }), AnalysisCoordinatorModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(AnalysesController)).toBeDefined();
    expect(moduleRef.get(AnalyzeService)).toBeDefined();
  });
});

describe('AnalysesController.narrate', () => {
  const prisma = {
    coordinatorRun: { findUnique: jest.fn(), update: jest.fn() },
  };
  const narrator = { narrate: jest.fn() };
  const controller = new AnalysesController(
    {} as unknown as AnalyzeService,
    {} as unknown as CoordinatorPersistenceService,
    prisma as unknown as PrismaService,
    {} as unknown as BinanceService,
    narrator as unknown as AnalystNarrationService,
    {} as unknown as OutcomeScorerService,
  );

  const full = payload;

  beforeEach(() => jest.clearAllMocks());

  it('returns the cached narration without paying for a second call', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'a',
      coordinatorPayload: full,
      aiPayload: { text: 'already written', citedPrices: [], model: 'x', narratedAt: 'y' },
    });

    const result = await controller.narrate('a');

    expect(result.text).toBe('already written');
    expect(narrator.narrate).not.toHaveBeenCalled();
    expect(prisma.coordinatorRun.update).not.toHaveBeenCalled();
  });

  it('ignores the legacy aiPayload shape and narrates instead', async () => {
    // Old rows hold a trade action here, not a narration. Returning one as
    // text would render `undefined` on the page.
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'a',
      coordinatorPayload: full,
      aiPayload: { action: 'LONG', confidence: 70 },
    });
    narrator.narrate.mockResolvedValue({
      text: 'fresh read',
      citedPrices: [100],
      model: 'claude-opus-5',
      inputTokens: 1,
      outputTokens: 2,
    });

    const result = await controller.narrate('a');

    expect(narrator.narrate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('fresh read');
    expect(prisma.coordinatorRun.update).toHaveBeenCalledTimes(1);
  });

  it('reports a narration failure as unavailable, never as a broken analysis', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'a',
      coordinatorPayload: full,
      aiPayload: null,
    });
    narrator.narrate.mockRejectedValue(new Error('ANTHROPIC_API_KEY is not set'));

    await expect(controller.narrate('a')).rejects.toMatchObject({ status: 503 });
    expect(prisma.coordinatorRun.update).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue(null);
    await expect(controller.narrate('nope')).rejects.toMatchObject({ status: 404 });
  });
});
