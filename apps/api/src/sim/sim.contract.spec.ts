/**
 * Phase 2's bars — the API contract.
 *
 * Each one encodes a promise, and each corresponds to a way this project has
 * previously been wrong:
 *
 *   a row that cannot be scored     "waiting" and "broken" both read as
 *   is rejected, not stored          netR: null, and they are not the same
 *   weights must sum to 100          selling 140% of a position produces an
 *                                    R-multiple that looks like skill
 *   unresolved carries no number     scoring open trades as zero turned
 *                                    -0.202R into -0.106R in section 14h
 *   under four blocks, no interval   one 14-day block once carried a whole
 *                                    "result" and its interval was a point
 */
import { BadRequestException } from '@nestjs/common';
import { validateBatch, validateTrade } from './sim.dto';
import { simStats, StatRow, MIN_BLOCKS, BLOCK_DAYS } from './sim.stats';

const DAY = 86_400_000;
const T0 = Date.parse('2026-06-01T00:00:00Z');

const good = (over: Record<string, unknown> = {}) => ({
  symbol: 'BTC',
  verdict: 'TAKE',
  direction: 'long',
  entry: 100,
  stop: 98,
  targets: [{ price: 110, weightPercent: 100 }],
  mapSnapshot: { symbol: 'BTC' },
  spotAtDecision: 101,
  ...over,
});

describe('contract: a row that could never be scored is rejected, not stored', () => {
  it('accepts a well-formed call', () => {
    expect(validateTrade(good(), 0).symbol).toBe('BTC');
  });

  it.each([
    ['no entry', { entry: undefined }],
    ['a zero entry', { entry: 0 }],
    ['a stop equal to the entry', { stop: 100 }],
    ['an unknown verdict', { verdict: 'MAYBE' }],
    ['an unknown direction', { direction: 'sideways' }],
    ['no map snapshot', { mapSnapshot: undefined }],
    ['no spot', { spotAtDecision: undefined }],
    ['a bad symbol', { symbol: 'not a coin' }],
    ['a non-ISO decidedAt', { decidedAt: 'yesterday' }],
  ])('refuses %s', (_name, over) => {
    expect(() => validateTrade(good(over), 0)).toThrow(BadRequestException);
  });

  it('refuses a SKIP without a plan, because a pass must be scoreable too', () => {
    // Variant A: both arms carry plans. Without one the take-versus-pass
    // comparison has a single arm and measures nothing.
    expect(() => validateTrade(good({ verdict: 'SKIP', entry: undefined }), 0)).toThrow(
      BadRequestException,
    );
    expect(validateTrade(good({ verdict: 'SKIP' }), 0).verdict).toBe('SKIP');
  });

  it('refuses a stop on the wrong side of the entry', () => {
    expect(() => validateTrade(good({ direction: 'long', stop: 105 }), 0)).toThrow(
      /below its entry/,
    );
    expect(() => validateTrade(good({ direction: 'short', stop: 95, targets: [] }), 0)).toThrow(
      /above its entry/,
    );
  });

  it('refuses a target on the wrong side of the entry', () => {
    expect(() =>
      validateTrade(good({ targets: [{ price: 90, weightPercent: 100 }] }), 0),
    ).toThrow(/above its entry/);
  });

  it('names the row so a ten-coin batch says which one failed', () => {
    expect(() => validateTrade(good({ entry: 0 }), 7)).toThrow(/trades\[7\]/);
  });
});

describe('contract: target weights sum to 100', () => {
  it.each([
    ['under', [{ price: 110, weightPercent: 60 }]],
    ['over', [{ price: 110, weightPercent: 60 }, { price: 120, weightPercent: 80 }]],
  ])('refuses weights that sum %s', (_name, targets) => {
    expect(() => validateTrade(good({ targets }), 0)).toThrow(/sum to/);
  });

  it('accepts a split that adds up', () => {
    const got = validateTrade(
      good({ targets: [{ price: 110, weightPercent: 40 }, { price: 120, weightPercent: 60 }] }),
      0,
    );
    expect(got.targets).toHaveLength(2);
  });

  it('accepts no targets at all', () => {
    // Can only stop out or expire. A poor plan, but a real one, and refusing it
    // would edit the analyst's answer.
    expect(validateTrade(good({ targets: [] }), 0).targets).toEqual([]);
  });
});

describe('contract: the batch itself', () => {
  it('refuses an empty batch', () => {
    expect(() => validateBatch({ trades: [] })).toThrow(BadRequestException);
  });

  it('refuses a body that is not a batch', () => {
    expect(() => validateBatch(good())).toThrow(BadRequestException);
  });

  it('accepts the ten-coin batch this journal is designed around', () => {
    const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC'];
    const trades = coins.map((symbol, i) =>
      good({ symbol, verdict: i < 3 ? 'TAKE' : 'SKIP' }),
    );
    expect(validateBatch({ trades })).toHaveLength(10);
  });
});

