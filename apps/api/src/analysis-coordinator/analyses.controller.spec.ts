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
import { AnalysisStatusService } from './analysis-status.service';
import { AnalysisStatsService } from './analysis-stats.service';
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
  const scorer = { scoreUnresolved: jest.fn(), refreshOpen: jest.fn() };

  const controller = new AnalysesController(
    analyzer as unknown as AnalyzeService,
    persistence as unknown as CoordinatorPersistenceService,
    prisma as unknown as PrismaService,
    new AnalysisStatusService(
      prisma as unknown as PrismaService,
      binance as unknown as BinanceService,
    ),
    new AnalysisStatsService(prisma as unknown as PrismaService),
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
    // The window reported must be the window QUERIED. This used to read the
    // clock twice per request — once for the response, once for the where
    // clause — so the two landed a millisecond apart whenever the call
    // straddled a tick. CI caught it; it is a real disagreement, not a flake.
    expect(asked.from).toBe((gte as Date).toISOString());

    // A full page plus one means there is another page. The extra row is asked
    // for and then dropped — it exists only to answer that question.
    const full = Array.from({ length: 21 }, (_, i) => ({
      id: `x${i}`,
      createdAt: new Date(1000 - i),
      netR: null,
    }));
    prisma.coordinatorRun.findMany.mockResolvedValue(full);
    const page = await controller.list();
    expect(page.count).toBe(20);
    expect(page.nextCursor).toBe(`${new Date(981).toISOString()}_x19`);

    prisma.coordinatorRun.findMany.mockResolvedValue([
      { id: 'x', createdAt: new Date(0), netR: null },
    ]);
    expect((await controller.list()).nextCursor).toBeNull();
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
    // No status asked for means no refresh either — the dashboard counts rows
    // and must not pay for the exchange.
    expect(scorer.refreshOpen).not.toHaveBeenCalled();
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
    // Open trades are refreshed before the read, so the mark on the 20 rows
    // shown is at most one staleness window old.
    expect(scorer.refreshOpen).toHaveBeenCalledTimes(1);
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
      // The card colours itself from this, so it can never disagree with the
      // scoreboard about which group the row is in.
      bucket: 'lostClosed',
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

  it('pages on time AND id, so a batch of same-second rows cannot split badly', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    const at = new Date('2026-08-20T10:00:00.000Z');

    await controller.list(undefined, undefined, undefined, undefined, `${at.toISOString()}_run_7`);

    const { AND } = prisma.coordinatorRun.findMany.mock.calls[0][0].where;
    // Older, OR the same instant with a smaller id. Nothing shares a timestamp
    // today, so the second arm never fires — it is there so that the day one
    // does, the boundary does not fall inside the tie and drop a row.
    expect(AND[0]).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'run_7' } }],
    });
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts by result on the SERVER, and only over rows that have one', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(undefined, undefined, undefined, undefined, undefined, undefined, 'best');

    const call = prisma.coordinatorRun.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ netR: 'desc' }, { id: 'desc' }]);
    // Sorting 145 rows that never opened by their result is meaningless, and
    // leaving them in would put nulls in the cursor.
    expect(call.where.AND).toContainEqual({ netR: { not: null } });

    await expect(
      controller.list(undefined, undefined, undefined, undefined, undefined, undefined, 'sideways'),
    ).rejects.toThrow(HttpException);
  });

  it('pages a result sort on netR, not on time', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(
      undefined, undefined, undefined, undefined, '-0.5_run_3', undefined, 'best',
    );

    const { AND } = prisma.coordinatorRun.findMany.mock.calls[0][0].where;
    // Same shape, different column: paging a netR sort on a timestamp would
    // walk the wrong axis entirely.
    expect(AND).toContainEqual({
      OR: [{ netR: { lt: -0.5 } }, { netR: -0.5, id: { lt: 'run_3' } }],
    });
  });

  it('hands back a cursor the sort can actually use', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `x${i}`,
      createdAt: new Date(1000 - i),
      netR: 2 - i * 0.1,
    }));
    prisma.coordinatorRun.findMany.mockResolvedValue(rows);

    const page = await controller.list(
      undefined, undefined, undefined, undefined, undefined, undefined, 'best',
    );
    // A timestamp cursor under a netR sort would page through the wrong column.
    expect(page.nextCursor).toBe(`${2 - 19 * 0.1}_x19`);
  });

  it('rejects a cursor it did not issue', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    for (const bad of ['nonsense', 'not-a-date_run_1', '2026-08-20T10:00:00.000Z_']) {
      await expect(
        controller.list(undefined, undefined, undefined, undefined, bad),
      ).rejects.toThrow(HttpException);
    }
  });

  it('filters by bucket in SQL, not after the page is cut', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(undefined, undefined, undefined, undefined, undefined, 'openDown');

    const { AND } = prisma.coordinatorRun.findMany.mock.calls[0][0].where;
    // Filtering the page after the fact would only ever see 20 rows and would
    // report "no losing trades" whenever they sat on page two.
    expect(AND[0]).toEqual({ outcome: 'OPEN', netR: { lt: 0 } });

    await expect(
      controller.list(undefined, undefined, undefined, undefined, undefined, 'madeUp'),
    ).rejects.toThrow(HttpException);
  });

  it('reports the same window it queried, on both routes', async () => {
    // Reading the clock twice in one request makes `from` a claim about a
    // window nothing was fetched from. Looped, because the gap only opens when
    // the two reads straddle a millisecond.
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    for (let i = 0; i < 200; i += 1) {
      const list = await controller.list(undefined, undefined, undefined, undefined);
      const listGte = prisma.coordinatorRun.findMany.mock.calls.at(-1)![0].where.createdAt.gte;
      expect(list.from).toBe((listGte as Date).toISOString());

      const stats = await controller.stats(undefined, '30');
      const statsGte = prisma.coordinatorRun.findMany.mock.calls.at(-1)![0].where.createdAt.gte;
      expect(stats.from).toBe((statsGte as Date).toISOString());
    }
  });

  it('counts the whole window, not the page, and refreshes open trades first', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([
      { createdAt: new Date('2026-08-20'), outcome: 'STOPPED', netR: -1 },
      { createdAt: new Date('2026-08-20'), outcome: 'ALL_TARGETS', netR: 2 },
      { createdAt: new Date('2026-08-20'), outcome: 'OPEN', netR: 0.5 },
      // Before the epoch: shown in the list, absent from every total.
      { createdAt: new Date('2026-08-01'), outcome: 'ALL_TARGETS', netR: 99 },
    ]);

    const stats = await controller.stats();

    expect(scorer.refreshOpen).toHaveBeenCalled();
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].select).toEqual({
      createdAt: true,
      outcome: true,
      netR: true,
    });
    expect(stats.counts).toMatchObject({ lostClosed: 1, wonClosed: 1, openUp: 1 });
    expect(stats.excluded).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.filled).toBe(3);
    expect(stats.closed).toBe(2);
    // Marked counts the open trade where it sits; resolved leaves it out. The
    // 99R pre-epoch row is in neither.
    expect(stats.netR.marked).toBeCloseTo(1.5, 10);
    expect(stats.netR.resolved).toBeCloseTo(1, 10);
    expect(stats.netR.nResolved).toBe(2);
    expect(stats.netR.markingGap).toBeCloseTo(0.5 - 0.5, 10);
  });

  it('caps and floors the list limit rather than trusting the query', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(undefined, '9999');
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].take).toBe(1001);
    // A nonsense limit falls back to the default, it does not clamp to 1 row.
    await controller.list(undefined, '-5');
    expect(prisma.coordinatorRun.findMany.mock.calls[1][0].take).toBe(21);
    await controller.list(undefined, 'abc');
    expect(prisma.coordinatorRun.findMany.mock.calls[2][0].take).toBe(21);
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
    {} as unknown as AnalysisStatusService,
    {} as unknown as AnalysisStatsService,
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
