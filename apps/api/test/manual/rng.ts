/**
 * Seeded RNG for the measurement harnesses.
 *
 * ─── Why this file exists ────────────────────────────────────────────────
 * bootstrap.ts and forward.ts both had this LCG inline:
 *
 *     s = (s * 1103515245 + 12345) & 0x7fffffff
 *
 * It is badly non-uniform in JavaScript, for two compounding reasons:
 *   1. s * 1103515245 reaches ~2^61, past the 2^53 where doubles are exact,
 *      so the low bits of the product are rounding artefacts.
 *   2. `& 0x7fffffff` then KEEPS exactly those low bits. Low-order bits of an
 *      LCG are the worst ones even at full precision.
 *
 * Measured: drawing 5-of-20 twenty thousand times, bucket counts ran 369 to
 * 1632 against an expected 1000. That is not sampling noise, it is a
 * generator that visits some indices three times as often as others — in a
 * month-block bootstrap, that silently over-weights some months.
 *
 * mulberry32 instead: all arithmetic through Math.imul so it stays in exact
 * 32-bit integer range, and it returns high bits. Still fully deterministic,
 * so a reported CI is still reproducible from its seed.
 *
 * Its check lives in forward.ts --self-check (count, uniqueness, seed
 * reproducibility, seed sensitivity, uniformity) — that is the test that
 * caught the old one.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
