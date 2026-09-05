/**
 * Where does the fee stop eating the edge?
 *
 *   pnpm cost-sweep -- --csv results/interval-10coin.csv
 *   pnpm cost-sweep -- --csv results/x.csv --steps 0,0.25,0.5,1,1.5
 *
 * The 10-coin run measured a real edge over random (+0.052R, 95% interval
 * excluding zero) sitting under a cost of 0.112R per trade. Both arms lose
 * money in absolute terms. So the question is no longer "is there a signal" but
 * "is the signal ever bigger than the toll".
 *
 * ─── Why this needs no re-run ────────────────────────────────────────────
 * The harness records `r` (gross) and `costR` per trade. Cost is
 * `roundTripPct / riskPercent`, charged once per closed trade and independent
 * of what price did. So a different fee is `netR = r - costR * k`, and k = 1 is
 * the fee the run was scored at. Which trades were TAKEN does not move with k —
 * entry, stop and targets were all decided before any fee was charged.
 *
 * That is the whole reason this is a re-scoring and not a sweep of backtests.
 * It also bounds what the answer can mean: this says what the SAME trades would
 * have paid at a different fee. It does NOT say what a strategy built for a
 * different fee would have done.
 *
 * ─── What it cannot answer ───────────────────────────────────────────────
 * Widening the stop lowers cost in R, because cost is fee% over risk% — but it
 * also changes which trades fill and where they exit, so it is a different
 * trade set and needs a real re-run with `STOP_ATR_MULTIPLE` changed. Nothing
 * here approximates that.
 */
import * as fs from 'fs';
import { blockBootstrapDiff, load, Row } from './holdout';
import { aggregate, isUnresolved } from '../../src/common/replay/trade-scoring';

const args = process.argv.slice(2);
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const CSV = str('csv', '');
/** Multiples of the run's own fee. 1 is what it was scored at. */
const STEPS = str('steps', '0,0.25,0.5,0.75,1,1.25,1.5')
  .split(',')
  .map(Number);
const BLOCK_DAYS = Number(str('block-days', '14'));
const DRAWS = Number(str('draws', '2000'));
const SEED = Number(str('seed', '12345'));
const BASE_FEE = Number(str('base-fee', '0.25'));

/** Re-derived at multiple `k`. Throws rather than guessing a missing column. */
function at(rows: Row[], k: number): Array<{ time: number; status: string; netR: number }> {
  return rows.map((row) => {
    if (row.r === undefined || row.costR === undefined) {
      throw new Error(
        'cost-sweep: this CSV has no `r`/`costR` columns, so the fee cannot be ' +
          're-derived. Re-run backtest:plans to produce one that has them.',
      );
    }
    return { time: row.time, status: row.status, netR: row.r - row.costR * k };
  });
}

/** Resolved-only, the pre-registered primary. Open trades are dropped. */
const points = (
  rows: Array<{ time: number; status: string; netR: number }>,
): Array<{ time: number; value: number }> =>
  rows.filter((r) => !isUnresolved(r)).map((r) => ({ time: r.time, value: r.netR }));

function main(): void {
  if (!CSV) throw new Error('cost-sweep: --csv is required');
  const randomPath = CSV.replace(/\.csv$/, '') + '.random.csv';
  if (!fs.existsSync(randomPath)) {
    throw new Error(`cost-sweep: ${randomPath} is missing — re-run with --random.`);
  }

  const plan = load(CSV, 'PLAN');
  const control = load(randomPath, 'RANDOM');
  console.log(`config  csv=${CSV} base-fee=${BASE_FEE}% block-days=${BLOCK_DAYS} seed=${SEED}`);
  console.log(`trades  plan ${plan.length}  control ${control.length}\n`);

  const table = STEPS.map((k) => {
    const p = at(plan, k);
    const c = at(control, k);
    const pa = aggregate(p);
    const ca = aggregate(c);
    const ci = blockBootstrapDiff(points(p), points(c), BLOCK_DAYS, DRAWS, SEED);
    return {
      'cost x': k.toFixed(2),
      'fee %': (BASE_FEE * k).toFixed(3),
      'plan net R': pa.expectancyResolved.toFixed(4),
      'random net R': ca.expectancyResolved.toFixed(4),
      edge: ci.point.toFixed(4),
      'edge 95% lo': ci.lo.toFixed(4),
      'edge 95% hi': ci.hi.toFixed(4),
      'plan profitable': pa.expectancyResolved > 0 ? 'YES' : 'no',
      'edge > 0': ci.lo > 0 ? 'YES' : 'no',
    };
  });
  console.table(table);

  // The crossing, said as a number rather than left to be eyeballed off the
  // table. Linear in k, so two points either side of zero locate it exactly.
  const net = (k: number): number =>
    aggregate(at(plan, k)).expectancyResolved;
  const n0 = net(0);
  const n1 = net(1);
  if (n0 > 0 && n1 <= 0) {
    const kStar = n0 / (n0 - n1);
    console.log(
      `\nplan breaks even at cost x${kStar.toFixed(3)} — a round trip of ` +
        `${(BASE_FEE * kStar).toFixed(4)}%, against ${BASE_FEE}% today.`,
    );
    console.log(
      `Costs must fall to ${((kStar / 1) * 100).toFixed(1)}% of current for these ` +
        'same trades to stop losing money.',
    );
  } else if (n0 <= 0) {
    console.log(
      '\nThe plan loses money at ZERO cost. The fee is not what is wrong with it.',
    );
  } else {
    console.log('\nThe plan is profitable at the fee it was scored at.');
  }
}

main();
