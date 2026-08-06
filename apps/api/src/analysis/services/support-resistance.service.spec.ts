import { BinanceService } from '../../market-data/market-data.service';
import { Candle } from '../../common/types/candle.types';
import { SupportResistanceService } from './support-resistance.service';

/**
 * Stability guard for the level engine.
 *
 * The engine this replaced (`IndicatorsService.identifyKeyLevels`) snapped
 * swings onto a lattice whose spacing was `currentPrice * 0.5%` and whose
 * origin was zero. Both moved with price, so the whole marked set shifted on
 * every tick: a measured 0.07% move on BTC relabelled the nearest level from
 * "support, 4 touches" to "resistance, 1 test".
 *
 * That was tolerable when levels fed a score nobody trusted. The levels are
 * now the product, so a marked set that moves with spot is a correctness bug.
 */
function buildCandles(): Candle[] {
  // A triangle wave: repeated swing highs at ~$31k and lows at ~$29k, so the
  // engine has real, repeatedly-tested levels to cluster rather than noise.
  const candles: Candle[] = [];
  for (let i = 0; i < 200; i++) {
    const phase = i % 20;
    const close = phase < 10 ? 29_000 + phase * 200 : 31_000 - (phase - 10) * 200;
    candles.push({
      time: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000),
      open: close,
      high: close + 60,
      low: close - 60,
      close,
      volume: 1_000 + i,
    });
  }
  return candles;
}

describe('SupportResistanceService — level stability', () => {
  const service = new SupportResistanceService({} as BinanceService);
  const candles = buildCandles();
  const spot = candles[candles.length - 1].close;

  /** Identity of a marked level, ignoring its distance from spot. */
  const marks = (price: number) =>
    service
      .levelsFromCandles(candles, '1d', price)
      .map((l) => `${l.type}@${l.price.toFixed(2)}x${l.touchCount}`)
      .sort();

  it('a sub-0.1% price move cannot change the marked set', () => {
    const base = marks(spot);
    expect(base.length).toBeGreaterThan(0);

    // ±0.05%, an order of magnitude below the 0.5% clustering threshold.
    expect(marks(spot * 1.0005)).toEqual(base);
    expect(marks(spot * 0.9995)).toEqual(base);
  });

  it('levels are anchored to swings, not to spot', () => {
    // A 5% move is far larger than any clustering tolerance. Where a level
    // sits, and how many times it was tested, are facts about history — they
    // must not depend on what price happens to be now. Only `distancePercent`
    // may change.
    expect(marks(spot * 1.05)).toEqual(marks(spot));
  });

  it('distance is measured from the supplied price', () => {
    const near = service.levelsFromCandles(candles, '1d', spot);
    const far = service.levelsFromCandles(candles, '1d', spot * 1.05);

    expect(near.length).toBe(far.length);
    // Same levels, different distances — the one thing that SHOULD move.
    expect(far[0].distancePercent).not.toBeCloseTo(near[0].distancePercent, 3);
  });

  it('respects the minimum-touches filter', () => {
    // MIN_TOUCHES defaults to 2: a level tested once is not a level.
    const levels = service.levelsFromCandles(candles, '1d', spot);
    expect(levels.every((l) => l.touchCount >= 2)).toBe(true);
  });
});
