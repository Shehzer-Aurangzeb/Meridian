import { Module } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ServicesModule } from './services/services.module';
import { PrismaModule } from './prisma/prisma.module';
import { BinanceService } from './services/binance.service';
import { IndicatorsService } from './services/indicators.service';
import { ClaudeService } from './services/claude.service';
import { AnalysisController } from './controllers/analysis.controller';
import { HealthController } from './controllers/health.controller';
import { MarketData } from './types/analysis.types';

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
      ttl: 300, // 5 minutes default TTL
      max: 500, // Max items in cache
    }),

    // Rate limiting: 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 seconds
        limit: 100, // 100 requests
      },
    ]),

    ServicesModule,
    PrismaModule,
  ],
  controllers: [AppController, AnalysisController, HealthController],
  providers: [
    // Apply throttler globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
