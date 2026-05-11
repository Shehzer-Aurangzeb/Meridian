import { Module } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { ServicesModule } from './services/services.module';
import { PrismaModule } from './prisma/prisma.module';
import { BinanceService } from './services/binance.service';
import { IndicatorsService } from './services/indicators.service';
import { ClaudeService } from './services/claude.service';
import { AnalysisController } from './controllers/analysis.controller';
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
  imports: [ServicesModule, PrismaModule],
  controllers: [AppController, AnalysisController],
  providers: [],
})
export class AppModule {}
