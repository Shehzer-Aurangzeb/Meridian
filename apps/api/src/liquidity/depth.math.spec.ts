import {
  shellForDistance, percentileOf, buildProfile, MAX_SHELL_PERCENT,
} from './depth.math';

describe('shellForDistance', () => {
  it('maps a distance to the band that contains it', () => {
    // Shells are incremental: shell 3 is (2%, 3%], so 2.3% belongs to 3.
    expect(shellForDistance(0.5)).toBe(1);
    expect(shellForDistance(1)).toBe(1);
    expect(shellForDistance(1.01)).toBe(2);
    expect(shellForDistance(2.3)).toBe(3);
    expect(shellForDistance(5)).toBe(5);
  });

  it('is sign-blind, because a shell is a distance not a direction', () => {
    expect(shellForDistance(-2.3)).toBe(3);
    expect(shellForDistance(2.3)).toBe(3);
  });

  it('REFUSES anything past the archive, rather than extrapolating', () => {
    // The published world ends at +-5%. A 10% question is unanswerable from
    // this data, and returning shell 5 would answer it wrongly and silently.
    expect(shellForDistance(5.01)).toBeNull();
    expect(shellForDistance(10)).toBeNull();
    expect(shellForDistance(-7)).toBeNull();
  });

  it('has no shell for price sitting exactly at mid', () => {
    // Rounding zero into shell 1 would attribute the whole first band to a
    // level that is not inside it.
    expect(shellForDistance(0)).toBeNull();
  });

  it('returns null for an unmeasurable distance instead of NaN', () => {
    expect(shellForDistance(NaN)).toBeNull();
    expect(shellForDistance(Infinity)).toBeNull();
  });
});

describe('percentileOf', () => {
  it('counts history at or below the value', () => {
    expect(percentileOf(1.0, [0.5, 1.0, 1.5, 2.0])).toBe(50);
    expect(percentileOf(0.1, [0.5, 1.0])).toBe(0);
    expect(percentileOf(9, [0.5, 1.0])).toBe(100);
  });

  it('is zero with no history, not NaN', () => {
    expect(percentileOf(1, [])).toBe(0);
  });
});

describe('buildProfile', () => {
  const current = [
    { shell: 1, bidNotional: 10, askNotional: 10 },
    { shell: 2, bidNotional: 20, askNotional: 30 },
  ];
  const history = new Map([
    [1, { bid: [5, 10, 15, 20], ask: [5, 10, 15, 20] }],
    [2, { bid: [100, 200, 300, 400], ask: [1, 2, 3, 4] }],
  ]);

  it('scores each shell against its OWN history, not against dollars', () => {
    // Shell 2 holds twice the notional of shell 1 and is far thinner for
    // itself. Absolute size would report the opposite.
    const p = buildProfile('BTC', new Date(0), current, history);
    expect(p.shells[0].bidPercentile).toBe(50);
    expect(p.shells[1].bidPercentile).toBe(0);
    expect(p.shells[1].askPercentile).toBe(100);
  });

  it('computes imbalance over the whole book', () => {
    const p = buildProfile('BTC', new Date(0), current, history);
    expect(p.imbalance).toBeCloseTo(30 / 70, 10);
  });

  it('reports null imbalance on an empty book rather than 0/0', () => {
    const p = buildProfile('BTC', new Date(0), [{ shell: 1, bidNotional: 0, askNotional: 0 }], history);
    expect(p.imbalance).toBeNull();
  });

  it('drops shells outside the published range', () => {
    const p = buildProfile(
      'BTC',
      new Date(0),
      [...current, { shell: 9, bidNotional: 1e9, askNotional: 1e9 }],
      history,
    );
    expect(p.shells.map((s) => s.shell)).toEqual([1, 2]);
  });

  it('states its coverage, so a silence is never read as emptiness', () => {
    const p = buildProfile('BTC', new Date(0), current, history);
    expect(p.coverage).toContain(`${MAX_SHELL_PERCENT}%`);
  });

  it('handles a shell with no history without inventing a percentile', () => {
    const p = buildProfile('BTC', new Date(0), [{ shell: 4, bidNotional: 7, askNotional: 7 }], new Map());
    expect(p.shells[0].bidPercentile).toBe(0);
  });
});
