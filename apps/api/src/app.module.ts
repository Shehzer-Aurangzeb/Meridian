import { Module } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServicesModule } from './services/services.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './controllers/health.controller';
import { ApiKeyGuard, Public } from './common/guards/api-key.guard';

@ApiTags('root')
@Controller()
class AppController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Service banner / liveness ping' })
  getHello(): { message: string; status: string } {
    return {
      message: 'Meridian API',
      status: 'running',
    };
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
    // Order matters: throttle first, so a brute-force attempt against the key
    // is rate-limited before it is ever compared.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global, not per-controller. A guard applied only to new routes leaves
    // every legacy /analysis-coordinator route open, which is the same hole
    // with extra steps. Opt OUT with @Public(), never opt in.
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
