/**
 * Step 1's gate: is the harness precise enough to decide anything?
 *
 *   pnpm interval -- --csv results/interval-10coin.csv
 *   pnpm interval -- --csv results/x.csv --bar 0.05 --block-days 14
 *
 * ROADMAP §7 measured a 95% interval 0.318R wide on edge over random, over 80
 * days of three coins. Every decision the project has made rested on a delta
 * INSIDE that interval. Until the interval is narrower than the smallest delta
 * worth acting on, another input and another run settle nothing.
 *
 * This reads the two CSVs `backtest:plans --csv` writes, measures the interval
 * on the difference between the arms, and answers PASS or FAIL against a bar
 * fixed on the command line. Exit code 1 on FAIL, so it can gate a script.
 *
 * ─── Why a script and not a look at the table ────────────────────────────
 * The harness already prints edge over random. It does not print an interval
 * on it, so reading that number without one is how a difference of 0.130R came
 * to justify a decision inside a 0.318R interval. The bar belongs in the
 * command, before the run, where it cannot be adjusted to fit the answer.
 *
 * ─── The primary is RESOLVED-ONLY ────────────────────────────────────────
 * Both pre-registrations define it that way. Open and unfilled trades are
 * dropped via the shared `isUnresolved`, never zeroed — a trade still running
 * is not a result of zero, and neither is one that never opened.
 */
import * as fs from 'fs';
import { blockBootstrapDiff, load, Row } from './holdout';
import { isUnresolved } from '../../src/common/replay/trade-scoring';

const args = process.argv.slice(2);
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const num = (name: string, fallback: number): number => Number(str(name, String(fallback)));

const CSV = str('csv', '');
/** Width the interval must beat. Default is the pre-registered "better" bar. */
const BAR = num('bar', 0.05);
const BLOCK_DAYS = num('block-days', 14);
const DRAWS = num('draws', 2000);
const SEED = num('seed', 12345);

/** Finished trades only, and the reason is in the file header. */
const resolved = (rows: Row[]): Array<{ time: number; value: number }> =>
  rows
    .filter((r) => !isUnresolved({ status: r.status, netR: r.netR }))
    .map((r) => ({ time: r.time, value: r.netR }));

function main(): void {
  if (!CSV) throw new Error('interval-check: --csv is required');
  const randomPath = CSV.replace(/\.csv$/, '') + '.random.csv';
  if (!fs.existsSync(CSV)) throw new Error(`interval-check: no such file ${CSV}`);
  if (!fs.existsSync(randomPath)) {
    throw new Error(
      `interval-check: ${randomPath} is missing. Re-run the backtest with ` +
        '--random, or there is no control to measure against.',
    );
  }

  const plan = resolved(load(CSV, 'PLAN'));
  const control = resolved(load(randomPath, 'RANDOM'));
  const ci = blockBootstrapDiff(plan, control, BLOCK_DAYS, DRAWS, SEED);
  const width = ci.hi - ci.lo;

  // Config on every line of output, because a number whose configuration is
  // lost is not a result (docs/archive/STATE_OF_PLAY.md §14c).
  console.log(
    `config  csv=${CSV} bar=${BAR}R block-days=${BLOCK_DAYS} draws=${DRAWS} seed=${SEED}`,
  );
  console.log(`resolved trades   plan ${plan.length}   control ${control.length}`);
  console.log(`blocks            ${ci.blocks}`);
  console.log(`edge over random  ${ci.point.toFixed(4)}R  (resolved-only, PRIMARY)`);
  console.log(
    `95% interval      [${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}]  width ${width.toFixed(4)}R`,
  );
  console.log(`P(edge > 0)       ${(ci.pPositive * 100).toFixed(1)}%`);

  const pass = width <= BAR;
  console.log(
    `\n${pass ? 'PASS' : 'FAIL'}  width ${width.toFixed(4)}R ${pass ? '<=' : '>'} bar ${BAR}R`,
  );

  if (!pass) {
    // Said out loud rather than left to be inferred: a failed gate does not
    // mean "run it again with more coins". It means no comparison smaller than
    // this width can be read off this rig at all.
    console.log(
      `\nNothing this rig prints that differs by less than ${width.toFixed(3)}R is a\n` +
        'measurement. That includes every arm comparison in the tables beside it.',
    );
    process.exit(1);
  }
}

main();
