import { TradePlan } from '../analysis/services/trade-plan.service';
import { analysisFreshness, planInvalidated, zonesSurvive } from './freshness';

const plan = (
  direction: 'long' | 'short',
  stop: number,
  zoneCenter: number,
): TradePlan =>
  ({
    direction,
    stop,
    zone: { center: zoneCenter },
  }) as TradePlan;

const mapWith = (...centers: number[]) => ({
  map: { zones: centers.map((c) => ({ center: c })) },
}) as Pick<{ map: { zones: Array<{ center: number }> } }, 'map'> as never;

describe('planInvalidated', () => {
  it('a long dies below its stop, a short dies above', () => {
    expect(planInvalidated(plan('long', 100, 105), 99)).toBe(true);
    expect(planInvalidated(plan('long', 100, 105), 101)).toBe(false);
    expect(planInvalidated(plan('short', 100, 95), 101)).toBe(true);
    expect(planInvalidated(plan('short', 100, 95), 99)).toBe(false);
  });
});

describe('zonesSurvive', () => {
  it('accepts a zone that drifted inside the clustering band', () => {
    expect(zonesSurvive([100], [100.4])).toBe(true); // 0.4% < 0.5%
  });

  it('rejects a zone that moved beyond it', () => {
    expect(zonesSurvive([100], [101])).toBe(false); // 1% > 0.5%
  });

  it('an analysis with no zones cannot survive', () => {
    expect(zonesSurvive([], [100])).toBe(false);
  });
});

describe('analysisFreshness', () => {
  const record = {
    plans: [plan('long', 90, 95), plan('short', 110, 105)],
    map: { zones: [{ center: 95 }, { center: 105 }] },
  } as never;

  it('is LIVE while at least one plan survives', () => {
    // Below the long's stop, but the short is untouched.
    expect(analysisFreshness(record, 89, null)).toBe('LIVE');
  });

  it('is INVALIDATED only when every plan is gone', () => {
    // Impossible for both at one price by construction, so use a one-plan
    // record: this is the case that actually matters.
    const single = { plans: [plan('long', 90, 95)], map: { zones: [] } } as never;
    expect(analysisFreshness(single, 89, null)).toBe('INVALIDATED');
  });

  it('is SUPERSEDED when the newest map kept none of its zones', () => {
    expect(analysisFreshness(record, 100, mapWith(200, 300))).toBe('SUPERSEDED');
  });

  it('stays LIVE when the newest map still holds one of them', () => {
    expect(analysisFreshness(record, 100, mapWith(105.2, 300))).toBe('LIVE');
  });

  it('INVALIDATED outranks SUPERSEDED — price through the stop is definitive', () => {
    const single = { plans: [plan('long', 90, 95)], map: { zones: [] } } as never;
    expect(analysisFreshness(single, 89, mapWith(500))).toBe('INVALIDATED');
  });

  it('is LIVE with no comparison map — nothing can have superseded it', () => {
    expect(analysisFreshness(record, 100, null)).toBe('LIVE');
  });
});
