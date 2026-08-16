import { Candle } from '../../src/common/types/candle.types';
import {
  ScorablePlan,
  ScoringConfig,
  scoreTrade,
} from '../../src/common/replay/trade-scoring';
import {
  ARMS,
  ArmSpec,
  MAX_ARM_BARS,
  parseSplit,
  scoreArm,
  selectSplit,
  netAt,
  splitHeader,
  TUNE_FRACTION,
} from './exits';

/**
 * The exit arms, and the one invariant that makes them comparable at all.
 *
 * Was a `--self-check` block inside exits.ts, testing a `scoreTrailing` that
 * no longer exists. The trail is now a parameter to the shared `scoreTrade`,
 * so these are ordinary tests run by `pnpm test` and they cannot be skipped by
 * forgetting a flag.
 */
const bar = (high: number, low: number, close = (high + low) / 2): Candle =>
  ({ time: new Date(0), open: close, high, low, close, volume: 0 }) as Candle;

/** Zone 96–100: 20% at 100, 40% at 98, 40% at 96. avgEntry 97.6, stop 92.6. */
const plan: ScorablePlan = {
  direction: 'long',
  entries: [
    { price: 100, weightPercent: 20 },
    { price: 98, weightPercent: 40 },
    { price: 96, weightPercent: 40 },
  ],
  averageEntry: 97.6,
  stop: 92.6,
  riskPerUnit: 5,
  // Kept consistent with riskPerUnit/averageEntry, as TradePlanService always
  // emits it. `scoreArm` passes riskPercent VERBATIM at stopScale 1 (for the
  // bit-identity above) and recomputes it otherwise, so a fixture where the two
  // disagree shows a discontinuity that no real plan can produce.
  riskPercent: (5 / 97.6) * 100,
  targets: [{ price: 107.6, weightPercent: 100 }],
};

const base: ScoringConfig = {
  fillBars: 3,
  maxBars: 6,
  breakevenAfterTarget: 1,
  roundTripPct: 0.14,
};

const armed = (over: Partial<ArmSpec>): ArmSpec => ({
  name: 'test',
  targetScale: 1,
  stopScale: 1,
  breakevenAfterTarget: 1,
  trail: false,
  ...over,
});

describe('scoreArm — the BASE_check invariant', () => {
  /**
   * THE load-bearing test of the exit sweep. An arm with every parameter
   * neutral and `maxBars` inherited must BE the base trade, bit for bit.
   *
   * If it drifts, `exits.ts` has grown its own entry or resolution model again
   * — which is exactly what happened between CP1 and CP3.5, when it kept a
   * full-size fill at `averageEntry` while the base path moved to leg-by-leg
   * fills. Every arm comparison in `arms.csv` was then measuring two different
   * things and attributing the difference to the exit rule.
   */
  const spec = ARMS.find((a) => a.name === 'BASE_check') as ArmSpec;

  const fixtures: Array<[string, Candle[]]> = [
    ['a clean run to target', [bar(103, 96), bar(108, 100), bar(103, 99), bar(103, 99)]],
    ['a stop-out', [bar(103, 99), bar(100, 92), bar(103, 99), bar(103, 99)]],
    ['a one-leg fill held to the window end', [bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99)]],
    ['a fill bar that also breaches the stop', [bar(100, 90), bar(108, 100), bar(103, 99), bar(103, 99)]],
    ['a partial: TP1 then stopped at breakeven', [bar(103, 98), bar(108, 99), bar(99, 98), bar(103, 99)]],
    ['no fill at all', [bar(110, 101), bar(112, 102), bar(111, 104), bar(103, 95)]],
  ];

  it.each(fixtures)('reproduces the base trade exactly — %s', (_label, forward) => {
    expect(scoreArm(forward, plan, spec, base)).toEqual(scoreTrade(forward, plan, base));
  });

  it('carries no maxBars of its own, so it tracks --max-bars', () => {
    expect(spec.maxBars).toBeUndefined();
    const forward = Array.from({ length: 12 }, () => bar(103, 99, 99));
    for (const maxBars of [2, 5, 9]) {
      const cfg = { ...base, maxBars };
      expect(scoreArm(forward, plan, spec, cfg)).toEqual(scoreTrade(forward, plan, cfg));
    }
  });

  it('mirrors for a short', () => {
    const short: ScorablePlan = {
      direction: 'short',
      entries: [
        { price: 100, weightPercent: 20 },
        { price: 102, weightPercent: 40 },
        { price: 104, weightPercent: 40 },
      ],
      averageEntry: 102.4,
      stop: 107.4,
      riskPerUnit: 5,
      riskPercent: 5,
      targets: [{ price: 92.4, weightPercent: 100 }],
    };
    const forward = [bar(100, 97), bar(101, 92), bar(101, 97), bar(101, 97)];
    expect(scoreArm(forward, short, spec, base)).toEqual(scoreTrade(forward, short, base));
  });
});

