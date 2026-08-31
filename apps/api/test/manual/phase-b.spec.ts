import { rank, spearman, neweyWestSe, blockBootstrapMean, normalCdf, mean, rankPersistence } from './phase-b';

describe('rank', () => {
  it('averages tied ranks, which is what makes it Spearman', () => {
    expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(rank([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe('spearman', () => {
  it('is +1 on a monotone increase and -1 on a monotone decrease', () => {
    const a = [1, 2, 3, 4, 5];
    expect(spearman(a, [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
    expect(spearman(a, [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it('ranks, so a monotone but non-linear map still scores +1', () => {
    // The reason this is Spearman and not Pearson: the shape of the
    // relationship is not the question, only its order.
    expect(spearman([1, 2, 3, 4], [1, 4, 900, 1e9])).toBeCloseTo(1, 10);
  });

  it('is NaN, not zero, when a side is constant', () => {
    // A flat feature has no ordering to correlate. Reporting 0 would put it in
    // the results table as a measured null instead of an unmeasurable one.
    expect(Number.isNaN(spearman([1, 2, 3], [7, 7, 7]))).toBe(true);
  });

  it('matches a hand-computed value with ties on both sides', () => {
    // ranks a: 1, 2.5, 2.5, 4   ranks b: 2, 2, 4, 2... deliberately awkward.
    const got = spearman([1, 2, 2, 3], [5, 5, 9, 5]);
    // Centred ranks: a = [-1.5, 0, 0, 1.5], b = [-0.75, -0.75, 1.5, -0.75]
    // num = 1.125 + 0 + 0 - 1.125 = ... computed explicitly below.
    const ra = [1, 2.5, 2.5, 4].map((x) => x - 2.5);
    const rb = [2, 2, 4, 2].map((x) => x - 2.5);
    const dot = ra.reduce((s, x, i) => s + x * rb[i], 0);
    const na = Math.sqrt(ra.reduce((s, x) => s + x * x, 0));
    const nb = Math.sqrt(rb.reduce((s, x) => s + x * x, 0));
    expect(got).toBeCloseTo(dot / (na * nb), 10);
  });
});

describe('neweyWestSe', () => {
  it('reduces to sd/sqrt(n) at lag 0', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const m = mean(xs);
    const pop = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
    expect(neweyWestSe(xs, 0)).toBeCloseTo(pop / Math.sqrt(xs.length), 10);
  });

  it('is LARGER than the naive error on a positively autocorrelated series', () => {
    // This is the entire reason the file uses it. A 24h forward return sampled
    // hourly repeats itself, and the naive error treats each repeat as news.
    const xs: number[] = [];
    let v = 0;
    let s = 1;
    for (let i = 0; i < 400; i += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      v = 0.9 * v + (s / 0x7fffffff - 0.5); // strongly persistent
      xs.push(v);
    }
    expect(neweyWestSe(xs, 24)).toBeGreaterThan(neweyWestSe(xs, 0) * 1.5);
  });
});

describe('blockBootstrapMean', () => {
  it('brackets the mean of a plainly positive series', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      time: i * 3_600_000,
      value: 1 + Math.sin(i) * 0.05,
    }));
    const got = blockBootstrapMean(rows, 5, 500, 7);
    expect(got.lo).toBeLessThan(1.01);
    expect(got.hi).toBeGreaterThan(0.99);
    expect(got.blocks).toBeGreaterThan(4);
  });

  it('straddles zero on a series with no mean', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      time: i * 3_600_000,
      value: i % 2 === 0 ? 1 : -1,
    }));
    const got = blockBootstrapMean(rows, 5, 500, 7);
    expect(got.lo).toBeLessThanOrEqual(0);
    expect(got.hi).toBeGreaterThanOrEqual(0);
  });

  it('is reproducible from its seed', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ time: i * 3_600_000, value: i % 7 }));
    expect(blockBootstrapMean(rows, 3, 200, 42)).toEqual(blockBootstrapMean(rows, 3, 200, 42));
  });
});

describe('normalCdf', () => {
  it('gives the tail the pre-registration quotes', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(2 * (1 - normalCdf(3))).toBeCloseTo(0.0026998, 6);
    expect(2 * (1 - normalCdf(2))).toBeCloseTo(0.0455003, 6);
  });
});

describe('rankPersistence', () => {
  // Built by hand rather than read from the panel, so the test states the
  // property instead of restating whatever the data happened to do.
  const panelOf = (values: number[][], hours: number): import('./phase-b').Panel => ({
    columns: ['coin', 'ts', 'f'],
    coins: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    times: Array.from({ length: hours }, (_, i) => i * 3_600_000),
    data: new Map([['f', Float64Array.from(values.flat())]]),
  });

  it('is ~1 for a feature whose ordering never changes', () => {
    // Every hour, the same eight numbers in the same order. This is a coin
    // label wearing a feature's name, and it is exactly what raw openInterest
    // turned out to be.
    const hours = 100;
    const rows = Array.from({ length: hours }, () => [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rankPersistence(panelOf(rows, hours), 'f', 24)).toBeCloseTo(1, 6);
  });

  it('is ~0 for a feature that reshuffles', () => {
    const hours = 400;
    let s = 1;
    const rows = Array.from({ length: hours }, () =>
      Array.from({ length: 8 }, () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      }),
    );
    expect(Math.abs(rankPersistence(panelOf(rows, hours), 'f', 24))).toBeLessThan(0.3);
  });
});
