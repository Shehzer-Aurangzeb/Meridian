/**
 * Seeded RNG and the block bootstrap, shared by the research harness and the
 * API.
 *
 * Moved here from `test/manual/` on 8 September 2026 so that one definition
 * serves both. A second copy is a second place for the bug to live, and this
 * particular bug has already been paid for once: `bootstrap.ts` and
 * `forward.ts` each carried an inline LCG whose low bits were rounding
 * artefacts, visiting some indices three times as often as others.
 */

/**
 * Distinct time blocks an interval needs before it is worth drawing.
 *
 * Big n across few blocks is the shape of a fake finding, not a small one: the
 * magnitude gate once produced an interval of [2.62, 2.62] — zero width, and it
 * looked like certainty — from 17 trades that all fell inside one block.
 */
export const MIN_BLOCKS = 4;

/** mulberry32: all arithmetic through Math.imul, so it stays exact in 32 bits. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const mean = (xs: number[]): number =>
  xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export interface Interval {
  lo: number;
  hi: number;
  blocks: number;
  pPositive: number;
}

/**
 * Block bootstrap over calendar time.
 *
 * Row-level resampling assumes independence, and ten coins inside one week are
 * closer to one observation than to forty. Drawing whole time blocks keeps
 * whatever market-wide move the block contained instead of averaging it away.
 */
export function blockBootstrap(
  points: Array<{ time: number; value: number }>,
  blockDays: number,
  draws: number,
  seed: number,
): Interval {
  if (points.length === 0) return { lo: NaN, hi: NaN, blocks: 0, pPositive: NaN };
  const rng = makeRng(seed);
  const t0 = Math.min(...points.map((r) => r.time));
  const ms = blockDays * 86_400_000;
  const byBlock = new Map<number, number[]>();
  for (const r of points) {
    const k = Math.floor((r.time - t0) / ms);
    const bucket = byBlock.get(k);
    if (bucket) bucket.push(r.value);
    else byBlock.set(k, [r.value]);
  }
  const blocks = [...byBlock.values()];

  const out: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      const pick = blocks[Math.floor(rng() * blocks.length)];
      for (const v of pick) {
        sum += v;
        count += 1;
      }
    }
    if (count > 0) out.push(sum / count);
  }
  return {
    lo: quantile(out, 0.025),
    hi: quantile(out, 0.975),
    blocks: blocks.length,
    pPositive: out.filter((x) => x > 0).length / out.length,
  };
}

/**
 * The same bootstrap, on the DIFFERENCE between two arms.
 *
 * Not two calls with the intervals subtracted. That treats the arms as
 * independent when both are drawn from the same weeks of the same market, so it
 * over-states the width — and the width is the whole answer here. A draw picks a
 * block and takes BOTH arms from it, so a week that was kind to one was kind to
 * the other in the same draw.
 *
 * A draw where either arm ended up empty is skipped, never counted as a zero
 * difference: no rows is not a result of zero.
 */
export function blockBootstrapDiff(
  a: Array<{ time: number; value: number }>,
  b: Array<{ time: number; value: number }>,
  blockDays: number,
  draws: number,
  seed: number,
): Interval & { point: number } {
  const empty = { lo: NaN, hi: NaN, blocks: 0, pPositive: NaN, point: NaN };
  if (a.length === 0 || b.length === 0) return empty;

  const rng = makeRng(seed);
  const t0 = Math.min(...a.map((r) => r.time), ...b.map((r) => r.time));
  const ms = blockDays * 86_400_000;

  const byBlock = new Map<number, { a: number[]; b: number[] }>();
  const put = (arm: 'a' | 'b', rows: typeof a): void => {
    for (const r of rows) {
      const k = Math.floor((r.time - t0) / ms);
      let cell = byBlock.get(k);
      if (!cell) byBlock.set(k, (cell = { a: [], b: [] }));
      cell[arm].push(r.value);
    }
  };
  put('a', a);
  put('b', b);
  const blocks = [...byBlock.values()];

  const out: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sumA = 0, nA = 0, sumB = 0, nB = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      const pick = blocks[Math.floor(rng() * blocks.length)];
      for (const v of pick.a) { sumA += v; nA += 1; }
      for (const v of pick.b) { sumB += v; nB += 1; }
    }
    if (nA > 0 && nB > 0) out.push(sumA / nA - sumB / nB);
  }
  if (out.length === 0) return empty;

  return {
    lo: quantile(out, 0.025),
    hi: quantile(out, 0.975),
    blocks: blocks.length,
    pPositive: out.filter((x) => x > 0).length / out.length,
    point: mean(a.map((r) => r.value)) - mean(b.map((r) => r.value)),
  };
}
