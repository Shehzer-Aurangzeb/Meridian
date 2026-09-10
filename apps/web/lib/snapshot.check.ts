/**
 * Phase 5's bar: an archived reading renders what it actually held.
 *
 *   pnpm --filter web check
 *
 * The fixtures below are snapshots as they would have been written by older
 * versions of the map — one from before zones carried a probability, one from
 * before disclaimers existed at all. Today's `MapView` calls `.map()` on both
 * of those and reads a `Probability` off every zone, so an un-normalised
 * snapshot takes the whole page down and the record becomes unreadable.
 *
 * The second half matters more than the first: normalising must never fill in
 * CONTENT. A reading that showed no disclaimers has to keep showing none. If
 * today's copy leaked in, the page would be a reconstruction rather than a
 * record, and the one thing this journal exists to prove is what was on screen.
 */
import assert from 'node:assert/strict';
import { normaliseSnapshot } from './snapshot.ts';

const current = {
  symbol: 'BTC',
  asOf: '2026-09-08T16:00:00.000Z',
  spot: 78_500,
  expectedMove: {
    horizons: { '4': { p50: 0.003, p80: 0.008, p90: 0.011, coverage: { p50: 0.514, p80: 0.804, p90: 0.907 } } },
    calibrated: true,
    fittedAt: '2026-09-06',
    note: 'A SIZE forecast, not a direction.',
  },
  regime: {
    state: 'TRENDING',
    ageHours: 13,
    ageTruncated: false,
    reason: 'ADX above 27',
    exitWithin24h: { value: null, reason: 'Off by 5.1 points.', evidence: 'docs/evidence/LAYER2_CALIBRATION.md' },
  },
  zones: [
    {
      low: 77_000, high: 77_400, center: 77_200, type: 'support',
      sources: ['swing', 'volume'], distancePercent: -1.6, spanPercent: 0.5,
      bounceWithin4h: { value: null, reason: 'Never moved.', evidence: 'docs/evidence/LAYER2_CALIBRATION.md' },
      shell: 2,
    },
  ],
  liquidity: {
    shells: [{ shell: 1, bidNotional: 4e6, askNotional: 5e6, bidPercentile: 40, askPercentile: 60 }],
    imbalance: 0.44, coverage: '+-5%', asOf: '2026-08-30T00:00:00.000Z',
  },
  crowding: null,
  disclaimers: ['This map describes the market.', 'It does not forecast direction.'],
};

// ── A reading in today's shape survives untouched ──
const now = normaliseSnapshot(current);
assert.ok(now, 'a current snapshot must normalise');
assert.equal(now.symbol, 'BTC');
assert.equal(now.spot, 78_500);
assert.equal(now.zones.length, 1);
assert.deepEqual(now.zones[0].sources, ['swing', 'volume']);
assert.equal(now.disclaimers.length, 2);
assert.equal(now.regime?.ageHours, 13);
assert.equal(now.liquidity?.shells.length, 1);

// ── An older reading, from before several fields existed ──
//
// This is the one that decides the bar. Every field MapView reaches for is
// absent, and it must still render the coin, the price and the levels.
const older = {
  symbol: 'ETH',
  asOf: '2026-07-01T09:00:00.000Z',
  spot: 2_400,
  zones: [{ low: 2_300, high: 2_350, center: 2_325, type: 'support', distancePercent: -3.1 }],
};

const old = normaliseSnapshot(older);
assert.ok(old, 'an older snapshot must still render');
assert.equal(old.symbol, 'ETH');
assert.equal(old.spot, 2_400);
assert.equal(old.zones.length, 1, 'the level it held is kept');
assert.equal(old.zones[0].low, 2_300);

// The shapes MapView calls `.map()` on exist, so the page renders instead of
// throwing. Proof this fixture discriminates: these are the exact reads that
// crash on the raw object.
assert.ok(Array.isArray(old.zones[0].sources), 'sources must be an array to render');
assert.equal(old.zones[0].sources.length, 0, 'and must be EMPTY, not invented');
assert.ok(Array.isArray(old.disclaimers));
assert.equal(old.zones[0].bounceWithin4h.value, null);
assert.ok(
  'reason' in old.zones[0].bounceWithin4h && old.zones[0].bounceWithin4h.reason.length > 0,
  'a missing probability says why it is missing',
);

// Proof the fixture discriminates rather than passing either way: the SAME
// reads against the raw object throw. Without this the checks above would go
// green whatever normalisation did.
assert.throws(
  () => (older as { disclaimers: string[] }).disclaimers.map((d) => d),
  'raw: mapping absent disclaimers must throw',
);
assert.throws(
  () => (older.zones[0] as { sources: string[] }).sources.length,
  'raw: reading absent sources must throw',
);

// ── Content is never filled in ──
//
// The failure this guards against is subtle and total: a page that pastes in
// today's copy looks right and proves nothing.
assert.equal(old.disclaimers.length, 0, "an old reading must NOT inherit today's disclaimers");
assert.equal(old.regime, null, 'no regime recorded means none shown, not one guessed');
assert.equal(old.expectedMove, null);
assert.equal(old.liquidity, null);

// ── Junk is refused rather than rendered as an empty map ──
for (const bad of [null, undefined, 42, 'BTC', [], {}, { symbol: '' }, { spot: 100 }]) {
  assert.equal(normaliseSnapshot(bad), null, `must refuse ${JSON.stringify(bad) ?? 'undefined'}`);
}

// ── A published probability keeps its number and its sample size ──
const published = normaliseSnapshot({
  symbol: 'SOL',
  spot: 100,
  zones: [
    {
      low: 95, high: 96, center: 95.5, type: 'support', sources: ['swing'],
      distancePercent: -4, spanPercent: 1,
      bounceWithin4h: { value: 0.71, n: 1_847, fittedAt: '2026-09-06' },
      shell: 4,
    },
  ],
});
assert.ok(published);
assert.equal(published.zones[0].bounceWithin4h.value, 0.71);
assert.equal(
  'n' in published.zones[0].bounceWithin4h ? published.zones[0].bounceWithin4h.n : null,
  1_847,
  'the count rides with the number, or it cannot be judged',
);

console.log('snapshot: all checks passed');
