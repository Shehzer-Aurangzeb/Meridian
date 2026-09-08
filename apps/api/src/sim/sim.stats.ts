import { MIN_BLOCKS, blockBootstrapDiff, mean } from '../common/stats/block-bootstrap';
import { isTerminal } from './sim.scoring';

/**
 * Calendar days per bootstrap block. The project standard, and deliberately
 * coarser than "one batch, one block": two batches a day apart share a market,
 * so treating them as independent would understate the width.
 */
export const BLOCK_DAYS = 14;
export { MIN_BLOCKS };
const DRAWS = 2000;
const SEED = 20260908;

export interface StatRow {
  verdict: string;
  netR: number | null;
  outcome: string | null;
  decidedAt: Date;
  batchId: string;
}

export interface Arm {
  n: number;
  netR: number | null;
  wins: number;
}

export interface SimStats {
  batches: number;
  trades: number;
  resolved: number;
  pending: number;
  take: Arm;
  skip: Arm;
  /** Null whenever the evidence cannot support one. Never a bare number. */
  delta: { point: number; lo: number; hi: number; blocks: number } | null;
  /** Why the delta is null, or why it should be read carefully. */
  warning: string | null;
}

const armOf = (rows: StatRow[]): Arm => ({
  n: rows.length,
  netR: rows.length === 0 ? null : mean(rows.map((r) => r.netR as number)),
  wins: rows.filter((r) => (r.netR as number) > 0).length,
});

/**
 * The scoreboard.
 *
 * Only resolved rows contribute. An open position has no verdict, and totalling
 * it as zero is how a -0.202R result once read as -0.106R.
 */
export function simStats(rows: StatRow[]): SimStats {
  const batches = new Set(rows.map((r) => r.batchId)).size;
  const resolved = rows.filter((r) => isTerminal(r.outcome) && r.netR !== null);
  const take = resolved.filter((r) => r.verdict === 'TAKE');
  const skip = resolved.filter((r) => r.verdict === 'SKIP');

  const base: SimStats = {
    batches,
    trades: rows.length,
    resolved: resolved.length,
    pending: rows.length - resolved.length,
    take: armOf(take),
    skip: armOf(skip),
    delta: null,
    warning: null,
  };

  if (take.length === 0 || skip.length === 0) {
    return {
      ...base,
      warning:
        'Both arms need resolved trades before they can be compared. ' +
        `So far: ${take.length} taken, ${skip.length} passed on.`,
    };
  }

  const point = (r: StatRow) => ({ time: r.decidedAt.getTime(), value: r.netR as number });
  const diff = blockBootstrapDiff(
    take.map(point),
    skip.map(point),
    BLOCK_DAYS,
    DRAWS,
    SEED,
  );

  if (diff.blocks < MIN_BLOCKS) {
    // Big n across few blocks is the shape of a fake finding: one 14-day block
    // once carried an entire "result" and its interval collapsed to a point.
    return {
      ...base,
      warning:
        `Only ${diff.blocks} of the ${MIN_BLOCKS} time blocks needed for an interval. ` +
        `${resolved.length} resolved trades across ${batches} batch(es) is not ${resolved.length} ` +
        'observations — coins asked at one moment share a market. No interval is drawn.',
    };
  }

  return {
    ...base,
    delta: { point: diff.point, lo: diff.lo, hi: diff.hi, blocks: diff.blocks },
    warning: null,
  };
}
