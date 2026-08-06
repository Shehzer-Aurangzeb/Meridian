import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { BinanceService } from '../market-data/market-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/guards/api-key.guard';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  cache: 'ok' | 'error';
  binance: 'ok' | 'error';
  database: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  responseTime: {
    cache: number | null;
    binance: number | null;
    database: number | null;
  };
}

@ApiTags('health')
@Controller('health')
// Public: an uptime check that needs a secret is not an uptime check, and a
// load balancer cannot hold one. These expose no market data and no analysis.
@Public()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly binanceService: BinanceService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const results = await Promise.allSettled([
      this.checkCache(),
      this.checkBinance(),
      this.checkDatabase(),
    ]);

    const [cacheResult, binanceResult, databaseResult] = results;

    const cacheOk = cacheResult.status === 'fulfilled';
    const binanceOk = binanceResult.status === 'fulfilled';
    const databaseOk = databaseResult.status === 'fulfilled';

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (cacheOk && binanceOk && databaseOk) {
      status = 'healthy';
    } else if (binanceOk) {
      // Can still function without cache or DB
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      cache: cacheOk ? 'ok' : 'error',
      binance: binanceOk ? 'ok' : 'error',
      database: databaseOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      responseTime: {
        cache: cacheOk && cacheResult.value ? cacheResult.value : null,
        binance: binanceOk && binanceResult.value ? binanceResult.value : null,
        database: databaseOk && databaseResult.value ? databaseResult.value : null,
      },
    };
  }

  @Get('ready')
  async ready(): Promise<{ ready: boolean }> {
    try {
      // Quick check - just verify Binance is reachable
      await this.binanceService.getCurrentPrice('BTC');
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }

  @Get('live')
  live(): { live: boolean; uptime: number } {
    return {
      live: true,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  private async checkCache(): Promise<number> {
    const start = Date.now();
    try {
      await this.cacheManager.set('health-check', 'ok', 10_000); // 10 seconds in ms
      const value = await this.cacheManager.get('health-check');
      console.log(`[Health] Cache test - set 'ok', got '${value}'`);
      if (value !== 'ok') {
        console.log(`[Health] Cache value mismatch! Expected 'ok', got '${value}'`);
        throw new Error('Cache not working');
      }
      return Date.now() - start;
    } catch (error) {
      console.log(`[Health] Cache check failed:`, error);
      throw error;
    }
  }

  private async checkBinance(): Promise<number> {
    const start = Date.now();
    await this.binanceService.getCurrentPrice('BTC');
    return Date.now() - start;
  }

  private async checkDatabase(): Promise<number> {
    const start = Date.now();
    await this.prismaService.$queryRaw`SELECT 1`;
    return Date.now() - start;
  }
}
