import { Controller, Get, Param, Query } from '@nestjs/common';
import { BinanceService } from '../../market-data/market-data.service';
import { IndicatorsService } from '../../indicators/indicators.service';
import { TimeInterval } from '../../common/types/candle.types';

@Controller('analysis/validate')
export class ValidationController {
  constructor(
    private readonly binanceService: BinanceService,
    private readonly indicatorsService: IndicatorsService,
  ) {}

  /**
   * Validate Indicators Against TradingView
   * Returns calculated indicator values for manual comparison
   */
  @Get(':coin')
  async validateIndicators(
    @Param('coin') coin: string,
    @Query('timeframe') timeframe: string = '1d',
  ) {
    try {
      const symbol = `${coin.toUpperCase()}USDT`;
      const tf = (timeframe || '1d') as TimeInterval;

      const candles = await this.binanceService.getCandles(symbol, tf, 100);

      const closePrices = candles.map((c) => c.close);
      const highPrices = candles.map((c) => c.high);
      const lowPrices = candles.map((c) => c.low);

      const rsi = this.indicatorsService.calculateRSI(closePrices, 14);
      const bb = this.indicatorsService.calculateBollingerBands(closePrices, 20, 2);
      const atr = this.indicatorsService.calculateATR(highPrices, lowPrices, closePrices, 14);
      const qqe = this.indicatorsService.calculateQQE(closePrices, 14);
      const bandWidth = this.indicatorsService.calculateBandWidth(bb);

      const last20Closes = closePrices.slice(-20);
      const manualSMA = last20Closes.reduce((a, b) => a + b, 0) / 20;

      const lastCandle = candles[candles.length - 1];
      const currentPrice = lastCandle.close;

      return {
        success: true,
        data: {
          symbol,
          timeframe: tf,
          candleCount: candles.length,
          lastCandle: {
            time: lastCandle.time,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
            volume: lastCandle.volume,
          },
          indicators: {
            rsi: {
              value: Number(rsi.toFixed(2)),
              period: 14,
              description: 'RSI(14) - Compare with TradingView RSI indicator',
            },
            bollingerBands: {
              upper: Number(bb.upper.toFixed(2)),
              middle: Number(bb.middle.toFixed(2)),
              lower: Number(bb.lower.toFixed(2)),
              period: 20,
              stdDev: 2,
              description: 'BB(20,2) - Compare with TradingView Bollinger Bands',
            },
            atr: {
              value: Number(atr.toFixed(2)),
              period: 14,
              description: 'ATR(14) - Compare with TradingView ATR indicator',
            },
            qqe: {
              color: qqe.color,
              value: Number(qqe.value.toFixed(2)),
              trend: qqe.trend,
              previousColor: qqe.previousColor,
              description: 'QQE Mod - Custom indicator based on smoothed RSI',
            },
            bandWidth: {
              value: Number(bandWidth.toFixed(2)),
              description: 'Bollinger Band Width as percentage',
            },
          },
          verification: {
            manualSMA20: Number(manualSMA.toFixed(2)),
            bbMiddleMatchesSMA: Math.abs(bb.middle - manualSMA) < 0.01,
            currentPrice: Number(currentPrice.toFixed(2)),
          },
          instructions: [
            '1. Open TradingView and load ' + symbol + ' chart',
            '2. Set timeframe to ' + tf,
            '3. Add RSI(14) indicator and compare with rsi.value above',
            '4. Add Bollinger Bands(20,2) and compare with bollingerBands values',
            '5. Add ATR(14) and compare with atr.value above',
            '6. Document any differences in INDICATOR_VALIDATION.md',
          ],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Indicator validation failed';
      return {
        success: false,
        error: message,
      };
    }
  }
}
