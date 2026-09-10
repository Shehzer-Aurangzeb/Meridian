import { normaliseRows } from './sim.parse';

const WANTED = ['BTC', 'ETH', 'SOL'];

const row = (over: Record<string, unknown> = {}) => ({
  symbol: 'BTC',
  verdict: 'TAKE',
  direction: 'long',
  entry: 84120,
  stop: 82400,
  targets: [{ price: 87000, weightPercent: 100 }],
  rationale: 'reclaimed the shelf',
  planDespiteSkip: false,
  ...over,
});

describe('normaliseRows', () => {
  it('keeps a stated plan', () => {
    const { rows } = normaliseRows({ rows: [row()] }, WANTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: 'BTC',
      verdict: 'TAKE',
      direction: 'long',
      entry: 84120,
      stop: 82400,
    });
  });

  it('keeps the plan AND the SKIP when the analyst passed but planned anyway', () => {
    const { rows } = normaliseRows(
      { rows: [row({ verdict: 'SKIP', planDespiteSkip: false })] },
      WANTED,
    );
    // The verdict is the analyst's answer and is never upgraded to TAKE: the
    // journal's only comparison is taken-versus-passed, and moving a row
    // between arms is editing the result rather than recording it.
    expect(rows[0].verdict).toBe('SKIP');
    expect(rows[0].entry).toBe(84120);
    expect(rows[0].targets).toHaveLength(1);
    // Recomputed from the fields, not taken from the model's own claim.
    expect(rows[0].planDespiteSkip).toBe(true);
  });

  it('does not flag a SKIP that carries no plan', () => {
    const { rows } = normaliseRows(
      {
        rows: [
          row({
            verdict: 'SKIP',
            entry: null,
            stop: null,
            targets: [],
            planDespiteSkip: true,
          }),
        ],
      },
      WANTED,
    );
    expect(rows[0].planDespiteSkip).toBe(false);
  });

  it('passes a missing field through as null rather than inventing one', () => {
    const { rows } = normaliseRows(
      { rows: [row({ entry: null, stop: null, rationale: '  ' })] },
      WANTED,
    );
    expect(rows[0].entry).toBeNull();
    expect(rows[0].stop).toBeNull();
    expect(rows[0].rationale).toBeNull();
  });

  it('rejects non-finite numbers the schema would still allow', () => {
    const { rows } = normaliseRows(
      { rows: [row({ entry: Number.NaN, stop: Number.POSITIVE_INFINITY })] },
      WANTED,
    );
    expect(rows[0].entry).toBeNull();
    expect(rows[0].stop).toBeNull();
  });

  it('keeps a target price whose weight was never given', () => {
    const { rows } = normaliseRows(
      { rows: [row({ targets: [{ price: 87000, weightPercent: null }] })] },
      WANTED,
    );
    // Not defaulted to 100 and not split evenly: an unstated weight changes
    // what the trade scores, so a person supplies it.
    expect(rows[0].targets).toEqual([{ price: 87000, weightPercent: null }]);
  });

  it('normalises the ticker and drops a coin nobody asked about', () => {
    const { rows, missing } = normaliseRows(
      { rows: [row({ symbol: 'ethusdt' }), row({ symbol: 'DOGE' })] },
      WANTED,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['ETH']);
    expect(missing).toEqual(['BTC', 'SOL']);
  });

  it('survives a malformed payload without throwing', () => {
    expect(normaliseRows(null, WANTED).rows).toEqual([]);
    expect(normaliseRows({ rows: 'nope' }, WANTED).rows).toEqual([]);
    expect(normaliseRows({ rows: [null, 7, {}] }, WANTED).rows).toEqual([]);
    expect(normaliseRows(null, WANTED).missing).toEqual(WANTED);
  });

  it('reports an unusable verdict or direction as null instead of picking one', () => {
    const { rows } = normaliseRows(
      { rows: [row({ verdict: 'MAYBE', direction: 'sideways' })] },
      WANTED,
    );
    expect(rows[0].verdict).toBeNull();
    expect(rows[0].direction).toBeNull();
  });
});
