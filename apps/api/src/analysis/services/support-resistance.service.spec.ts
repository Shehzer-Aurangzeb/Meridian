import { BinanceService } from '../../market-data/market-data.service';
import { Candle } from '../../common/types/candle.types';
import { SupportResistanceService } from './support-resistance.service';
import { ZoneTier } from '../interfaces/support-resistance.types';

/**
 * Checks the levels stay put as price moves.
 *
 * An older version placed levels on a grid measured from the CURRENT price,
 * so the whole set shifted on every tick — a 0.07% move could relabel a level
 * from "support, touched 4 times" to "resistance, touched once". The levels
 * are the product now, so that is a correctness bug rather than a nuisance.
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
  const service = new SupportResistanceService();
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

describe('SupportResistanceService — playbook Fibonacci', () => {
  const service = new SupportResistanceService();

  it("reproduces the playbook's own worked example (p51)", () => {
    // "Swing Low: $25,000 (0 level) · 0.25: $28,750 · 0.5: $32,500 (mid-range)
    //  · 0.75: $36,250 · Swing High: $40,000 (1.0 level)"
    // These only reproduce on QUARTERS. Classic 0.236/0.382/0.618 would give
    // 28,540 / 30,730 / 34,270 and match nothing in the document.
    const fib = service.fibLevels(25_000, 40_000);

    expect(fib.map((f) => f.price)).toEqual([25_000, 28_750, 32_500, 36_250, 40_000]);
  });

  it('types levels by position in the range, not by spot', () => {
    // Playbook colour code: "0 and 0.25 and 0.5: BLUE (support zones)
    //                        0.75 and 1.0: RED (resistance zones)"
    const fib = service.fibLevels(25_000, 40_000);

    expect(fib.map((f) => f.type)).toEqual([
      'support', 'support', 'support', 'resistance', 'resistance',
    ]);
  });

  it('refuses a degenerate range rather than emitting five identical levels', () => {
    expect(service.fibLevels(30_000, 30_000)).toEqual([]);
    expect(service.fibLevels(40_000, 25_000)).toEqual([]);
  });
});

describe('SupportResistanceService — confluence zones', () => {
  const service = new SupportResistanceService();
  const spot = 30_000;

  const mark = (
    price: number,
    source: string,
    type: 'support' | 'resistance' = 'support',
    tier: ZoneTier = 'MID',
  ) => ({ price, source, type, tier });

  it('groups marks that agree and names every contributor', () => {
    const zones = service.findConfluenceZones(
      [
        mark(28_600, '0.25 Fib (12h)'),
        mark(28_650, '4h swing x3'),
        mark(28_700, '1h swing x2'),
        mark(24_000, 'lone level'), // far away, and alone
      ],
      spot,
    );

    expect(zones).toHaveLength(1);
    expect(zones[0].sources).toHaveLength(3);
    expect(zones[0].low).toBe(28_600);
    expect(zones[0].high).toBe(28_700);
    expect(zones[0].spanPercent).toBeLessThan(0.6); // playbook's ~0.5% band
  });

  it('a lone level is not a zone', () => {
    // Confluence means agreement. One mark with a wide band is not that.
    expect(service.findConfluenceZones([mark(28_600, 'only me')], spot)).toEqual([]);
  });

  it('does not manufacture agreement from a duplicated source', () => {
    // The same source counted twice must not clear minSources=2, or every
    // level would become a zone by being listed on two timeframes.
    const zones = service.findConfluenceZones(
      [mark(28_600, '4h swing x3'), mark(28_610, '4h swing x3')],
      spot,
    );
    expect(zones).toEqual([]);
  });

  it('reports signed distance so callers know which side spot is on', () => {
    const below = service.findConfluenceZones(
      [mark(27_000, 'a'), mark(27_050, 'b')], spot,
    );
    const above = service.findConfluenceZones(
      [mark(33_000, 'a', 'resistance'), mark(33_050, 'b', 'resistance')], spot,
    );

    expect(below[0].distancePercent).toBeLessThan(0);
    expect(above[0].distancePercent).toBeGreaterThan(0);
  });

  it('types zones by position, not by the historical swing type', () => {
    // A swing HIGH sitting below spot is a former resistance being retested
    // as support. For a plan, what matters is that it is below price — that
    // is where a long goes. The historical reading stays in `sources`.
    const zones = service.findConfluenceZones(
      [
        mark(27_000, 'old resistance', 'resistance'),
        mark(27_050, '4h resistance', 'resistance'),
      ],
      spot,
    );

    expect(zones[0].type).toBe('support');
    expect(zones[0].sources).toEqual(['old resistance', '4h resistance']);
  });

  it('caps total span so a chain cannot drift into a fake wide zone', () => {
    // Each mark is within 0.5% of the RUNNING MEAN, so unbounded greedy
    // grouping would swallow all of these into one ~2% "zone". Real data hit
    // this: a BTC zone spanned 0.76% against the playbook's ~0.5% band.
    const drifting = [
      mark(30_000, 'a'), mark(30_140, 'b'), mark(30_280, 'c'),
      mark(30_420, 'd'), mark(30_560, 'e'), mark(30_700, 'f'),
    ];
    const zones = service.findConfluenceZones(drifting, spot);

    expect(zones.length).toBeGreaterThan(1); // split, not one wide band
    for (const z of zones) {
      expect(z.spanPercent).toBeLessThanOrEqual(1.0); // 2x the 0.5% threshold
    }
  });

  it("still admits the playbook's own 0.524%-span zone", () => {
    // p53: 28,600 - 28,750. The cap must be looser than the pairwise
    // threshold or it would reject the document's worked example.
    const zones = service.findConfluenceZones(
      [mark(28_600, 'trendline'), mark(28_675, '4h support'), mark(28_750, '0.25 Fib')],
      30_000,
    );

    expect(zones).toHaveLength(1);
    expect(zones[0].sources).toHaveLength(3);
    expect(zones[0].spanPercent).toBeCloseTo(0.524, 2);
  });

  it('orders by proximity to spot', () => {
    const zones = service.findConfluenceZones(
      [
        mark(29_500, 'a'), mark(29_520, 'b'),
        mark(25_000, 'c'), mark(25_020, 'd'),
      ],
      spot,
    );

    expect(zones).toHaveLength(2);
    expect(Math.abs(zones[0].distancePercent)).toBeLessThan(
      Math.abs(zones[1].distancePercent),
    );
  });
});