describe('scoreArm — parameters', () => {
  it('scales the target DISTANCE from entry, not the price', () => {
    // 1 target at 107.6 is 10.0 from entry 97.6, so 2x sits at 117.6.
    const wide = armed({ targetScale: 2 });
    const full = [bar(103, 96), bar(117, 100), bar(103, 99), bar(103, 99)];
    expect(scoreArm(full, plan, wide, base).status).not.toBe('ALL_TARGETS');
    const over = [bar(103, 96), bar(118, 100), bar(103, 99), bar(103, 99)];
    expect(scoreArm(over, plan, wide, base).status).toBe('ALL_TARGETS');
  });

  it('charges cost against the ARM own stop, so halving it doubles the toll', () => {
    const forward = [bar(103, 96), bar(103, 99, 99), bar(103, 99, 99)];
    const a = scoreArm(forward, plan, armed({}), base);
    const d = scoreArm(forward, plan, armed({ stopScale: 0.5 }), base);
    expect(d.costR).toBeCloseTo(2 * a.costR, 10);
  });

  it('re-derives the entry leg by leg, exactly as the base path does', () => {
    // Price touches 100 and no deeper: 20% of size, not a full fill at 97.6.
    const forward = [bar(103, 99, 99), bar(103, 99, 99), bar(103, 99, 99)];
    const s = scoreArm(forward, plan, armed({}), base);
    expect(s.legsFilled).toBe(1);
    expect(s.filledFraction).toBeCloseTo(0.2, 10);
    expect(s.entryPrice).toBeCloseTo(100, 10);
  });

  it('inherits maxBars unless the spec names one', () => {
    const forward = Array.from({ length: 12 }, () => bar(103, 99, 99));
    expect(scoreArm(forward, plan, armed({}), base).barsHeld).toBe(6);
    expect(scoreArm(forward, plan, armed({ maxBars: 3 }), base).barsHeld).toBe(3);
  });
});

