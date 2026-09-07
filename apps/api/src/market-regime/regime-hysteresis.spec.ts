import { classifyWithHysteresis, REGIME_HYSTERESIS, percentileRank } from './regime-hysteresis';

/** A band-width history where `value` lands on a chosen percentile. */
const historyForPercentile = (target: number): number[] =>
  Array.from({ length: 100 }, (_, i) => (i < target ? 0.5 : 1.5));

describe('regime hysteresis', () => {
  const wide = historyForPercentile(50); // band width 1.0 sits at the 50th

  it('enters TRENDING only above the entry threshold, not the exit one', () => {
    // 25 used to be the line. It is now inside the dead band, so from a
    // non-trending state it must NOT produce TRENDING.
    expect(classifyWithHysteresis(1.0, 25, wide, 'MEAN_REVERSION').regime).toBe('MEAN_REVERSION');
    expect(classifyWithHysteresis(1.0, 26.9, wide, 'MEAN_REVERSION').regime).toBe('MEAN_REVERSION');
    expect(classifyWithHysteresis(1.0, 27.1, wide, 'MEAN_REVERSION').regime).toBe('TRENDING');
  });

  it('holds TRENDING through the dead band, and releases below the exit', () => {
    // THE POINT OF THE WHOLE FILE. Measured on the panel, 73.8% of
    // TRENDING<->MEAN_REVERSION flips happened with ADX within 1.0 of 25, which
    // is chatter rather than a state change.
    expect(classifyWithHysteresis(1.0, 24, wide, 'TRENDING').regime).toBe('TRENDING');
    expect(classifyWithHysteresis(1.0, 23.1, wide, 'TRENDING').regime).toBe('TRENDING');
    expect(classifyWithHysteresis(1.0, 23, wide, 'TRENDING').regime).toBe('MEAN_REVERSION');
    expect(classifyWithHysteresis(1.0, 22.9, wide, 'TRENDING').regime).toBe('MEAN_REVERSION');
  });

  it('flags a label that only survived because of the dead band', () => {
    const held = classifyWithHysteresis(1.0, 24, wide, 'TRENDING');
    expect(held.heldByHysteresis).toBe(true);
    expect(held.reason).toContain('hysteresis');

    const fresh = classifyWithHysteresis(1.0, 30, wide, 'TRENDING');
    expect(fresh.heldByHysteresis).toBe(false);
  });

  it('applies the same dead band to compression', () => {
    // The ADX band alone leaves median duration at 11h; the compression
    // boundary is its own chatter source and needs its own band.
    const at18 = historyForPercentile(18); // band width 1.0 sits at the 18th
    expect(classifyWithHysteresis(1.0, 10, at18, 'MEAN_REVERSION').regime).toBe('MEAN_REVERSION');
    expect(classifyWithHysteresis(1.0, 10, at18, 'COMPRESSION').regime).toBe('COMPRESSION');

    const at22 = historyForPercentile(22);
    expect(classifyWithHysteresis(1.0, 10, at22, 'COMPRESSION').regime).not.toBe('COMPRESSION');
  });

  it('compression outranks trend, whichever way the band is crossed', () => {
    const at10 = historyForPercentile(10);
    expect(classifyWithHysteresis(1.0, 40, at10, 'TRENDING').regime).toBe('COMPRESSION');
  });

  it('with no previous label, uses the entry thresholds', () => {
    // First bar of a series: nothing to hold, so no dead band.
    expect(classifyWithHysteresis(1.0, 26, wide, null).regime).toBe('MEAN_REVERSION');
    expect(classifyWithHysteresis(1.0, 28, wide, null).regime).toBe('TRENDING');
  });

  it('percentileRank counts readings at or below the value', () => {
    expect(percentileRank(1.0, [0.5, 1.0, 1.5, 2.0])).toBe(50);
    expect(percentileRank(0.1, [0.5, 1.0])).toBe(0);
    expect(percentileRank(9, [0.5, 1.0])).toBe(100);
    expect(percentileRank(1, [])).toBe(0);
  });

  it('keeps the dead bands ordered, or the state machine has no rest state', () => {
    // If exit ever rose above entry, a label could satisfy neither condition
    // and the classifier would oscillate by construction.
    expect(REGIME_HYSTERESIS.adxExit).toBeLessThan(REGIME_HYSTERESIS.adxEnter);
    expect(REGIME_HYSTERESIS.compressionEnterPct).toBeLessThan(REGIME_HYSTERESIS.compressionExitPct);
  });
});
