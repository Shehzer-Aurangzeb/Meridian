import { CacheModule } from '@nestjs/cache-manager';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnalysesController } from './analyses.controller';
import { AnalyzeService } from './analyze.service';
import { CoordinatorPersistenceService } from './coordinator-persistence.service';
import { PrismaService } from '../prisma/prisma.service';
import { BinanceService } from '../market-data/market-data.service';
import { AnalysisCoordinatorModule } from './analysis-coordinator.module';

const payload = {
  symbol: 'BTC',
  map: { zones: [{ center: 100 }] },
  plans: [{ direction: 'long', stop: 90, zone: { center: 100 } }],
};

describe('AnalysesController', () => {
  const prisma = {
    coordinatorRun: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const binance = { getCurrentPrice: jest.fn() };
  const analyzer = { analyze: jest.fn() };
  const persistence = { persistAnalysis: jest.fn() };

  const controller = new AnalysesController(
    analyzer as unknown as AnalyzeService,
    persistence as unknown as CoordinatorPersistenceService,
    prisma as unknown as PrismaService,
    binance as unknown as BinanceService,
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
      /predates the level map/,
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

    const res = await controller.detail('run_1');
    // Price is above the long's stop so it is not invalidated, but the newest
    // map kept none of its zones.
    expect(res.freshness).toBe('SUPERSEDED');
    expect(res.currentPrice).toBe(120);
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
