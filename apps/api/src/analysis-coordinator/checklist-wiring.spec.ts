import { Candle } from '../common/types/candle.types';
import { IndicatorsService } from '../indicators/indicators.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../squeeze-breakout/squeeze-breakout.service';
import { ChecklistService } from '../analysis/services/checklist.service';
import { SupportResistanceService } from '../analysis/services/support-resistance.service';
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
 *   C. The coordinator DERIVED the direction from trend and then evaluated
 *      direction-specific conditions against it. A setup whose direction is
 *      implied by something other than trend — arriving at support during a
 *      downtrend is a long — was therefore evaluated as the opposite side,
 *      where `rsi >= 60` and the UPPER Bollinger band can never pass. In a
 *      zone-arrival test this scored 0 out of 839 on both conditions.
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
    new SupportResistanceService(),
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

  it('bug C: direction is an input, and it changes the conditions evaluated', () => {
    const regime = marketRegime.classifyFromContext(context);

    const asLong = coordinator.routeFromRegime(context, '1h', regime, 'long');
    const asShort = coordinator.routeFromRegime(context, '1h', regime, 'short');

    expect(asLong.checklistResult!.tradeType).toBe('long');
    expect(asShort.checklistResult!.tradeType).toBe('short');

    // This series closes BELOW the lower band, which is a long condition and
    // cannot be a short one. Under bug C the caller could not express that,
    // so whichever side the trend implied was the only side ever scored.
    expect(asLong.checklistResult!.bollingerBand.passed).toBe(true);
    expect(asShort.checklistResult!.bollingerBand.passed).toBe(false);

    // Same bar, same indicators, opposite orientation — the two evaluations
    // must differ, which is exactly what could not happen before.
    //
    // Compared as a PATTERN, not a count: the counts can legitimately tie
    // (here both are 2) because conditions that fail for a long may pass for
    // a short. It is which conditions fired that must change.
    const pattern = (r: typeof asLong) =>
      r.checklistResult!.conditions.map((c) => `${c.name}:${c.passed}`).join('|');

    expect(pattern(asLong)).not.toBe(pattern(asShort));
  });

  it('bug C: an unspecified direction still falls back to trend', () => {
    // The fallback must survive, because existing callers pass no direction.
    const regime = marketRegime.classifyFromContext(context);
    const derived = coordinator.routeFromRegime(context, '1h', regime);

    expect(['long', 'short']).toContain(derived.checklistResult!.tradeType);
    expect(derived.reasoning).toContain('derived from trend');

    const supplied = coordinator.routeFromRegime(context, '1h', regime, 'long');
    expect(supplied.reasoning).toContain('supplied by caller');
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
  });
});
