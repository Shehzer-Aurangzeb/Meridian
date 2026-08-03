import { Candle } from '../common/types/candle.types';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../squeeze-breakout/squeeze-breakout.service';
import { ChecklistService } from '../analysis/services/checklist.service';
import { BinanceService } from '../market-data/market-data.service';
import { AnalysisCoordinatorService } from './analysis-coordinator.service';

/**
 * Regression guards for two silent wiring bugs that made the 5-point
 * checklist structurally unable to score:
 *
 *   A. The coordinator passed `bollingerBands.middle` (the 20-SMA) as
 *      "current price". Bollinger bands are symmetric about the middle, so
 *      the band-proximity condition scored *exactly* 50% of the band range
 *      on every run against a 10% threshold — it could never pass.
 *
 *   B. `IndicatorContext.rsiHistory` held the last 100 *closes* instead of
 *      the last 100 RSI values, so the checklist Z-scored RSI against price.
 *      For BTC that yields Z ≈ -66 every run: every LONG passed condition 1
 *      for free, every SHORT failed it.
 *
 * Both bugs are invisible in the output unless you know the numbers, which
 * is why they survived a refactor that claimed to preserve behaviour.
 */

/**
 * 250 candles priced ~$30,000 with small alternating noise, ending in a
 * sharp drop to $27,000.
 *
 * Chosen so the final close sits *below* the lower Bollinger band:
 * over the last 20 candles mean ≈ 29,850 and σ ≈ 654, giving a lower band
 * of ≈ 28,542 and a bandwidth of ≈ 8.8% (well clear of the 2% squeeze
 * floor). The noise keeps ATR/ADX well-defined — a perfectly flat series
 * degenerates them.
 */
function buildCandles(): Candle[] {
  const candles: Candle[] = [];

  for (let i = 0; i < 250; i++) {
    const isLast = i === 249;
    const close = isLast ? 27_000 : 30_000 + (i % 2 === 0 ? 150 : -150);

    candles.push({
      time: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
      open: close,
      high: close + 100,
      low: close - 100,
      close,
      volume: 1_000 + i,
    });
  }

  return candles;
}

describe('AnalysisCoordinatorService — checklist input wiring', () => {
  const indicators = new IndicatorsService();
  const binance = {} as BinanceService; // routeFromRegime does no I/O
  const marketRegime = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    marketRegime,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
  );

  const candles = buildCandles();
  const context = indicators.buildContext('BTC', '1h', candles);

  it('bug B: rsiHistory holds RSI values, not prices', () => {
    expect(context.rsiHistory).toHaveLength(100);

    // Prices here are ~30,000. RSI is bounded [0, 100] by definition, so
    // this fails loudly if the series is ever swapped back to closes.
    for (const value of context.rsiHistory) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('bug A: the checklist is anchored to the last close, not the 20-SMA', () => {
    const regime = marketRegime.classifyFromContext(context);
    const result = coordinator.routeFromRegime(context, '1h', regime);

    expect(result.strategyRoute).toBe('CONFLUENCE_CHECKLIST');
    expect(result.checklistResult).not.toBeNull();

    // `value` reads e.g. "58.9% from lower". Under bug A this was pinned to
    // exactly 50.0 on every run regardless of input.
    const proximity = parseFloat(
      String(result.checklistResult!.bollingerBand.value),
    );

    expect(Math.abs(proximity - 50)).toBeGreaterThan(1);
  });

  it('the band-proximity condition is reachable at all', () => {
    // Companion to the guard above: with a real price anchor, a close below
    // the lower band must score condition 3. Under bug A no input could
    // reach this, because the anchor was pinned to the band midpoint.
    const checklist = new ChecklistService();

    const result = checklist.evaluateChecklist({
      tradeType: 'long',
      rsi: context.rsi,
      rsiHistory: context.rsiHistory as number[],
      qqeColor: context.qqe.color,
      currentPrice: context.closes[context.closes.length - 1],
      bollingerBands: context.bollingerBands,
      bandWidth: context.bandWidth,
      marketStructure: 'HH/HL',
      nearestLevel: null,
    });

    expect(context.closes[context.closes.length - 1]).toBeLessThan(
      context.bollingerBands.lower,
    );
    expect(result.bollingerBand.passed).toBe(true);
    expect(result.bollingerBand.score).toBe(20);
  });
});
