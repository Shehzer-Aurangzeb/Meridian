/**
 * Self-check for the scoreboard aggregation.
 *
 *   node --experimental-strip-types lib/history-buckets.check.ts
 *
 * A plain script rather than a test suite because `apps/web` has no runner and
 * one file of arithmetic does not justify adding one. What it guards is the
 * rule that replaced hiding old rows: they stay in the LIST and stay out of
 * the TOTALS, and the count that was left out is reported rather than absorbed.
 * Get that wrong and the page shows a total quietly covering fewer rows than
 * the cards beneath it, which is the same lie as hiding them.
 */
import assert from 'node:assert/strict';
import { bucketOf, isPreEpoch, summariseResults } from './history-buckets.ts';
import type { AnalysisListItem, AnalysisStatus } from '../types/analyses.ts';

const EPOCH = '2026-08-16T00:00:00.000Z';

const row = (createdAt: string, status: Partial<AnalysisStatus> | null): AnalysisListItem =>
  ({ id: createdAt, symbol: 'BTC', createdAt, status }) as AnalysisListItem;

const won = { outcome: 'ALL_TARGETS', netR: 1 } as const;
const lost = { outcome: 'STOPPED', netR: -1.07 } as const;

// One post-epoch winner, one post-epoch loser, two pre-epoch rows.
const rows = [
  row('2026-08-16T06:00:00.000Z', won),
  row('2026-08-16T09:00:00.000Z', lost),
  row('2026-08-10T09:00:00.000Z', won),
  row('2026-07-01T09:00:00.000Z', lost),
];

const s = summariseResults(rows, EPOCH);

assert.equal(s.excluded, 2, 'both pre-epoch rows must be excluded');
assert.equal(s.total, 2, 'total describes what was counted, not what was passed in');
assert.equal(s.counts.wonClosed, 1);
assert.equal(s.counts.lostClosed, 1);
assert.equal(s.filled, 2);
// The excluded rows carry +1 and -1.07: if either leaked in, this moves.
assert.equal(Number(s.netR.toFixed(2)), -0.07, 'excluded R must not reach the total');

// Every bucket the page can render sums back to what was counted.
const summed = Object.values(s.counts).reduce((a, b) => a + b, 0);
assert.equal(summed, s.total, 'buckets must account for every counted row');

// No epoch supplied: nothing is excluded. The dashboard calls it this way.
const all = summariseResults(rows);
assert.equal(all.excluded, 0);
assert.equal(all.total, 4);

// The boundary itself is post-epoch — `<` not `<=`, or a row created exactly at
// the deploy instant would be thrown away.
assert.equal(isPreEpoch(row(EPOCH, won), EPOCH), false, 'a row AT the epoch counts');
assert.equal(isPreEpoch(row('2026-08-15T23:59:59.999Z', won), EPOCH), true);

// A status the web does not know must not return undefined and poison the
// counts with NaN — that was the bug when EXPIRED and UNSCOREABLE arrived.
assert.equal(bucketOf({ outcome: 'SOMETHING_NEW' } as unknown as AnalysisStatus), 'unscored');
assert.equal(bucketOf(null), 'unscored');
const withUnknown = summariseResults(
  [row('2026-08-16T06:00:00.000Z', { outcome: 'SOMETHING_NEW', netR: null } as never)],
  EPOCH,
);
assert.ok(Object.values(withUnknown.counts).every(Number.isFinite), 'no NaN in the counts');

console.log('history-buckets: all checks passed');
