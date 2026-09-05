import { transform, datesBetween, NEAR_PCT, FAR_PCT } from './book-depth-import';

const HEAD = 'timestamp,percentage,depth,notional';

/** One snapshot: the four bands the importer reads, plus noise it must skip. */
const snap = (
  stamp: string,
  { bidNear, askNear, bidFar, askFar }: Record<string, number>,
): string =>
  [
    `${stamp},-${FAR_PCT.toFixed(2)},1,${bidFar}`,
    `${stamp},-2.00,1,999999`, // an intermediate band, deliberately ignored
    `${stamp},-${NEAR_PCT.toFixed(2)},1,${bidNear}`,
    `${stamp},${NEAR_PCT.toFixed(2)},1,${askNear}`,
    `${stamp},2.00,1,999999`,
    `${stamp},${FAR_PCT.toFixed(2)},1,${askFar}`,
  ].join('\n');

const byMetric = (rows: ReturnType<typeof transform>) =>
  Object.fromEntries(rows.map((r) => [`${r.metric}@${new Date(r.ts).toISOString()}`, r.value]));

describe('book-depth transform', () => {
  it('reads bids from below mid and asks from above it', () => {
    // Twice as much resting size below mid as above: bid share 2/3.
    const csv = [HEAD, snap('2026-08-20 00:00:06', {
      bidNear: 200, askNear: 100, bidFar: 200, askFar: 100,
    })].join('\n');

    const got = byMetric(transform('BTC', csv, '2026-08-20'));
    expect(got['bookImbalanceNear@2026-08-20T00:05:00.000Z']).toBeCloseTo(2 / 3, 10);
    expect(got['bookImbalanceFar@2026-08-20T00:05:00.000Z']).toBeCloseTo(2 / 3, 10);
    expect(got['bookDepthNotional@2026-08-20T00:05:00.000Z']).toBe(300);
  });

  it('stamps a bucket at its END, not its start', () => {
    // THE LOOK-AHEAD GUARD. A snapshot at 00:00:06 is known then, but the bucket
    // covering 00:00-00:05 is only complete at 00:05. Stamping it 00:00 would
    // make the whole bucket readable five minutes before it finished — the same
    // error ARCHIVE_METRICS.shiftBars exists to remove from the metrics archive.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', { bidNear: 1, askNear: 1, bidFar: 1, askFar: 1 }),
      snap('2026-08-20 00:04:59', { bidNear: 1, askNear: 1, bidFar: 1, askFar: 1 }),
      snap('2026-08-20 00:05:01', { bidNear: 1, askNear: 1, bidFar: 1, askFar: 1 }),
    ].join('\n');

    const stamps = [...new Set(transform('BTC', csv, '2026-08-20').map((r) => r.ts))].sort();
    expect(stamps.map((t) => new Date(t).toISOString())).toEqual([
      '2026-08-20T00:05:00.000Z', // covers 00:00:00–00:04:59
      '2026-08-20T00:10:00.000Z', // covers 00:05:00–00:09:59
    ]);
  });

  it('averages the readings, and does not sum then divide', () => {
    // Two snapshots: one balanced (0.5), one 80% bid (800/1000). Mean of ratios
    // is 0.65. Ratio of sums is 900/1300 = 0.692, because the deeper snapshot
    // would dominate. These are STATE readings, so each counts once.
    const csv = [
      HEAD,
      snap('2026-08-20 00:00:06', { bidNear: 100, askNear: 100, bidFar: 100, askFar: 100 }),
      snap('2026-08-20 00:00:36', { bidNear: 800, askNear: 200, bidFar: 800, askFar: 200 }),
    ].join('\n');

    const got = byMetric(transform('BTC', csv, '2026-08-20'));
    expect(got['bookImbalanceNear@2026-08-20T00:05:00.000Z']).toBeCloseTo(0.65, 10);
    expect(got['bookImbalanceNear@2026-08-20T00:05:00.000Z']).not.toBeCloseTo(900 / 1300, 3);
  });

  it('keeps an empty side as an extreme reading, not as missing data', () => {
    // The archive publishes all twelve bands every snapshot, so zero notional
    // means no resting size in that band. Within 0.2% of mid on a thin coin that
    // is real and it is the most extreme reading available — dropping it would
    // remove exactly the observations the feature exists to catch.
    const csv = [HEAD, snap('2026-08-20 00:00:06', {
      bidNear: 100, askNear: 0, bidFar: 100, askFar: 100,
    })].join('\n');

    const got = byMetric(transform('BTC', csv, '2026-08-20'));
    expect(got['bookImbalanceNear@2026-08-20T00:05:00.000Z']).toBe(1);
    expect(got['bookImbalanceFar@2026-08-20T00:05:00.000Z']).toBe(0.5);
  });

  it('keeps the far metrics on a pre-2026 file, which has no 0.2% band', () => {
    // Binance only started publishing the 0.2% band on 2026-01-15. Every file
    // before that has +-1..+-5 and nothing nearer, and this is the shape of
    // roughly three of the four years of archive.
    const csv = [
      HEAD,
      `2023-06-01 07:03:02,-5,1,200`,
      `2023-06-01 07:03:02,-2,1,999999`,
      `2023-06-01 07:03:02,2,1,999999`,
      `2023-06-01 07:03:02,5,1,100`,
    ].join('\n');

    const got = byMetric(transform('BTC', csv, '2023-06-01'));
    expect(got['bookImbalanceFar@2023-06-01T07:05:00.000Z']).toBeCloseTo(2 / 3, 10);
    expect(got['bookDepthNotional@2023-06-01T07:05:00.000Z']).toBe(300);
    // The near band is genuinely absent, so it is not reported as a reading.
    expect(got['bookImbalanceNear@2023-06-01T07:05:00.000Z']).toBeUndefined();
  });

  it('skips a snapshot with no book on either side', () => {
    // Both sides zero is the only genuinely unreadable case.
    const csv = [HEAD, snap('2026-08-20 00:00:06', {
      bidNear: 0, askNear: 0, bidFar: 0, askFar: 0,
    })].join('\n');
    expect(transform('BTC', csv, '2026-08-20')).toEqual([]);
  });

  it('drops rows belonging to another day', () => {
    // The metrics archive had four files carrying a row from the next day, whose
    // own file held the same bucket with a different value. Same guard here.
    const csv = [
      HEAD,
      snap('2026-08-21 00:00:06', { bidNear: 1, askNear: 1, bidFar: 1, askFar: 1 }),
    ].join('\n');
    expect(transform('BTC', csv, '2026-08-20')).toEqual([]);
  });

  it('throws when the header changes instead of importing nothing', () => {
    expect(() => transform('BTC', 'a,b,c\n1,2,3', '2026-08-20')).toThrow(/header changed/);
  });

  it('walks dates inclusively', () => {
    expect(datesBetween('2026-08-20', '2026-08-22')).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
    expect(datesBetween('2026-08-20', '2026-08-20')).toEqual(['2026-08-20']);
  });
});