describe('scoreArm — trailing', () => {
  /**
   * A degenerate one-leg plan at 100, so the trail arithmetic is readable:
   * entry 100, risk 2, no targets. 1R is 2 price units throughout.
   */
  const flat: ScorablePlan = {
    direction: 'long',
    entries: [],
    averageEntry: 100,
    stop: 98,
    riskPerUnit: 2,
    riskPercent: 2,
    targets: [],
  };
  const trail = armed({ targetScale: null, breakevenAfterTarget: 0, trail: true });
  const cfg: ScoringConfig = { ...base, fillBars: 1, maxBars: 8 };

  it('books the trailed level, not the original stop and not the peak', () => {
    // Fill at 100 on bar 0. Extreme reaches 106 on bar 2, so the stop sits at
    // 104. Bar 3 dips to 99 and takes it: (104 − 100)/2 = +2R.
    const up = [bar(102, 100), bar(104, 102), bar(106, 104), bar(106, 99)];
    const s = scoreArm(up, flat, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(2, 10);
  });

  it('exits at −1R when the trail never ratcheted', () => {
    const s = scoreArm([bar(101, 97)], flat, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(-1, 10);
  });

  it('cannot ratchet its own stop out of the way within one bar', () => {
    // The bar spikes to 120 AND breaks 98. The stop is tested first.
    const s = scoreArm([bar(120, 97)], flat, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(-1, 10);
  });

  it('never loosens after a pullback', () => {
    // Extreme 110 on bar 0 -> stop 108, and bars 1-2 must not lower it.
    const s = scoreArm([bar(110, 100), bar(105, 103), bar(105, 100)], flat, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(4, 10); // (108 − 100)/2
  });

  it('marks an unstopped trail to market rather than assuming a win', () => {
    const s = scoreArm([bar(101, 100, 101)], flat, trail, cfg);
    expect(s.status).toBe('TIMEOUT');
    expect(s.grossR).toBeCloseTo(0.5, 10);
  });

  it('measures R in initial risk, not in trail units', () => {
    const up = [bar(102, 100), bar(104, 102), bar(106, 104), bar(106, 99)];
    const tight = scoreArm(up, flat, trail, cfg);
    const roomy = scoreArm(up, flat, { ...trail, trailMult: 2 }, cfg);
    // Extreme 106 with a 4-wide trail -> stop 102: (102 − 100)/2 = +1R.
    expect(roomy.grossR).toBeCloseTo(1, 10);
    expect(roomy.grossR).toBeLessThan(tight.grossR);
  });

  it('does not widen the INITIAL stop', () => {
    const s = scoreArm([bar(101, 97)], flat, { ...trail, trailMult: 4 }, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(-1, 10);
  });

  it('mirrors for a short', () => {
    const shortFlat: ScorablePlan = { ...flat, direction: 'short', stop: 102 };
    const down = [bar(100, 98), bar(98, 96), bar(96, 94), bar(101, 94)];
    const s = scoreArm(down, shortFlat, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.grossR).toBeCloseTo(2, 10);
  });

  it('is inert when no trail is configured', () => {
    const up = [bar(102, 100), bar(104, 102), bar(106, 104), bar(106, 99)];
    const noTrail = armed({ targetScale: null, breakevenAfterTarget: 0 });
    expect(scoreArm(up, flat, noTrail, cfg)).toEqual(
      scoreTrade(up, { ...flat, targets: [] }, { ...cfg, breakevenAfterTarget: 0 }),
    );
  });
});

describe('MAX_ARM_BARS', () => {
  it('is the longest hold any arm asks for, ignoring the inheriting ones', () => {
    expect(MAX_ARM_BARS).toBe(Math.max(...ARMS.map((a) => a.maxBars ?? 0)));
    expect(MAX_ARM_BARS).toBeGreaterThan(0);
  });
});

// ── the split ───────────────────────────────────────────────────────────

/**
 * The arms file's real span, as constants rather than by reading the CSV —
 * these tests must not depend on a gitignored results file. If the arms file is
 * regenerated over a different window the boundary moves with it; what is
 * asserted here is the ARITHMETIC that places it.
 */
const T0 = Date.parse('2026-05-24T09:00:00.000Z');
const T1 = Date.parse('2026-07-05T19:00:00.000Z');

const HOUR = 3_600_000;
/** One row per hour across the arms file's span. */
const series = Array.from(
  { length: Math.floor((T1 - T0) / HOUR) + 1 },
  (_, i) => ({ time: T0 + i * HOUR }),
);

describe('parseSplit', () => {
  it('throws when --split is absent — there is no default', () => {
    expect(() => parseSplit(['--stress', 'arms.csv'])).toThrow(/--split is required/);
  });

  it('throws when --split is present but has no value', () => {
    expect(() => parseSplit(['--stress', 'arms.csv', '--split'])).toThrow(
      /--split is required/,
    );
  });

  it('throws on an unknown value rather than falling back', () => {
    expect(() => parseSplit(['--split', 'both'])).toThrow(/unknown --split both/);
    expect(() => parseSplit(['--split', 'TUNE'])).toThrow(/unknown --split TUNE/);
  });

  it('accepts exactly the three modes', () => {
    expect(parseSplit(['--split', 'tune'])).toBe('tune');
    expect(parseSplit(['--split', 'holdout'])).toBe('holdout');
    expect(parseSplit(['--split', 'all'])).toBe('all');
  });

  it('reads the value wherever the flag sits in argv', () => {
    expect(parseSplit(['--stress', 'a.csv', '--split', 'tune'])).toBe('tune');
    expect(parseSplit(['--split', 'tune', '--stress', 'a.csv'])).toBe('tune');
  });
});

describe('selectSplit', () => {
  it('puts the cut at TUNE_FRACTION of the calendar span', () => {
    const sel = selectSplit(series, 'tune');
    expect(sel.cut).toBe(T0 + (T1 - T0) * TUNE_FRACTION);
    // The arms file's own boundary, to the day.
    expect(new Date(sel.cut).toISOString().slice(0, 10)).toBe('2026-06-23');
  });

  it('makes tune and holdout disjoint', () => {
    const tune = new Set(selectSplit(series, 'tune').rows.map((r) => r.time));
    const hold = selectSplit(series, 'holdout').rows.map((r) => r.time);
    expect(hold.some((t) => tune.has(t))).toBe(false);
  });

  it('makes tune ∪ holdout exactly all — no row lost, none double-counted', () => {
    const all = selectSplit(series, 'all').rows.map((r) => r.time);
    const tune = selectSplit(series, 'tune').rows.map((r) => r.time);
    const hold = selectSplit(series, 'holdout').rows.map((r) => r.time);
    expect(tune.length + hold.length).toBe(all.length);
    expect([...tune, ...hold].sort((a, b) => a - b)).toEqual(all);
  });

  it('puts a row exactly ON the cut into holdout, not tune', () => {
    // `<` vs `<=`. Stated explicitly so a future edit has to argue with a test.
    const cut = T0 + (T1 - T0) * TUNE_FRACTION;
    const rows = [{ time: T0 }, { time: cut }, { time: T1 }];
    expect(selectSplit(rows, 'tune').rows.map((r) => r.time)).toEqual([T0]);
    expect(selectSplit(rows, 'holdout').rows.map((r) => r.time)).toEqual([cut, T1]);
  });

  it('reports the selected span and the whole-file span separately', () => {
    const sel = selectSplit(series, 'tune');
    expect(sel.spanFrom).toBe(T0);
    expect(sel.spanTo).toBe(T1);
    expect(sel.from).toBe(T0);
    expect(sel.to).toBeLessThan(sel.cut);
    expect(sel.total).toBe(series.length);
  });

  it('sorts before splitting, so input order cannot change the cut', () => {
    const shuffled = [...series].reverse();
    expect(selectSplit(shuffled, 'tune').rows).toEqual(selectSplit(series, 'tune').rows);
  });

  it('refuses an empty set rather than reporting an empty split', () => {
    expect(() => selectSplit([], 'tune')).toThrow(/no rows/);
  });
});

describe('splitHeader', () => {
  it('states the split, both spans and both counts', () => {
    const h = splitHeader('T', 'arms.csv', selectSplit(series, 'tune'));
    expect(h).toContain('SPLIT    TUNE');
    expect(h).toContain('arms.csv');
    expect(h).toContain('2026-05-24');
    expect(h).toContain('2026-07-05'); // the whole file
    expect(h).toContain('2026-06-23'); // the cut
    expect(h).toContain(`${series.length} trades`);
  });

  it('warns loudly, and only, on holdout', () => {
    expect(splitHeader('T', 'a.csv', selectSplit(series, 'holdout'))).toMatch(
      /HOLDOUT\. These rows are spent/,
    );
    expect(splitHeader('T', 'a.csv', selectSplit(series, 'tune'))).not.toMatch(/spent/);
    expect(splitHeader('T', 'a.csv', selectSplit(series, 'all'))).not.toMatch(/spent/);
  });

  it('marks --split all as descriptive only', () => {
    expect(splitHeader('T', 'a.csv', selectSplit(series, 'all'))).toMatch(
      /includes the holdout rows/,
    );
  });
});

describe('netAt', () => {
  /** One CSV row, as `loadRows` shapes it. */
  const row = (over: Record<string, string>) =>
    ({
      time: 0,
      coin: 'X',
      structure: 'ranging',
      riskPercent: 2, // the BASE plan's — deliberately different from the arm's
      cells: { A_r: '1.0', A_costR: '0.07', A_status: 'ALL_TARGETS', ...over },
    }) as never;

  it('scales the ARM own stored costR, exactly and linearly', () => {
    expect(netAt(row({}), 'A', 1)).toBeCloseTo(1.0 - 0.07, 10);
    expect(netAt(row({}), 'A', 1.5)).toBeCloseTo(1.0 - 0.105, 10);
    expect(netAt(row({}), 'A', 2)).toBeCloseTo(1.0 - 0.14, 10);
  });

  it('ignores the base plan riskPercent column', () => {
    // It used to compute `roundTripPct / r.riskPercent`, which charged D_tight
    // half its real toll and ignored partial fills entirely.
    const a = netAt(row({}), 'A', 2);
    const b = netAt(row({ A_costR: '0.14' }), 'A', 2); // same riskPercent, double cost
    expect(a).not.toBeCloseTo(b, 6);
    expect(b).toBeCloseTo(1.0 - 0.28, 10);
  });

  it('charges an unresolved position its toll rather than zeroing it', () => {
    expect(netAt(row({ A_status: 'TIMEOUT' }), 'A', 1)).toBeCloseTo(0.93, 10);
  });

  it('is the stored netR at 1x', () => {
    // costR and netR in the CSV are both at 1x, so this must round-trip.
    expect(netAt(row({ A_r: '2.5', A_costR: '0.3' }), 'A', 1)).toBeCloseTo(2.2, 10);
  });
});

describe('scoreArm — a leg the trailed stop has passed', () => {
  /**
   * N1. The leg-fill-before-stop ordering is defended on the grounds that the
   * stop sits an ATR beyond the far leg, so a bar reaching the stop has traded
   * through every leg first. That holds for the base plan and NOT for a
   * trailing arm: once the trail ratchets, the stop climbs past the deeper
   * legs, and a trailing arm has no targets so `legsLive` is never cleared.
   *
   * The legs below sit at 100 / 96 / 92, so leg 3 at 92 is BELOW the initial
   * stop at 94 — a shape the base planner never emits, used here to isolate the
   * guard. 1R is 6 price units (|avgEntry 100 − stop 94|).
   */
  const laddered: ScorablePlan = {
    direction: 'long',
    entries: [
      { price: 100, weightPercent: 20 },
      { price: 96, weightPercent: 40 },
      { price: 92, weightPercent: 40 },
    ],
    averageEntry: 100,
    stop: 94,
    riskPerUnit: 6,
    riskPercent: 6,
    targets: [],
  };
  const trail = armed({ targetScale: null, breakevenAfterTarget: 0, trail: true });
  const cfg: ScoringConfig = { ...base, fillBars: 1, maxBars: 8 };

  it('does not fill a leg that is already beyond the INITIAL stop', () => {
    // trailMult 2 puts the trail 12 units back, so bar 0's high of 101 ratchets
    // to 89 and the stop STAYS at its initial 94 — isolating the guard from the
    // ratchet. Bar 1 dips to 91, passing leg 2 (96, above the stop and
    // genuinely reachable), then the stop, then leg 3 (92, beyond it).
    const forward = [bar(101, 100, 100), bar(100, 91, 91)];
    const s = scoreArm(forward, laddered, { ...trail, trailMult: 2 }, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.legsFilled).toBe(2);
    // (20·100 + 40·96) / 60 = 97.3333 — leg 3 at 92 is excluded.
    expect(s.entryPrice).toBeCloseTo(97.3333333, 6);
    // 60% of size, entry 97.3333, out at 94: 0.6 · (94 − 97.3333)/6 = −0.3333R
    expect(s.grossR).toBeCloseTo(-0.3333333, 6);
  });

  it('does not fill a leg the RATCHET has climbed past', () => {
    // Bar 0 fills leg 1 at 100. Bar 1 runs to 112, so with a 1R (6-unit) trail
    // the stop ratchets to 106 — now above legs 2 (96) and 3 (92). Bar 2 dips
    // to 95, taking the trailed stop; leg 2 must not fill on the way.
    const forward = [bar(101, 100, 100), bar(112, 105, 110), bar(110, 95, 95)];
    const s = scoreArm(forward, laddered, trail, cfg);
    expect(s.status).toBe('STOPPED');
    expect(s.legsFilled).toBe(1);
    expect(s.entryPrice).toBeCloseTo(100, 10);
    // 20% at 100, out at the trailed 106: 0.2 · (106 − 100)/6 = +0.2R
    expect(s.grossR).toBeCloseTo(0.2, 10);
  });

  it('still fills a leg the stop has NOT passed', () => {
    // The guard must not cancel a reachable leg. Bar 1 dips to 95 — above the
    // 94 stop — so leg 2 at 96 fills normally.
    const forward = [bar(101, 100, 100), bar(101, 95, 97), bar(101, 97, 97)];
    const s = scoreArm(forward, laddered, trail, cfg);
    expect(s.legsFilled).toBe(2);
    // (20·100 + 40·96) / 60 = 97.3333
    expect(s.entryPrice).toBeCloseTo(97.3333333, 6);
  });

  it('is inert on the base geometry, where the stop is beyond every leg', () => {
    // The real planner puts the stop an ATR BELOW the far leg, so no leg is
    // ever on the far side of it and the guard can never fire.
    const real: ScorablePlan = {
      ...laddered,
      entries: [
        { price: 100, weightPercent: 20 },
        { price: 98, weightPercent: 40 },
        { price: 96, weightPercent: 40 },
      ],
      averageEntry: 97.6,
      stop: 92.6,
      riskPerUnit: 5,
      riskPercent: (5 / 97.6) * 100,
    };
    const forward = [bar(103, 99), bar(100, 92), bar(103, 99), bar(103, 99)];
    const s = scoreArm(forward, real, armed({}), base);
    expect(s.legsFilled).toBe(3);
    expect(s.grossR).toBeCloseTo(-1, 10);
  });
});

describe('scoreArm — the re-analysis arms', () => {
  const spec = ARMS.find((a) => a.name === 'E_zonegone') as ArmSpec;
  const control = ARMS.find((a) => a.name === 'BASE_check') as ArmSpec;
  // Fills one leg, then drifts. Nothing resolves it, so the exit rule is the
  // only thing that can differ between the two arms.
  const forward = [bar(103, 99, 99), bar(103, 99, 99), bar(104, 100, 101), bar(103, 99, 99)];

  it('is the base arm when no signal is supplied', () => {
    // A report run against an older CSV, or any caller that does not know how
    // to build the signal, must not silently get a different exit rule.
    expect(scoreArm(forward, plan, spec, base)).toEqual(scoreArm(forward, plan, control, base));
  });

  it('differs from its control ONLY in the exit', () => {
    const withSignal = scoreArm(forward, plan, spec, base, { 'zone-gone': (i) => i === 2 });
    const without = scoreArm(forward, plan, control, base);

    // Same entry, same size, same risk — one rule apart.
    expect(withSignal.fillIndex).toBe(without.fillIndex);
    expect(withSignal.entryPrice).toBe(without.entryPrice);
    expect(withSignal.filledFraction).toBe(without.filledFraction);
    expect(withSignal.costR).toBeCloseTo(without.costR, 10);

    expect(withSignal.status).toBe('SIGNAL_EXIT');
    expect(without.status).toBe('TIMEOUT');
    expect(withSignal.barsHeld).toBeLessThan(without.barsHeld);
  });

  it('ignores a signal handed to an arm that did not ask for one', () => {
    // Only `exitOnSignal` arms listen. Otherwise adding the signal to the
    // shared call site would quietly change every other arm in the sweep.
    expect(scoreArm(forward, plan, control, base, { 'zone-gone': () => true })).toEqual(
      scoreArm(forward, plan, control, base),
    );
  });
});

describe('scoreArm — a signal only reaches the arm that named it', () => {
  const zoneGone = ARMS.find((a) => a.name === 'E_zonegone') as ArmSpec;
  const noPlan = ARMS.find((a) => a.name === 'E_noplan') as ArmSpec;
  const forward = [bar(103, 99, 99), bar(103, 99, 99), bar(104, 100, 101), bar(103, 99, 99)];

  it('reads its own signal and ignores the other', () => {
    // Both arms are otherwise identical, so if the keys were ignored these two
    // would move together and the sweep would be comparing one rule to itself.
    const only = { 'no-plan': (i: number) => i === 2 } as const;

    expect(scoreArm(forward, plan, noPlan, base, only).status).toBe('SIGNAL_EXIT');
    expect(scoreArm(forward, plan, zoneGone, base, only).status).toBe('TIMEOUT');
  });

  it('every arm that names a signal has one supplied by the harness', () => {
    // The harness builds `resignalsFor`; a spec naming a key nobody provides
    // would silently degrade to the base arm and be reported as a result.
    const supplied = ['zone-gone', 'no-plan'];
    for (const arm of ARMS) {
      if (arm.exitOnSignal) expect(supplied).toContain(arm.exitOnSignal);
    }
  });
});
