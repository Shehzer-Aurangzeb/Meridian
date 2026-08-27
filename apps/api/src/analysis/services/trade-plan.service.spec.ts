import { ConfluenceZone, ZoneTier } from '../interfaces/support-resistance.types';
import {
  ENTRY_WEIGHTS,
  STOP_ATR_MULTIPLE,
  TradePlanService,
  ZONE_BANDS,
  TARGET_WEIGHTS,
  renormaliseTargetWeights,
} from './trade-plan.service';

const zone = (
  low: number,
  high: number,
  sources: string[] = ['a', 'b'],
  // HTF by default: only HTF zones are tradeable or targetable, so a fixture
  // built at any other tier would produce no plan at all.
  tier: ZoneTier = 'HTF',
): ConfluenceZone => ({
  low,
  high,
  center: (low + high) / 2,
  type: 'support',
  sources,
  spanPercent: ((high - low) / ((high + low) / 2)) * 100,
  distancePercent: 0,
  tier,
});

describe('TradePlanService', () => {
  const service = new TradePlanService();
  const spot = 30_000;
  const atr = 300;
  const atrByTier = { HTF: atr, MID: atr, LTF: atr };

  /**
   * The plan's GEOMETRY, built from the zone this direction would trade.
   *
   * Goes through `buildPlan` rather than `buildPlans` because the two answer
   * different questions: this one is "given this zone, what is the plan", and
   * `buildPlans` is "which plans are worth printing" — it withholds a plan
   * with no target, which would leave the geometry fixtures below with nothing
   * to assert on. That rule has its own test.
   */
  const planFor = (direction: 'long' | 'short', zones: ConfluenceZone[]) => {
    const zone =
      direction === 'long'
        ? zones.filter((z) => z.high < spot).sort((a, b) => b.high - a.high)[0]
        : zones.filter((z) => z.low > spot).sort((a, b) => a.low - b.low)[0];
    if (!zone) throw new Error(`no ${direction} zone in this fixture`);
    return service.buildPlan(zone, direction, spot, atr, zones);
  };

  describe('distance states', () => {
    it('classifies by distance to the NEAR edge, not the centre', () => {
      // Near edge 0.5% away, centre 2% away. A wide zone price is nearly
      // touching is actionable; measuring to the centre would call it
      // APPROACHING and hide that the first entry is live.
      const plan = planFor('long', [zone(28_800, 29_850)]);

      expect(plan.distanceToZonePercent).toBeCloseTo(-0.5, 1);
      expect(plan.state).toBe('ACTIONABLE');
    });

    it('walks ACTIONABLE → APPROACHING → FAR', () => {
      const at = (pct: number) => {
        const edge = spot * (1 - pct / 100);
        return planFor('long', [zone(edge - 50, edge)]).state;
      };

      expect(at(0.5)).toBe('ACTIONABLE');
      expect(at(ZONE_BANDS.ACTIONABLE + 0.5)).toBe('APPROACHING');
      expect(at(ZONE_BANDS.APPROACHING + 1)).toBe('FAR');
    });

    it('never withholds a plan — FAR still carries entries, stop and targets', () => {
      // The product requirement: a tool that goes quiet is a failed tool.
      //
      // The target zone must sit ABOVE spot. The entry is always the nearest
      // zone below spot, so any zone between entry and spot would have BEEN
      // the entry — nothing can occupy that gap.
      const plan = planFor('long', [zone(26_000, 26_100), zone(31_000, 31_100)]);

      expect(plan.state).toBe('FAR');
      expect(plan.entries).toHaveLength(3);
      expect(plan.stop).toBeGreaterThan(0);
      expect(plan.targets.length).toBeGreaterThan(0);
      expect(plan.comeBackWhen).toContain('within');
    });
  });

  describe('both directions', () => {
    it('plans a long below and a short above, unprompted', () => {
      const plans = service.buildPlans(
        [zone(29_000, 29_100), zone(31_000, 31_100)],
        spot,
        atrByTier,
      );

      expect(plans.map((p) => p.direction).sort()).toEqual(['long', 'short']);
    });

    it('skips a zone price is already inside — no clean edge to anchor to', () => {
      const straddling = zone(29_900, 30_100); // spot 30,000 sits within
      expect(service.buildPlans([straddling], spot, atrByTier)).toEqual([]);
    });

    it('mirrors the entry ladder for a short', () => {
      const plan = planFor('short', [zone(31_000, 31_200)]);

      expect(plan.direction).toBe('short');
      // Price rises INTO a resistance zone, so it touches the low edge first.
      expect(plan.entries[0].price).toBe(31_000);
      expect(plan.entries[2].price).toBe(31_200);
      // Stop sits ABOVE the zone for a short.
      expect(plan.stop).toBeCloseTo(31_200 + atr * STOP_ATR_MULTIPLE, 6);
    });
  });

  describe('stop and risk', () => {
    it('anchors the stop to the ZONE, not the entry', () => {
      // The playbook stop is "Support Level − ATR" (p17). Anchoring to entry
      // would move the stop when the ladder changes, which would make risk a
      // function of position sizing rather than of structure.
      const z = zone(29_000, 29_200);
      const plan = planFor('long', [z, zone(31_000, 31_100)]);

      expect(plan.stop).toBeCloseTo(29_000 - atr * STOP_ATR_MULTIPLE, 6);
      expect(plan.stop).toBeLessThan(Math.min(...plan.entries.map((e) => e.price)));
    });

    it('weights the average entry by the ladder', () => {
      const plan = planFor('long', [zone(29_000, 29_200)]);

      const expected =
        (29_200 * ENTRY_WEIGHTS[0] + 29_100 * ENTRY_WEIGHTS[1] + 29_000 * ENTRY_WEIGHTS[2]) /
        (ENTRY_WEIGHTS[0] + ENTRY_WEIGHTS[1] + ENTRY_WEIGHTS[2]);

      expect(plan.averageEntry).toBeCloseTo(expected, 6);
    });

    it('risk percent matches the stop distance exactly', () => {
      const plan = planFor('long', [zone(29_000, 29_200)]);

      expect(plan.riskPerUnit).toBeCloseTo(plan.averageEntry - plan.stop, 6);
      expect(plan.riskPercent).toBeCloseTo(
        (plan.riskPerUnit / plan.averageEntry) * 100,
        6,
      );
    });
  });

  describe('targets', () => {
    it('uses successive zones, nearest first, and never the entry zone', () => {
      const entry = zone(29_000, 29_100);
      const long = planFor('long', [
        entry,
        zone(30_500, 30_600),
        zone(31_500, 31_600),
        zone(32_500, 32_600),
      ]);

      expect(long.targets.map((t) => t.price)).toEqual([30_500, 31_500, 32_500]);
      expect(long.targets.every((t) => t.price !== entry.low)).toBe(true);
    });

    it('exits at the near edge of each target zone', () => {
      // Waiting for the far side of a zone to fill is how a target gets
      // missed by a few ticks.
      const long = planFor('long', [zone(29_000, 29_100), zone(30_500, 30_900)]);
      expect(long.targets[0].price).toBe(30_500);
    });

    it('computes R against the weighted entry and the zone-anchored stop', () => {
      const long = planFor('long', [zone(29_000, 29_100), zone(30_500, 30_600)]);
      const t = long.targets[0];

      expect(t.rMultiple).toBeCloseTo(
        (t.price - long.averageEntry) / long.riskPerUnit,
        6,
      );
    });

    it('blends R across the ladder by weight', () => {
      const long = planFor('long', [
        zone(29_000, 29_100),
        zone(29_300, 29_400),
        zone(31_000, 31_100),
        zone(33_000, 33_100),
      ]);

      const expected =
        long.targets.reduce((s, t) => s + t.rMultiple * t.weightPercent, 0) / 100;
      expect(long.blendedR).toBeCloseTo(expected, 6);
    });

    it('surfaces a sub-1R TP1 through the blend rather than hiding it', () => {
      // Observed on live ETH 4h: TP1 came out at 0.70R. It happens when ATR
      // is large relative to zone spacing — the stop sits a full ATR beyond
      // the zone, so risk is wide while the first target beyond spot is near.
      // The blend is what makes the plan judgeable in that case.
      const long = planFor('long', [
        zone(29_700, 29_800), // entry, just below spot
        zone(30_050, 30_100), // first target, just above spot
        zone(32_000, 32_100),
      ]);

      expect(long.targets[0].rMultiple).toBeLessThan(1);
      expect(long.blendedR).toBeGreaterThan(long.targets[0].rMultiple);
    });

    it('says so plainly when there is nothing ahead', () => {
      const long = planFor('long', [zone(29_000, 29_100)]);
      expect(long.targets).toEqual([]);
      expect(long.blendedR).toBe(0);
    });

    it('does not PRINT a plan it has no exit for', () => {
      // One zone below spot and nothing above it: the long can only reach its
      // stop or the end of the hold window. 57 of the 626 backtested trades
      // were this shape and resolved at −1.08R, every resolved one a stop-out.
      expect(service.buildPlans([zone(29_000, 29_100)], spot, atrByTier)).toEqual([]);

      // Give it somewhere to go and it is printed again — the rule is about
      // the missing exit, not about single-zone maps.
      const withTarget = service.buildPlans(
        [zone(29_000, 29_100), zone(31_000, 31_100)],
        spot,
        atrByTier,
      );
      expect(withTarget.map((p) => p.direction).sort()).toEqual(['long', 'short']);
      expect(withTarget.every((p) => p.targets.length > 0)).toBe(true);
    });
  });

  it('names the invalidation price in every come-back instruction', () => {
    const plans = service.buildPlans(
      [zone(29_000, 29_100), zone(31_000, 31_100)], spot, atrByTier);

    for (const plan of plans) {
      expect(plan.comeBackWhen).toContain(plan.stop.toFixed(2));
      expect(plan.comeBackWhen).toMatch(/close (below|above)/);
    }
  });
});

