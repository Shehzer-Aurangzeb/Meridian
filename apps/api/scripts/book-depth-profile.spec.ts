import { transform, BANDS } from './book-depth-profile';

const HEAD = 'timestamp,percentage,depth,notional';

/**
 * One snapshot, given CUMULATIVE notional per band — which is what the archive
 * publishes. `bid`/`ask` are indexed by band, so `{1: 10, 2: 30}` means 10
 * resting within 1% and 30 within 2%, i.e. 20 in the (1%, 2%] shell.
 */
const snap = (
  stamp: string,
  bid: Record<number, number>,
  ask: Record<number, number>,
): string =>
  BANDS.flatMap((b) => [`${stamp},-${b}.00,1,${bid[b]}`, `${stamp},${b}.00,1,${ask[b]}`]).join('\n');

/** A cumulative ladder rising by `step` per band: {1: s, 2: 2s, ...}. */
const ladder = (step: number): Record<number, number> =>
  Object.fromEntries(BANDS.map((b) => [b, step * b]));

const key = (r: { shell: number; ts: number }): string =>
  `${r.shell}@${new Date(r.ts).toISOString()}`;

describe('book-depth profile transform', () => {
  it('differences cumulative bands into incremental shells', () => {
    // Cumulative 10/30/60/100/150 => shells of 10/20/30/40/50.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', { 1: 10, 2: 30, 3: 60, 4: 100, 5: 150 }, ladder(5)),
    ].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    const got = Object.fromEntries(rows.map((r) => [key(r), r.bidNotional]));
    expect(got['1@2026-08-20T00:05:00.000Z']).toBe(10);
    expect(got['2@2026-08-20T00:05:00.000Z']).toBe(20);
    expect(got['3@2026-08-20T00:05:00.000Z']).toBe(30);
    expect(got['4@2026-08-20T00:05:00.000Z']).toBe(40);
    expect(got['5@2026-08-20T00:05:00.000Z']).toBe(50);
  });

  it('shell 1 is the whole first band, not a difference against the 0.2% band', () => {
    // The 0.2% band only exists from 2026-01-15. Building shell 1 out of it
    // would make three years of history structurally different from the last
    // seven months, so it is ignored even when present.
    const csv = [
      HEAD,
      `2026-08-20 00:00:06,-0.20,1,7`,
      `2026-08-20 00:00:06,0.20,1,7`,
      snap('2026-08-20 00:00:06', ladder(10), ladder(10)),
    ].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    const shell1 = rows.find((r) => r.shell === 1)!;
    expect(shell1.bidNotional).toBe(10); // the full 1% band, NOT 10 - 7
  });

  it('reads bids from below mid and asks from above it', () => {
    const csv = [HEAD, snap('2026-08-20 00:00:06', ladder(20), ladder(5))].join('\n');
    const { rows } = transform('BTC', csv, '2026-08-20');
    const shell3 = rows.find((r) => r.shell === 3)!;
    expect(shell3.bidNotional).toBe(20);
    expect(shell3.askNotional).toBe(5);
  });

  it('stamps a bucket at its END, not its start', () => {
    // THE LOOK-AHEAD GUARD, inherited from book-depth-import. A snapshot at
    // 00:00:06 is known then, but the bucket covering 00:00-00:05 is only
    // complete at 00:05. Stamping it 00:00 makes the whole bucket readable five
    // minutes before it finished.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', ladder(1), ladder(1)),
      snap('2026-08-20 00:04:59', ladder(1), ladder(1)),
      snap('2026-08-20 00:05:01', ladder(1), ladder(1)),
    ].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    const stamps = [...new Set(rows.map((r) => r.ts))].sort();
    expect(stamps.map((t) => new Date(t).toISOString())).toEqual([
      '2026-08-20T00:05:00.000Z', // covers 00:00:00-00:04:59
      '2026-08-20T00:10:00.000Z', // covers 00:05:00-00:09:59
    ]);
  });

  it('averages the readings in a bucket rather than summing them', () => {
    // These are STATE snapshots: each is an equally valid reading of how the
    // book looked, so the bucket is their mean. Summing would report a bucket
    // holding five times the notional that was ever actually resting.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', ladder(10), ladder(10)),
      snap('2026-08-20 00:02:06', ladder(30), ladder(30)),
    ].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    const shell1 = rows.find((r) => r.shell === 1)!;
    expect(shell1.bidNotional).toBe(20); // mean(10, 30), not 40
  });

  it('skips a snapshot missing any band, and counts it', () => {
    // A missing band makes every shell above it a difference against nothing.
    // Emitting the shells below it would publish a partial profile as a whole
    // one, so the snapshot is dropped entirely and reported.
    const partial = [1, 2, 3, 4]
      .flatMap((b) => [`2026-08-20 00:00:06,-${b}.00,1,${b * 10}`, `2026-08-20 00:00:06,${b}.00,1,${b * 10}`])
      .join('\n');
    const csv = [HEAD, partial, snap('2026-08-20 00:02:06', ladder(10), ladder(10))].join('\n');

    const { rows, stats } = transform('BTC', csv, '2026-08-20');
    expect(stats.incomplete).toBe(1);
    expect(stats.snapshots).toBe(1);
    // Only the complete snapshot contributes, so the mean is its value alone.
    expect(rows.find((r) => r.shell === 1)!.bidNotional).toBe(10);
  });

  it('keeps a negative shell rather than clamping it, and counts it', () => {
    // Differencing two cumulative bands can go slightly negative when the rows
    // in a snapshot were sampled a moment apart and the book moved between
    // them. Clamping to zero would invent resting size the archive does not
    // report, so the reading is kept and the count is surfaced.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', { 1: 10, 2: 8, 3: 30, 4: 40, 5: 50 }, ladder(10)),
    ].join('\n');

    const { rows, stats } = transform('BTC', csv, '2026-08-20');
    expect(stats.negatives).toBe(1);
    expect(rows.find((r) => r.shell === 2)!.bidNotional).toBe(-2);
  });

  it('ignores rows belonging to a neighbouring day', () => {
    // A file occasionally carries a row from the next day. Without the filter
    // the day's first bucket silently absorbs the previous day's last snapshot.
    const csv = [
      HEAD,
      snap('2026-08-19 23:59:59', ladder(999), ladder(999)),
      snap('2026-08-20 00:00:06', ladder(10), ladder(10)),
    ].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    expect(rows.find((r) => r.shell === 1)!.bidNotional).toBe(10);
    expect(new Date(rows[0].ts).toISOString()).toBe('2026-08-20T00:05:00.000Z');
  });

  it('sums its shells back to the published +-5% cumulative band', () => {
    // The property the reconciliation in book-depth-verify.ts depends on: if
    // this fails, every recomputed bookImbalanceFar is wrong.
    const bid = { 1: 11, 2: 27, 3: 44, 4: 61, 5: 96 };
    const csv = [HEAD, snap('2026-08-20 00:00:06', bid, ladder(10))].join('\n');

    const { rows } = transform('BTC', csv, '2026-08-20');
    const total = rows.reduce((s, r) => s + r.bidNotional, 0);
    expect(total).toBeCloseTo(bid[5], 10);
  });
});
