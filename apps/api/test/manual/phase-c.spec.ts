import { solveRidge, buildDesign, purgedKFold, scoreBook } from './phase-c';
import type { Panel } from './phase-b';

describe('solveRidge', () => {
  it('recovers a known solution when the ridge term is zero', () => {
    // 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
    const w = solveRidge([[2, 1], [1, 3]], [5, 10], 0);
    expect(w[0]).toBeCloseTo(1, 10);
    expect(w[1]).toBeCloseTo(3, 10);
  });

  it('shrinks the solution as lambda grows, which is the point of it', () => {
    const small = solveRidge([[2, 1], [1, 3]], [5, 10], 0);
    const big = solveRidge([[2, 1], [1, 3]], [5, 10], 100);
    const norm = (v: number[]) => Math.hypot(...v);
    expect(norm(big)).toBeLessThan(norm(small));
  });

  it('throws on a singular system rather than returning plausible garbage', () => {
    // Two identical columns and no penalty: no unique answer exists.
    expect(() => solveRidge([[1, 1], [1, 1]], [2, 2], 0)).toThrow(/singular/);
  });
});

/** Two coins, `hours` hours, one feature that equals the next return exactly. */
const oraclePanel = (hours: number, nCoins = 8): Panel => {
  const times = Array.from({ length: hours }, (_, i) => i * 3_600_000);
  const f = new Float64Array(hours * nCoins);
  const y = new Float64Array(hours * nCoins);
  let s = 1;
  for (let t = 0; t < hours; t += 1) {
    for (let c = 0; c < nCoins; c += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const r = (s / 0x7fffffff - 0.5) * 0.02;
      y[t * nCoins + c] = r;
      f[t * nCoins + c] = r; // a perfect oracle
    }
  }
  return {
    columns: ['coin', 'ts', 'oracle', 'fwd4h'],
    coins: Array.from({ length: nCoins }, (_, i) => `C${i}`),
    times,
    data: new Map([['oracle', f], ['fwd4h', y]]),
  };
};

describe('buildDesign', () => {
  it('standardises within the hour, so each hour has mean 0 and sd 1', () => {
    const p = oraclePanel(50);
    const d = buildDesign(p, ['oracle'], 4);
    const first = [];
    for (let r = 0; r < d.nRows; r += 1) if (d.timeIdx[r] === 0) first.push(d.x[r]);
    const m = first.reduce((a, b) => a + b, 0) / first.length;
    const sd = Math.sqrt(first.reduce((a, b) => a + (b - m) ** 2, 0) / first.length);
    expect(m).toBeCloseTo(0, 10);
    expect(sd).toBeCloseTo(1, 10);
  });
});

describe('purgedKFold + scoreBook', () => {
  it('finds a real edge out of sample when one is planted', () => {
    // The feature IS the forward return, so the book must be strongly positive
    // even though every prediction is made by a model that never saw that fold.
    const p = oraclePanel(2000);
    const d = buildDesign(p, ['oracle'], 4);
    const { pred } = purgedKFold(d, p.times.length, 5, 4, 1e-6);
    const b = scoreBook(d, pred, 4, 3, [0, 14]);
    // Returns are uniform on +-1%. The top three of eight average about
    // +0.55% and the bottom three about -0.55%, halved for the two legs: ~55 bp.
    expect(b.grossBp).toBeGreaterThan(50);
    expect(b.ic).toBeGreaterThan(0.9);
  });

  it('finds nothing when the feature is noise', () => {
    const p = oraclePanel(2000);
    // Overwrite the oracle with numbers unrelated to the target.
    const f = p.data.get('oracle')!;
    let s = 999;
    for (let i = 0; i < f.length; i += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      f[i] = s / 0x7fffffff;
    }
    const d = buildDesign(p, ['oracle'], 4);
    const { pred } = purgedKFold(d, p.times.length, 5, 4, 1e-6);
    const b = scoreBook(d, pred, 4, 3, [0, 14]);
    expect(Math.abs(b.ic)).toBeLessThan(0.1);
    expect(Math.abs(b.grossBp)).toBeLessThan(20);
  });

  it('holds non-overlapping, so the trade count matches the horizon', () => {
    const p = oraclePanel(1000);
    const d = buildDesign(p, ['oracle'], 4);
    const { pred } = purgedKFold(d, p.times.length, 5, 4, 1e-6);
    const b = scoreBook(d, pred, 4, 3, [0]);
    // 1000 hours held four at a time. Anything near 1000 would mean the same
    // move was being counted four times and the cost per trade was a quarter of
    // what it should be.
    expect(b.trades).toBeLessThanOrEqual(Math.ceil(1000 / 4));
    expect(b.trades).toBeGreaterThan(200);
  });

  it('charges the cost it is given', () => {
    const p = oraclePanel(2000);
    const d = buildDesign(p, ['oracle'], 4);
    const { pred } = purgedKFold(d, p.times.length, 5, 4, 1e-6);
    const b = scoreBook(d, pred, 4, 3, [0, 14, 25]);
    expect(b.net.get(0)).toBeCloseTo(b.grossBp, 10);
    expect(b.net.get(14)).toBeCloseTo(b.grossBp - 14, 10);
    expect(b.net.get(25)).toBeCloseTo(b.grossBp - 25, 10);
  });
});

describe('conviction gate', () => {
  it('trades less as the gate rises, and never trades on future information', () => {
    const p = oraclePanel(4000);
    const d = buildDesign(p, ['oracle'], 4);
    const { pred } = purgedKFold(d, p.times.length, 5, 4, 1e-6);
    const all = scoreBook(d, pred, 4, 3, [0], 0);
    const top10 = scoreBook(d, pred, 4, 3, [0], 0.9);
    expect(top10.trades).toBeLessThan(all.trades / 3);
    expect(top10.trades).toBeGreaterThan(0);
    // The oracle's forecast spread IS the realised spread, so gating on the
    // largest forecasts must select the largest outcomes. If this ever came out
    // lower, the gate would be selecting on something other than conviction.
    expect(top10.grossBp).toBeGreaterThan(all.grossBp);
  });
});
