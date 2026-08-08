import {
  AnalystNarrationService,
  PriceProvenanceError,
} from './analyst-narration.service';

describe('AnalystNarrationService — price provenance', () => {
  let service: AnalystNarrationService;

  beforeAll(() => {
    // No API key needed to construct: the client is built on first use, so a
    // deployment without one still boots and serves everything but narration.
    delete process.env.ANTHROPIC_API_KEY;
    service = new AnalystNarrationService();
  });

  const allowed = [1932.49, 1917.26, 1897.32, 73.48, 64315.24];

  it('accepts a price quoted exactly', () => {
    expect(service.assertProvenance('Resistance at $1932.49 held.', allowed)).toEqual([
      1932.49,
    ]);
  });

  it('accepts thousands separators', () => {
    expect(service.assertProvenance('Zone tops at $64,315.24.', allowed)).toEqual([
      64315.24,
    ]);
  });

  it('accepts rounding at the precision used', () => {
    // "$73" is a correct 0-decimal rounding of 73.48, and readable prose needs
    // to be allowed to do that.
    expect(service.assertProvenance('SOL sits at $73.', allowed)).toEqual([73]);
    expect(service.assertProvenance('Support near $1,932.', allowed)).toEqual([1932]);
  });

  it('rejects a price that rounds to something else', () => {
    // 74 is not a rounding of 73.48 — it is a different number.
    expect(() => service.assertProvenance('SOL sits at $74.', allowed)).toThrow(
      PriceProvenanceError,
    );
  });

  it('rejects an invented level outright, not with a warning', () => {
    // The failure mode this exists for: a plausible-looking support the model
    // reasoned its way to, which nothing computed.
    let caught: PriceProvenanceError | null = null;
    try {
      service.assertProvenance('There is firmer support at $1,880.00.', allowed);
    } catch (err) {
      caught = err as PriceProvenanceError;
    }

    expect(caught).toBeInstanceOf(PriceProvenanceError);
    expect(caught?.invented).toEqual([1880]);
    expect(caught?.message).toContain('no computed source');
  });

  it('rejects a derived midpoint — deriving is not quoting', () => {
    const midpoint = (1932.49 + 1917.26) / 2; // 1924.875
    expect(() =>
      service.assertProvenance(`Midway sits at $${midpoint.toFixed(2)}.`, allowed),
    ).toThrow(PriceProvenanceError);
  });

  it('ignores percentages, R multiples and counts', () => {
    // These are Claude's own arithmetic over given values and must stay free,
    // or the check would be unusable on real prose.
    const text =
      'Risk is 1.25% of entry, the ladder blends to 1.45R across 3 sources, ' +
      'and the zone spans 0.23% — with price $1,932.49 at the near edge.';

    expect(service.assertProvenance(text, allowed)).toEqual([1932.49]);
  });

  it('reports every invented price at once, not just the first', () => {
    let caught: PriceProvenanceError | null = null;
    try {
      service.assertProvenance('Watch $1,111.11 and then $2,222.22.', allowed);
    } catch (err) {
      caught = err as PriceProvenanceError;
    }
    expect(caught?.invented).toEqual([1111.11, 2222.22]);
  });

  it('passes prose with no prices at all', () => {
    expect(
      service.assertProvenance('Structure is ranging; nothing is actionable.', allowed),
    ).toEqual([]);
  });

  it('allows describing an ungiven price in words', () => {
    // The prompt tells Claude to do exactly this instead of inventing a figure.
    const text = 'Just above the upper zone, between the two supports, price thins out.';
    expect(service.assertProvenance(text, allowed)).toEqual([]);
  });

  it('tolerates a space after the dollar sign', () => {
    expect(service.assertProvenance('Price is $ 1932.49 now.', allowed)).toEqual([
      1932.49,
    ]);
  });
});
