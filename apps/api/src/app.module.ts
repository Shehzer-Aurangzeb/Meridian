import { Module } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ServicesModule } from './services/services.module';
import { PrismaModule } from './prisma/prisma.module';
import { BinanceService } from './market-data/market-data.service';
import { IndicatorsService } from './indicators/indicators.service';
import { ClaudeService } from './ai/ai.service';
import { HealthController } from './controllers/health.controller';
import { MarketData } from './analysis/interfaces/analysis.types';

@Controller()
class AppController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
    private readonly claudeService: ClaudeService,
  ) {}

  @Get()
  getHello(): { message: string; status: string } {
    return {
      message: 'Meridian API',
      status: 'running',
    };
  }

  // Temporary test endpoint - remove after verification
  @Get('test-binance')
  async testBinance() {
    const candles = await this.binanceService.getCandles('BTC', '1h', 10);
    const price = await this.binanceService.getCurrentPrice('BTC');
    return { candles, price };
  }

  // Temporary test endpoint - remove after verification
  @Get('test-indicators')
  async testIndicators() {
    const candles = await this.binanceService.getCandles('BTC', '1h', 100);
    const indicators = this.indicatorsService.analyzeTimeframe(candles);
    return indicators;
  }

  // Temporary test endpoint - remove after verification
  @Get('test-claude')
  async testClaude() {
    const candles = await this.binanceService.getCandles('BTC', '4h', 100);
    const currentPrice = await this.binanceService.getCurrentPrice('BTC');
    const indicators = this.indicatorsService.analyzeTimeframe(candles);

    const marketData: MarketData = {
      coin: 'BTC',
      timeframe: '4h',
      currentPrice,
      indicators,
      candles,
    };

    const analysis = await this.claudeService.analyzeMarket(marketData);
    return analysis;
  }
}

@Module({
  imports: [
    // In-memory cache for development
    // For production, use Redis: cache-manager-redis-store
    CacheModule.register({
      isGlobal: true,
      ttl: 300_000, // 5 minutes default TTL (in ms for cache-manager v7)
      max: 500, // Max items in cache
    }),

    // Rate limiting: 100 requests per 60 seconds per IP
    // Disabled in test environment to avoid intermittent failures
    ThrottlerModule.forRoot(
      process.env.NODE_ENV === 'test'
        ? [{ ttl: 60000, limit: 10000 }] // Very high limit for tests
        : [{ ttl: 60000, limit: 100 }],
    ),

    // ServicesModule re-exports all feature modules
    ServicesModule,
    PrismaModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    // Apply throttler globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
