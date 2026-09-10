/**
 * Phase 6's bar: the readout recovers a known answer, and refuses an unknown one.
 *
 *   pnpm --filter api sim-readout
 *
 * A readout that cannot find an edge it was handed cannot be trusted to report
 * one it was not. Four plants were used exactly this way on `backtest-plans.ts`
 * and recovered to the digit; the same technique applies here, and it is the
 * only thing standing between this journal and a number nobody can check.
 *
 * Everything below is synthetic. Nothing here touches the database or the
 * exchange, so it can be re-run at any time and always answers the same way.
 */
import { simStats, StatRow, BLOCK_DAYS, MIN_BLOCKS } from '../../src/sim/sim.stats';
import { blockBootstrap, makeRng } from '../../src/common/stats/block-bootstrap';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
/** Batches spaced a fortnight apart, so each lands in its own block. */
const SPACING = BLOCK_DAYS + 1;

let failures = 0;

function check(name: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
  if (!pass) failures += 1;
}

/**
 * A synthetic record: `batches` batches of `perBatch` coins, where the taken
 * arm is planted `delta` above the passed arm.
 *
 * Both arms share a per-batch shock, because that is how the real thing behaves
 * — a week that was kind to one arm was kind to the other. A bootstrap that
 * treats the arms as independent cannot see that, which is the whole reason the
 * difference is resampled rather than the arms.
 */
function record(
  batches: number,
  perBatch: number,
  delta: number,
  noise: number,
  seed: number,
  spacingDays = SPACING,
): StatRow[] {
  const rng = makeRng(seed);
  const rows: StatRow[] = [];
  for (let b = 0; b < batches; b += 1) {
    const decidedAt = new Date(T0 + b * spacingDays * DAY);
    const shock = (rng() - 0.5) * 4;
    for (let i = 0; i < perBatch; i += 1) {
      const take = i < perBatch / 2;
      rows.push({
        verdict: take ? 'TAKE' : 'SKIP',
        netR: shock + (take ? delta : 0) + (rng() - 0.5) * noise,
        outcome: 'ALL_TARGETS',
        decidedAt,
        batchId: `b${b}`,
      });
    }
  }
  return rows;
}

console.log('\nSIM READOUT — positive control\n');

// ── 1. Planted deltas are recovered ──────────────────────────────────────
console.log('1. a planted difference comes back out');
for (const planted of [0.4, 0.15, -0.25, 0]) {
  const got = simStats(record(12, 10, planted, 0.2, 7 + planted * 100));
  const point = got.delta?.point ?? NaN;
  check(
    `planted ${planted >= 0 ? '+' : ''}${planted.toFixed(2)}`,
    Math.abs(point - planted) < 0.05,
    `measured ${point >= 0 ? '+' : ''}${point.toFixed(4)}  (miss ${Math.abs(point - planted).toFixed(4)})`,
  );
}

// ── 2. The interval covers the truth, and a zero plant crosses zero ──────
console.log('\n2. the interval says what it should about the plant');
{
  const real = simStats(record(12, 10, 0.4, 0.2, 11));
  check(
    'a real difference has an interval containing it',
    (real.delta?.lo ?? 1) <= 0.4 && (real.delta?.hi ?? -1) >= 0.4,
    `[${real.delta?.lo.toFixed(3)}, ${real.delta?.hi.toFixed(3)}]`,
  );

  const none = simStats(record(12, 10, 0, 0.2, 13));
  check(
    'no difference gives an interval that crosses zero',
    (none.delta?.lo ?? 1) <= 0 && (none.delta?.hi ?? -1) >= 0,
    `[${none.delta?.lo.toFixed(3)}, ${none.delta?.hi.toFixed(3)}]`,
  );
}

// ── 3. The guard fires on few blocks, whatever the row count ─────────────
console.log('\n3. rows are not evidence; blocks are');
{
  // 200 finished calls, every one inside a single fortnight.
  const crowded = record(20, 10, 0.4, 0.2, 17, 0.5);
  const got = simStats(crowded);
  check(
    `${got.resolved} rows in one block draws no interval`,
    got.delta === null,
    got.warning?.slice(0, 58) ?? 'no warning',
  );

  const spread = simStats(record(MIN_BLOCKS, 10, 0.4, 0.2, 19));
  check(
    `${MIN_BLOCKS} blocks is enough to draw one`,
    spread.delta !== null && spread.delta.blocks >= MIN_BLOCKS,
    `blocks ${spread.delta?.blocks}`,
  );

  const justUnder = simStats(record(MIN_BLOCKS - 1, 10, 0.4, 0.2, 23));
  check(
    `${MIN_BLOCKS - 1} blocks is not`,
    justUnder.delta === null,
    justUnder.warning?.slice(0, 58) ?? 'no warning',
  );
}

