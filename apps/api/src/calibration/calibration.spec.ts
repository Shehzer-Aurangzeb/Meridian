import {
  reliability, fitTable, lookup, coverage, MIN_SAMPLE_FOR_PROBABILITY,
} from './calibration';

const pairs = (spec: Array<[number, 0 | 1, number]>) =>
  spec.flatMap(([predicted, outcome, count]) =>
    Array.from({ length: count }, () => ({ predicted, outcome })),
  );

describe('reliability', () => {
  it('is near zero ECE for a perfectly calibrated forecaster', () => {
    // Says 30%, is right 30% of the time. Says 70%, right 70%.
    const rel = reliability([
      ...pairs([[0.3, 1, 30], [0.3, 0, 70]]),
      ...pairs([[0.7, 1, 70], [0.7, 0, 30]]),
    ]);
    expect(rel.ece * 100).toBeLessThan(0.5);
  });

  it('catches a confident liar', () => {
    // Says 90%, is right 10% of the time.
    const rel = reliability(pairs([[0.9, 1, 10], [0.9, 0, 90]]));
    expect(rel.ece * 100).toBeGreaterThan(70);
  });

  it('gives the base-rate-only forecaster a perfect ECE and no Brier edge', () => {
    // THE POINT OF SCORING BRIER AT ALL. This model is perfectly calibrated
    // and completely useless, and ECE alone cannot tell it apart from one that
    // knows something.
    const rel = reliability(pairs([[0.4, 1, 40], [0.4, 0, 60]]));
    expect(rel.ece * 100).toBeLessThan(0.5);
    expect(rel.brier).toBeCloseTo(rel.brierBaseRate, 10);
  });

  it('gives an informative forecaster a Brier better than the base rate', () => {
    const rel = reliability([
      ...pairs([[0.9, 1, 90], [0.9, 0, 10]]),
      ...pairs([[0.1, 1, 10], [0.1, 0, 90]]),
    ]);
    expect(rel.brier).toBeLessThan(rel.brierBaseRate);
    expect(rel.ece * 100).toBeLessThan(1);
  });

  it('buckets by fixed width so a model that never commits is visible', () => {
    // Every forecast crammed into one bin. Equal-count bins would spread these
    // across ten tidy buckets and hide that the model never says anything.
    const rel = reliability(pairs([[0.51, 1, 50], [0.52, 0, 50]]));
    expect(rel.buckets).toHaveLength(1);
    expect(rel.buckets[0].n).toBe(100);
  });

  it('puts a forecast of exactly 1.0 in the top bucket rather than dropping it', () => {
    const rel = reliability(pairs([[1, 1, 10]]));
    expect(rel.n).toBe(10);
    expect(rel.buckets.reduce((s, b) => s + b.n, 0)).toBe(10);
  });
});

describe('fitTable and lookup', () => {
  const many = (key: string, hits: number, misses: number) => [
    ...Array.from({ length: hits }, () => ({ key, outcome: 1 as const })),
    ...Array.from({ length: misses }, () => ({ key, outcome: 0 as const })),
  ];

  it('refuses to quote a bucket thinner than the minimum', () => {
    // Effective n runs one to two orders below raw n here, so a bucket of 199
    // is not 199 independent facts.
    const table = fitTable('t', many('thin', 100, 99), 0);
    expect(table.rows[0].n).toBe(199);
    expect(table.rows[0].probability).toBeNull();
    expect(table.rows[0].ci95).toBeNull();
  });

  it('quotes a bucket at the minimum', () => {
    const table = fitTable('t', many('ok', 140, 60), 0);
    expect(table.rows[0].n).toBe(MIN_SAMPLE_FOR_PROBABILITY);
    expect(table.rows[0].probability).toBeCloseTo(0.7, 10);
  });

  it('falls back to the base rate for a thin or unseen key, and says so', () => {
    const table = fitTable('t', [...many('fat', 300, 100), ...many('thin', 5, 5)], 0);

    const fat = lookup(table, 'fat');
    expect(fat.isBaseRate).toBe(false);
    expect(fat.probability).toBeCloseTo(0.75, 10);

    const thin = lookup(table, 'thin');
    expect(thin.isBaseRate).toBe(true);
    expect(thin.probability).toBeCloseTo(table.baseRate, 10);

    const unseen = lookup(table, 'never-seen');
    expect(unseen.isBaseRate).toBe(true);
  });

  it('carries the unresolved share, so a rate is never published alone', () => {
    const table = fitTable('t', many('k', 200, 200), 0.42);
    expect(table.unresolvedShare).toBeCloseTo(0.42, 10);
  });
});

describe('coverage', () => {
  it('counts outcomes at or inside the bound', () => {
    expect(
      coverage([
        { bound: 10, actual: 5 },
        { bound: 10, actual: 10 },
        { bound: 10, actual: 11 },
        { bound: 10, actual: 50 },
      ]),
    ).toBeCloseTo(0.5, 10);
  });

  it('is NaN with nothing to measure, not silently zero', () => {
    expect(Number.isNaN(coverage([]))).toBe(true);
  });
});
