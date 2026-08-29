/**
 * The one thing this file still decides.
 *
 * Bucketing moved to the backend, where the list filter (SQL) and the
 * scoreboard (TypeScript) are checked against each other — see
 * apps/api/src/analysis-coordinator/buckets.spec.ts. What is left here is the
 * epoch boundary, which the page uses to mark old rows.
 *
 *   pnpm --filter web check
 */
import assert from 'node:assert/strict';
import { BUCKET_LABEL, FILTERABLE_BUCKETS, isPreEpoch, type Bucket } from './history-buckets.ts';
import type { AnalysisListItem } from '../types/analyses.ts';

const EPOCH = '2026-08-16T00:00:00.000Z';
const at = (createdAt: string) => ({ createdAt }) as AnalysisListItem;

// A row AT the epoch is inside it. Off by one here silently drops a day.
assert.equal(isPreEpoch(at(EPOCH), EPOCH), false, 'a row AT the epoch counts');
assert.equal(isPreEpoch(at('2026-08-15T23:59:59.999Z'), EPOCH), true);
// No epoch means no exclusions, not "exclude everything".
assert.equal(isPreEpoch(at('2020-01-01T00:00:00.000Z'), undefined), false);

// Every bucket the filter offers must have a label to render.
for (const b of FILTERABLE_BUCKETS) {
  assert.ok(BUCKET_LABEL[b], `no label for ${b}`);
}
assert.equal(Object.keys(BUCKET_LABEL).length, 8);
assert.ok(!FILTERABLE_BUCKETS.includes('unscored' as Bucket), 'unscored is not filterable');

console.log('history-buckets: all checks passed');