// ── 4. One interval on the difference, never two subtracted ──────────────
//
// THE DEFECT THIS PROJECT HAS ALREADY SHIPPED. When both arms move together
// inside a block, their shared movement cancels in the difference. Resampling
// the arms separately and subtracting their intervals keeps that shared
// movement in twice, and reports a width that is mostly the market.
console.log('\n4. the difference is resampled, not the arms');
{
  const rows = record(12, 10, 0.4, 0.2, 29);
  const paired = simStats(rows);

  const point = (r: StatRow) => ({ time: r.decidedAt.getTime(), value: r.netR as number });
  const take = rows.filter((r) => r.verdict === 'TAKE').map(point);
  const skip = rows.filter((r) => r.verdict === 'SKIP').map(point);
  const a = blockBootstrap(take, BLOCK_DAYS, 2000, 101);
  const b = blockBootstrap(skip, BLOCK_DAYS, 2000, 101);

  const pairedWidth = (paired.delta?.hi ?? 0) - (paired.delta?.lo ?? 0);
  const subtractedWidth = a.hi - b.lo - (a.lo - b.hi);

  check(
    'paired width is far narrower than subtracting arms',
    pairedWidth < subtractedWidth / 2,
    `paired ${pairedWidth.toFixed(3)} vs subtracted ${subtractedWidth.toFixed(3)}`,
  );
  check(
    'and subtracting would have hidden the real difference',
    a.lo - b.hi < 0 && paired.delta !== null && paired.delta.lo > 0,
    `subtracted [${(a.lo - b.hi).toFixed(3)}, ${(a.hi - b.lo).toFixed(3)}] vs paired [${paired.delta?.lo.toFixed(3)}, ${paired.delta?.hi.toFixed(3)}]`,
  );
}

// ── 5. Unfinished calls never reach the total ────────────────────────────
console.log('\n5. an unfinished call is not a flat one');
{
  const rows = record(12, 10, 0.4, 0.2, 31);
  const withOpen: StatRow[] = [
    ...rows,
    ...Array.from({ length: 40 }, (_, i) => ({
      verdict: i % 2 === 0 ? 'TAKE' : 'SKIP',
      netR: null,
      outcome: 'OPEN' as string | null,
      decidedAt: new Date(T0 + i * DAY),
      batchId: 'open',
    })),
  ];
  const before = simStats(rows);
  const after = simStats(withOpen);
  check(
    'adding 40 open calls moves neither arm',
    Math.abs((before.take.netR ?? 0) - (after.take.netR ?? 0)) < 1e-12 &&
      Math.abs((before.skip.netR ?? 0) - (after.skip.netR ?? 0)) < 1e-12,
    `take ${after.take.netR?.toFixed(4)}  skip ${after.skip.netR?.toFixed(4)}`,
  );
  check(
    'they are counted as pending instead',
    after.pending === 40 && after.resolved === before.resolved,
    `pending ${after.pending}, resolved ${after.resolved}`,
  );
  // Scoring them at zero is what turned -0.202R into -0.106R in section 14h.
  const asZero = simStats(withOpen.map((r) => ({ ...r, netR: r.netR ?? 0, outcome: 'ALL_TARGETS' })));
  check(
    'and treating them as zero WOULD have moved it',
    Math.abs((asZero.take.netR ?? 0) - (after.take.netR ?? 0)) > 0.05,
    `zeroed ${asZero.take.netR?.toFixed(4)} vs ${after.take.netR?.toFixed(4)}`,
  );
}

console.log(
  failures === 0
    ? '\nAll checks passed. The readout recovers what it is given.\n'
    : `\n${failures} CHECK(S) FAILED — the readout cannot be trusted.\n`,
);
process.exit(failures === 0 ? 0 : 1);