describe('contract: unresolved rows carry no number and are never totalled', () => {
  const row = (over: Partial<StatRow> = {}): StatRow => ({
    verdict: 'TAKE',
    netR: 1,
    outcome: 'ALL_TARGETS',
    decidedAt: new Date(T0),
    batchId: 'b1',
    ...over,
  });

  it('counts an open trade as pending, not as a zero', () => {
    const got = simStats([
      row({ outcome: 'ALL_TARGETS', netR: 1 }),
      row({ outcome: 'OPEN', netR: null }),
      row({ outcome: 'PENDING', netR: null }),
    ]);
    expect(got.trades).toBe(3);
    expect(got.resolved).toBe(1);
    expect(got.pending).toBe(2);
    // The mean is over the resolved row alone. Were the open rows folded in as
    // zeros it would read 0.333.
    expect(got.take.netR).toBeCloseTo(1, 10);
  });

  it('reports a null arm rather than a mean of nothing', () => {
    const got = simStats([row({ outcome: 'OPEN', netR: null })]);
    expect(got.take.netR).toBeNull();
    expect(got.delta).toBeNull();
    expect(got.warning).toMatch(/Both arms/);
  });
});

describe('contract: below four blocks the interval is not drawn', () => {
  const spread = (verdict: string, count: number, days: number, value: number): StatRow[] =>
    Array.from({ length: count }, (_, i) => ({
      verdict,
      netR: value,
      outcome: 'ALL_TARGETS',
      decidedAt: new Date(T0 + i * days * DAY),
      batchId: `batch-${i}`,
    }));

  it('withholds the delta when everything sits in one block', () => {
    // Twenty resolved trades inside a fortnight. Plenty of n, one block, and n
    // is not the quantity that decides this.
    const rows = [...spread('TAKE', 10, 1, 0.5), ...spread('SKIP', 10, 1, -0.5)];
    const got = simStats(rows);
    expect(got.resolved).toBe(20);
    expect(got.delta).toBeNull();
    expect(got.warning).toMatch(new RegExp(`${MIN_BLOCKS} time blocks`));
  });

  it('draws it once the trades span enough blocks', () => {
    const rows = [
      ...spread('TAKE', 8, BLOCK_DAYS + 1, 0.5),
      ...spread('SKIP', 8, BLOCK_DAYS + 1, -0.5),
    ];
    const got = simStats(rows);
    expect(got.delta).not.toBeNull();
    expect(got.delta?.blocks).toBeGreaterThanOrEqual(MIN_BLOCKS);
  });

  it('recovers a planted delta', () => {
    // The technique that validated `backtest-plans.ts`: four plants recovered to
    // the digit. A readout that cannot find a known edge cannot be trusted to
    // report an unknown one.
    const rows = [
      ...spread('TAKE', 12, BLOCK_DAYS + 1, 0.8),
      ...spread('SKIP', 12, BLOCK_DAYS + 1, 0.2),
    ];
    const got = simStats(rows);
    expect(got.delta?.point).toBeCloseTo(0.6, 10);
  });

  it('gives one interval on the difference, not two intervals subtracted', () => {
    // Both arms move together inside a block, so a paired interval is NARROWER
    // than the arms' own spreads imply. Subtracting two independent intervals
    // would produce something wider than this, and that defect has shipped here
    // before.
    const takeValues = [2, -1, 2, -1, 2, -1, 2, -1];
    const skipValues = [1, -2, 1, -2, 1, -2, 1, -2];
    const rows: StatRow[] = [];
    takeValues.forEach((v, i) =>
      rows.push({
        verdict: 'TAKE',
        netR: v,
        outcome: 'ALL_TARGETS',
        decidedAt: new Date(T0 + i * (BLOCK_DAYS + 1) * DAY),
        batchId: `b${i}`,
      }),
    );
    skipValues.forEach((v, i) =>
      rows.push({
        verdict: 'SKIP',
        netR: v,
        outcome: 'ALL_TARGETS',
        decidedAt: new Date(T0 + i * (BLOCK_DAYS + 1) * DAY),
        batchId: `b${i}`,
      }),
    );

    const got = simStats(rows);
    // Every block has the two arms exactly 1.0 apart, so however the blocks are
    // resampled the difference is 1.0. A paired bootstrap sees that; two
    // independent intervals subtracted would report a wide band around it.
    expect(got.delta?.point).toBeCloseTo(1, 10);
    expect(got.delta?.hi as number).toBeCloseTo(1, 6);
    expect(got.delta?.lo as number).toBeCloseTo(1, 6);
  });

  it('counts batches, and says so beside the trade count', () => {
    const rows = [
      ...spread('TAKE', 6, BLOCK_DAYS + 1, 0.5),
      ...spread('SKIP', 6, BLOCK_DAYS + 1, -0.5),
    ];
    const got = simStats(rows);
    expect(got.batches).toBe(6);
    expect(got.trades).toBe(12);
  });
});
