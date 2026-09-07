import { buildShelfMap, ShelfSnapshot } from './shelf-map.math';
import { computeCrowding } from './crowding.math';

const snap = (mid: number, bid: number, ask: number): ShelfSnapshot => ({
  mid,
  bidByShell: new Array(5).fill(bid),
  askByShell: new Array(5).fill(ask),
});

describe('buildShelfMap', () => {
  it('puts bids below mid and asks above it', () => {
    const map = buildShelfMap([snap(100, 10, 20)], 1);
    const bidSide = map.filter((b) => b.priceHigh <= 100);
    const askSide = map.filter((b) => b.priceLow >= 100);
    expect(bidSide.reduce((s, b) => s + b.bidNotional, 0)).toBeGreaterThan(0);
    expect(bidSide.reduce((s, b) => s + b.askNotional, 0)).toBe(0);
    expect(askSide.reduce((s, b) => s + b.askNotional, 0)).toBeGreaterThan(0);
    expect(askSide.reduce((s, b) => s + b.bidNotional, 0)).toBe(0);
  });

  it('conserves notional — spreading must not create or destroy size', () => {
    const map = buildShelfMap([snap(100, 10, 20)], 0.25);
    // Five shells at 10 per side.
    expect(map.reduce((s, b) => s + b.bidNotional, 0)).toBeCloseTo(50, 6);
    expect(map.reduce((s, b) => s + b.askNotional, 0)).toBeCloseTo(100, 6);
  });

  it('spreads a shell across its band rather than spiking at a point', () => {
    // Dropping a band's notional at its midpoint would invent a concentration
    // the archive never reported.
    const map = buildShelfMap([snap(100, 10, 0)], 0.25);
    const touched = map.filter((b) => b.bidNotional > 0);
    expect(touched.length).toBeGreaterThan(5);
  });

  it('accumulates across snapshots at the same prices', () => {
    const one = buildShelfMap([snap(100, 10, 10)], 0.25);
    const two = buildShelfMap([snap(100, 10, 10), snap(100, 10, 10)], 0.25);
    expect(two.reduce((s, b) => s + b.bidNotional, 0)).toBeCloseTo(
      2 * one.reduce((s, b) => s + b.bidNotional, 0),
      6,
    );
  });

  it('anchors bands to each snapshot own mid, so a moving market spreads out', () => {
    const still = buildShelfMap([snap(100, 10, 10), snap(100, 10, 10)], 0.25);
    const moved = buildShelfMap([snap(100, 10, 10), snap(140, 10, 10)], 0.25);
    expect(moved.length).toBeGreaterThan(still.length);
  });

  it('returns nothing usable rather than guessing', () => {
    expect(buildShelfMap([])).toEqual([]);
    expect(buildShelfMap([snap(0, 10, 10)])).toEqual([]);
    expect(buildShelfMap([{ mid: 100, bidByShell: [], askByShell: [] }], 0.25)).toEqual([]);
  });
});

describe('computeCrowding', () => {
  const history = Array.from({ length: 100 }, (_, i) => i / 1000);

  it('scores each component against its own history', () => {
    const c = computeCrowding({
      funding: 0.099,
      fundingHistory: history,
      openInterest: 110,
      openInterest24hAgo: 100,
      openInterestChangeHistory: Array.from({ length: 100 }, (_, i) => i / 1000),
    });
    expect(c.fundingPercentile).toBeGreaterThan(95);
    expect(c.oiChange24h).toBeCloseTo(0.1, 10);
    expect(c.components).toContain('funding');
    expect(c.components).toContain('openInterestChange');
  });

  it('averages over the components PRESENT, not a fixed denominator', () => {
    // Treating a missing component as zero would report a crowded market calm.
    const c = computeCrowding({
      funding: 0.099,
      fundingHistory: history,
      openInterest: 0,
      openInterest24hAgo: 0,
      openInterestChangeHistory: [],
    });
    expect(c.components).toEqual(['funding']);
    expect(c.score).toBeCloseTo(c.fundingPercentile, 10);
    expect(c.oiChange24h).toBeNull();
  });

  it('carries the no-lift finding on every reading', () => {
    const c = computeCrowding({
      funding: 0.01,
      fundingHistory: history,
      openInterest: 100,
      openInterest24hAgo: 100,
      openInterestChangeHistory: [],
    });
    // Bar 3b failed, so nothing may present this as a forecast.
    expect(c.note).toContain('no measured lift');
    expect(c.note).toContain('11.1% base rate');
  });

  it('never mentions liquidations as a prediction', () => {
    const c = computeCrowding({
      funding: 0.01,
      fundingHistory: history,
      openInterest: 100,
      openInterest24hAgo: 100,
      openInterestChangeHistory: [],
    });
    expect(c.note).toContain('after the fact');
    expect(c.note).not.toMatch(/will (trigger|cascade)/i);
  });

  it('is zero, not NaN, with nothing measurable at all', () => {
    const c = computeCrowding({
      funding: NaN,
      fundingHistory: [],
      openInterest: 0,
      openInterest24hAgo: 0,
      openInterestChangeHistory: [],
    });
    expect(c.score).toBe(0);
    expect(c.components).toEqual([]);
  });
});