describe('renormaliseTargetWeights', () => {
  it('leaves a full three-target ladder BIT-IDENTICAL', () => {
    // Load-bearing. A 3-target plan already summed to 100, so C1 never touched
    // it and neither may the fix. Exact equality, not toBeCloseTo — if this
    // ever needs a tolerance, the renormalisation is doing arithmetic it
    // should not be doing.
    expect(renormaliseTargetWeights(3)).toEqual([33, 33, 34]);
    expect(renormaliseTargetWeights(3)).toEqual([...TARGET_WEIGHTS]);
  });

  it('sends the whole position to a lone target', () => {
    expect(renormaliseTargetWeights(1)).toEqual([100]);
  });

  it('splits two targets evenly', () => {
    expect(renormaliseTargetWeights(2)).toEqual([50, 50]);
  });

  it('has nothing to divide when there are no targets', () => {
    expect(renormaliseTargetWeights(0)).toEqual([]);
  });

  it('always sums to exactly 100 when there is at least one target', () => {
    for (const n of [1, 2, 3]) {
      const sum = renormaliseTargetWeights(n).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    }
  });
});

describe('buildPlans — exit weights account for the whole position', () => {
  /** Zones at 96–100 (entry), then 104–105, 109–110, 114–115 ahead of a long. */
  const zone = (low: number, high: number): ConfluenceZone => ({
    low,
    high,
    center: (low + high) / 2,
    type: 'support',
    sources: ['12h support', '0.5 Fib (12h)'],
    spanPercent: ((high - low) / ((low + high) / 2)) * 100,
    distancePercent: 0,
    tier: 'HTF',
  });

  const planFor = (aheadCount: number) => {
    const zones = [zone(96, 100), zone(104, 105), zone(109, 110), zone(114, 115)];
    const svc = new TradePlanService();
    const [longPlan] = svc.buildPlans(zones.slice(0, aheadCount + 1), 102, { HTF: 3.4, MID: 3.4, LTF: 3.4 });
    return longPlan;
  };

  it('one target takes the entire position', () => {
    const p = planFor(1);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].weightPercent).toBe(100);
  });

  it('two targets split it evenly', () => {
    const p = planFor(2);
    expect(p.targets.map((t) => t.weightPercent)).toEqual([50, 50]);
  });

  it('three targets keep the playbook split', () => {
    const p = planFor(3);
    expect(p.targets.map((t) => t.weightPercent)).toEqual([33, 33, 34]);
  });

  it('weights sum to 100 for every target count', () => {
    for (const n of [1, 2, 3]) {
      const sum = planFor(n).targets.reduce((a, t) => a + t.weightPercent, 0);
      expect(sum).toBe(100);
    }
  });

  it('plannedR is a real weighted mean, not a third of one', () => {
    const p = planFor(1);
    // One target now carries the whole ladder, so blendedR IS its rMultiple.
    // Before the fix this reported rMultiple × 0.33.
    expect(p.blendedR).toBeCloseTo(p.targets[0].rMultiple, 10);
  });

  it('mirrors for a short', () => {
    const zones = [zone(104, 108), zone(96, 100)];
    const svc = new TradePlanService();
    const shortPlan = svc.buildPlans(zones, 102, { HTF: 3.4, MID: 3.4, LTF: 3.4 }).find((x) => x.direction === 'short');
    expect(shortPlan?.targets).toHaveLength(1);
    expect(shortPlan?.targets[0].weightPercent).toBe(100);
  });
});
