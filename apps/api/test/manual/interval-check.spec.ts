import { blockBootstrapDiff } from './holdout';

/**
 * The gate decides whether any future comparison is readable, so it gets the
 * same treatment the harness got: plant an answer, check it comes back.
 */
const DAY = 86_400_000;
const BLOCK_DAYS = 14;
/** One point in block k, at a time that cannot land on a boundary. */
const at = (block: number, value: number) => ({
  time: block * BLOCK_DAYS * DAY + DAY,
  value,
});

describe('blockBootstrapDiff', () => {
  it('recovers a planted difference', () => {
    // Twenty blocks, arm A a flat +1.0, arm B a flat +0.5. The difference is
    // 0.5 by construction and there is no variance to widen it.
    const a = Array.from({ length: 20 }, (_, k) => at(k, 1));
    const b = Array.from({ length: 20 }, (_, k) => at(k, 0.5));

    const ci = blockBootstrapDiff(a, b, BLOCK_DAYS, 500, 1);
    expect(ci.point).toBeCloseTo(0.5, 10);
    expect(ci.blocks).toBe(20);
    expect(ci.hi - ci.lo).toBeCloseTo(0, 6);
    expect(ci.pPositive).toBe(1);
  });

  it('stays tight when both arms move together — the reason it is paired', () => {
    // THE POINT OF THE FUNCTION. Each arm swings from 0 to 19 across blocks, so
    // each arm's OWN interval is enormous. The gap between them is always 0.3.
    //
    // Bootstrapping the arms separately and subtracting the intervals would
    // report that huge per-arm spread twice over. Drawing a block and taking
    // both arms from it cancels the common move, which is what the arms
    // actually share: the same weeks of the same market.
    const a = Array.from({ length: 20 }, (_, k) => at(k, k + 0.3));
    const b = Array.from({ length: 20 }, (_, k) => at(k, k));

    const ci = blockBootstrapDiff(a, b, BLOCK_DAYS, 500, 1);
    expect(ci.point).toBeCloseTo(0.3, 10);
    expect(ci.hi - ci.lo).toBeCloseTo(0, 6);

    // What the per-arm spread would have been: the block means run 0..19.
    // Any naive subtraction of two such intervals is wider than the signal by
    // more than an order of magnitude.
    expect(Math.max(...a.map((p) => p.value)) - Math.min(...a.map((p) => p.value))).toBe(19);
  });

  it('widens when the arms move independently', () => {
    // Same marginal spread as above, but the arms are shuffled against each
    // other, so no draw cancels. This must NOT come back tight — a gate that
    // reports a narrow interval on noise is worse than no gate.
    const a = Array.from({ length: 20 }, (_, k) => at(k, k % 2 === 0 ? 5 : -5));
    const b = Array.from({ length: 20 }, (_, k) => at(k, k % 2 === 0 ? -5 : 5));

    const ci = blockBootstrapDiff(a, b, BLOCK_DAYS, 500, 1);
    expect(ci.hi - ci.lo).toBeGreaterThan(1);
  });

  it('is the same interval twice on the same seed, and moves on a new one', () => {
    const a = Array.from({ length: 12 }, (_, k) => at(k, k % 3));
    const b = Array.from({ length: 12 }, (_, k) => at(k, k % 4));

    const first = blockBootstrapDiff(a, b, BLOCK_DAYS, 400, 12345);
    const again = blockBootstrapDiff(a, b, BLOCK_DAYS, 400, 12345);
    const other = blockBootstrapDiff(a, b, BLOCK_DAYS, 400, 999);

    expect(again).toEqual(first);
    expect(other.lo).not.toBe(first.lo);
  });

  it('cuts both arms on the same boundaries', () => {
    // A shared t0. If each arm were keyed off its own earliest trade, an arm
    // that started a week later would be sliced half a block out of step and
    // "the same block" would mean two different weeks.
    const a = [at(0, 1), at(1, 1)];
    const b = [{ time: 7 * DAY, value: 0 }, { time: 21 * DAY, value: 0 }];

    const ci = blockBootstrapDiff(a, b, BLOCK_DAYS, 200, 1);
    expect(ci.blocks).toBe(2); // both arms land in blocks 0 and 1, not 3 or 4
    expect(ci.point).toBeCloseTo(1, 10);
  });

  it('returns NaN rather than a number when an arm is empty', () => {
    // No control is not an edge of zero. The caller must not be able to print
    // a result from a run that had nothing to compare against.
    const a = [at(0, 1)];
    const ci = blockBootstrapDiff(a, [], BLOCK_DAYS, 200, 1);

    expect(Number.isNaN(ci.point)).toBe(true);
    expect(Number.isNaN(ci.lo)).toBe(true);
    expect(ci.blocks).toBe(0);
  });
});
