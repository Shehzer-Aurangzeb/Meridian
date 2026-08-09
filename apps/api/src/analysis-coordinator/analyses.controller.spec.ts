import { CacheModule } from '@nestjs/cache-manager';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnalysesController } from './analyses.controller';
import { AnalyzeService } from './analyze.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { AnalystNarrationService } from '../ai/analyst-narration.service';
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
      riskPercent: 1,
      targets: [{ price: 110, rMultiple: 2 }],
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
  const binance = { getCurrentPrice: jest.fn(), getCandlesPaged: jest.fn() };
  const analyzer = { analyze: jest.fn() };
  const persistence = { persistAnalysis: jest.fn() };
  const narrator = { narrate: jest.fn() };

  const controller = new AnalysesController(
    analyzer as unknown as AnalyzeService,
    persistence as unknown as CoordinatorPersistenceService,
    prisma as unknown as PrismaService,
    binance as unknown as BinanceService,
    narrator as unknown as AnalystNarrationService,
  );

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

  it('caps and floors the list limit rather than trusting the query', async () => {
    prisma.coordinatorRun.findMany.mockResolvedValue([]);
    await controller.list(undefined, '9999');
    expect(prisma.coordinatorRun.findMany.mock.calls[0][0].take).toBe(200);
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

  it('refuses a legacy row instead of scoring freshness off nothing', async () => {
    // Rows written before AnalyzeService hold a regime-leg-only payload.
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'old',
      symbol: 'BTC',
      createdAt: new Date(0),
      coordinatorPayload: { symbol: 'BTC', regimeResult: {} },
    });
    await expect(controller.detail('old')).rejects.toThrow(
      /predates the current analysis shape/,
    );
  });

  it('returns freshness computed against the live price and the newest row', async () => {
    prisma.coordinatorRun.findUnique.mockResolvedValue({
      id: 'run_1',
      symbol: 'BTC',
      createdAt: new Date(0),
      coordinatorPayload: payload,
    });
    prisma.coordinatorRun.findFirst.mockResolvedValue({
      coordinatorPayload: { map: { zones: [{ center: 500 }] } },
    });
    binance.getCurrentPrice.mockResolvedValue(120);
    binance.getCandlesPaged.mockResolvedValue([]);

    const res = await controller.detail('run_1');
    // Price is above the long's stop so it is not invalidated, but the newest
    // map kept none of its zones.
    expect(res.freshness).toBe('SUPERSEDED');
    expect(res.currentPrice).toBe(120);
    // No candles, so no fill — and the fixture is dated 1970, so the fill
    // window is long gone: the plan was passed by, not still waiting.
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['MISSED']);
    expect(res.outcomes[0].r).toBeNull();
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
