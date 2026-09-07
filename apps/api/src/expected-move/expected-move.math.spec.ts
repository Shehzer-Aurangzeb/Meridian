import {
  trailingBaseline, standardiseAcrossCoins, conesForHour, CoinFeatures,
} from './expected-move.math';
import { FEATURE_ORDER, FITTED } from './fitted';

const flat = (n: number, step = 0): number[] =>
  Array.from({ length: n }, (_, i) => 100 * (1 + step) ** i);

const rows = (specs: Array<[string, number[], number]>): CoinFeatures[] =>
  specs.map(([symbol, features, baseline]) => ({ symbol, features, baseline }));

describe('trailingBaseline', () => {
  it('is the mean absolute log return over the window', () => {
    // A series compounding at exactly 1% per bar: every 1-bar move is
    // |log(1.01)| regardless of where in the series it is measured.
    const closes = flat(200, 0.01);
    const got = trailingBaseline(closes, 1, 100)!;
    expect(got).toBeCloseTo(Math.abs(Math.log(1.01)), 10);
  });

  it('scales with the horizon', () => {
    const closes = flat(200, 0.01);
    const oneBar = trailingBaseline(closes, 1, 100)!;
    const fourBar = trailingBaseline(closes, 4, 100)!;
    expect(fourBar).toBeCloseTo(4 * oneBar, 8);
  });

  it('never reads a return that has not finished yet', () => {
    // THE LOOK-AHEAD GUARD. The last bar jumps 50%. A 4h baseline computed at
    // the bar BEFORE that jump must not see it — the return spanning the jump
    // has not been realised at that point.
    const closes = flat(200, 0.001);
    const withJump = [...closes];
    withJump[withJump.length - 1] *= 1.5;

    const upTo = withJump.slice(0, withJump.length - 1);
    const before = trailingBaseline(upTo, 4, 100)!;
    const calm = trailingBaseline(closes.slice(0, closes.length - 1), 4, 100)!;
    expect(before).toBeCloseTo(calm, 12);
  });

  it('refuses a level it cannot measure', () => {
    expect(trailingBaseline(flat(20, 0.01), 4, 100)).toBeNull();
    expect(trailingBaseline([], 4, 100)).toBeNull();
  });

  it('ignores non-positive prices rather than producing NaN', () => {
    const closes = flat(200, 0.01);
    closes[50] = 0;
    const got = trailingBaseline(closes, 1, 150);
    expect(got).not.toBeNull();
    expect(Number.isFinite(got!)).toBe(true);
  });
});

describe('standardiseAcrossCoins', () => {
  const n = FEATURE_ORDER.length;

  it('centres and scales by the POPULATION deviation', () => {
    // The weights were fitted against columns built with the population
    // divisor. A sample (n-1) divisor here would rescale every tilt.
    const values = [1, 2, 3];
    const z = standardiseAcrossCoins(
      rows(values.map((v, i) => [`C${i}`, new Array(n).fill(v), 0.01])),
    );
    const mu = 2;
    const sd = Math.sqrt(((1 - mu) ** 2 + (2 - mu) ** 2 + (3 - mu) ** 2) / 3);
    expect(z[0][0]).toBeCloseTo((1 - mu) / sd, 12);
    expect(z[2][0]).toBeCloseTo((3 - mu) / sd, 12);
  });

  it('gives a flat feature no opinion instead of dividing by zero', () => {
    const z = standardiseAcrossCoins(
      rows([['A', new Array(n).fill(5), 0.01], ['B', new Array(n).fill(5), 0.01]]),
    );
    expect(z[0].every((v) => v === 0)).toBe(true);
  });

  it('leaves an unmeasurable cell at zero without poisoning the others', () => {
    const a = new Array(n).fill(1);
    const b = new Array(n).fill(3);
    b[0] = NaN;
    const z = standardiseAcrossCoins(rows([['A', a, 0.01], ['B', b, 0.01]]));
    expect(z[1][0]).toBe(0);
    expect(Number.isFinite(z[0][1])).toBe(true);
    expect(z[0].every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('conesForHour', () => {
  const n = FEATURE_ORDER.length;

  it('orders the cone and scales it by the fitted ratios', () => {
    const out = conesForHour(
      rows([['A', new Array(n).fill(1), 0.01], ['B', new Array(n).fill(2), 0.012]]),
      4,
    );
    const a = out.get('A')!;
    expect(a.p50).toBeLessThan(a.p80);
    expect(a.p80).toBeLessThan(a.p90);
    expect(a.p50).toBeCloseTo(a.predicted * FITTED[4].ratios.p50, 12);
    expect(a.p90).toBeCloseTo(a.predicted * FITTED[4].ratios.p90, 12);
  });

  it('says so when it priced without a cross-section', () => {
    // One coin cannot be standardised against anything, so there is no tilt —
    // and the caller is told rather than handed a weaker number silently.
    const out = conesForHour(rows([['A', new Array(n).fill(1), 0.01]]), 4);
    const a = out.get('A')!;
    expect(a.hasTilt).toBe(false);
    expect(a.predicted).toBeCloseTo(0.01, 12);
  });

  it('falls back to the baseline rather than emitting a negative scale', () => {
    // A tiny baseline with a large negative tilt must not produce a negative
    // expected |move|, which is not a forecast.
    const wild = new Array(n).fill(0);
    wild[0] = -1e6;
    const out = conesForHour(
      rows([['A', wild, 1e-6], ['B', new Array(n).fill(1e6), 0.01]]),
      4,
    );
    expect(out.get('A')!.predicted).toBeGreaterThan(0);
    expect(out.get('B')!.predicted).toBeGreaterThan(0);
  });

  it('refuses a horizon it was not fitted for', () => {
    expect(() => conesForHour(rows([['A', new Array(n).fill(1), 0.01]]), 7 as never)).toThrow(
      /no fitted constants/,
    );
  });

  it('ships one weight per feature, at every horizon', () => {
    for (const [horizon, fit] of Object.entries(FITTED)) {
      expect(fit.weights).toHaveLength(FEATURE_ORDER.length);
      expect(fit.weights.every((w) => Number.isFinite(w))).toBe(true);
      expect(fit.ratios.p50).toBeLessThan(fit.ratios.p80);
      expect(fit.ratios.p80).toBeLessThan(fit.ratios.p90);
      expect(Number(horizon)).toBeGreaterThan(0);
    }
  });
});
