/**
 * STEP 1 — does a level touch precede a bigger next hour?
 *
 *   npx ts-node test/manual/touch.ts --self-check
 *   npx ts-node test/manual/touch.ts test/manual/results/y3-touch.csv
 *
 * The claim under test: ~1.28% move in the hour after a touch vs ~0.85% for a
 * random hour. If true, levels mark volatile moments — useful for stop
 * PLACEMENT, not for direction.
 *
 * ─── The confound that decides this, named before building ───────────────
 * A level gets touched BECAUSE price travelled to it. Volatility clusters, so
 * "the hour after a touch" is already conditioned on the market having just
 * moved. A bigger next hour follows from that alone, with no special property
 * of the level — and a random-hour baseline cannot tell the two apart.
 *
 * So the naive comparison is reported (it is the claim as stated) alongside a
 * control matched on the PRIOR hour's move. If the gap survives inside prior-
 * move buckets, touches carry something. If it collapses, the effect is
 * momentum wearing a level's costume.
 *
 * READ-ONLY. Verdict on HOLDOUT.
 */
import * as fs from 'fs';
import { blockSpread } from './baserate';
import { blockBootstrap } from './holdout';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const BLOCK_DAYS = num('block-days', 14);
const B = num('b', 2000);
const SEED = num('seed', 12345);

export interface Bar {
  coin: string;
  time: number;
  touched: boolean;
  nearestPct: number;
  priorMovePct: number;
  nextMovePct: number;
  atrPct: number;
}

export function load(path: string): Bar[] {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const head = lines.findIndex((l) => !l.startsWith('#'));
  const cols = lines[head].split(',');
  return lines
    .slice(head + 1)
    .map((l) => {
      const c = l.split(',');
      const o = Object.fromEntries(cols.map((k, i) => [k, c[i]]));
      return {
        coin: o.coin,
        time: new Date(o.time).getTime(),
        touched: o.touched === '1',
        nearestPct: Number(o.nearestPct),
        priorMovePct: Number(o.priorMovePct),
        nextMovePct: Number(o.nextMovePct),
        atrPct: Number(o.atrPct),
      };
    })
    .filter((b) => Number.isFinite(b.nextMovePct) && Number.isFinite(b.priorMovePct))
    .sort((a, b) => a.time - b.time);
}

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/**
 * Bucket bars by prior-hour move so touch and non-touch are compared only
 * against bars that had just moved a similar amount.
 *
 * Fixed edges in percent, not sample deciles — same rule as everywhere else
 * in this project: a decile edge is set by the data it is measuring.
 */
export const PRIOR_EDGES = [0, 0.1, 0.25, 0.5, 1, 2, 100];

export function bucketOf(v: number, edges = PRIOR_EDGES): string | null {
  for (let i = 0; i < edges.length - 1; i += 1) {
    const last = i === edges.length - 2;
    if (v >= edges[i] && (last ? v <= edges[i + 1] : v < edges[i + 1])) {
      return `${edges[i]}-${edges[i + 1]}%`;
    }
  }
  return null;
}

/**
 * One random non-touch hour per touch, same coin, same calendar day.
 *
 * This is the baseline as the claim states it. Deterministic via a seeded RNG
 * so the reported number can be reproduced exactly.
 */
export function sameDayControl(bars: Bar[], seed: number): { touch: Bar[]; control: Bar[] } {
  const rng = makeRng(seed);
  const key = (b: Bar): string => `${b.coin}:${new Date(b.time).toISOString().slice(0, 10)}`;
  const byDay = new Map<string, Bar[]>();
  for (const b of bars) byDay.set(key(b), [...(byDay.get(key(b)) ?? []), b]);

  const touch: Bar[] = [];
  const control: Bar[] = [];
  for (const b of bars) {
    if (!b.touched) continue;
    const pool = (byDay.get(key(b)) ?? []).filter((x) => !x.touched);
    if (pool.length === 0) continue; // no untouched hour that day to compare against
    touch.push(b);
    control.push(pool[Math.floor(rng() * pool.length)]);
  }
  return { touch, control };
}

// ── self-check ──────────────────────────────────────────────────────────

function selfCheck(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  assert(bucketOf(0) === '0-0.1%', 'the lower edge belongs to its own bucket');
  assert(bucketOf(0.1) === '0.1-0.25%', 'an interior edge opens the next bucket');
  assert(bucketOf(100) === '2-100%', 'the top edge stays in the last bucket');
  assert(bucketOf(-1) === null, 'out of range is null, not clamped');

  const bar = (o: Partial<Bar>): Bar =>
    ({
      coin: 'X', time: 0, touched: false, nearestPct: 1,
      priorMovePct: 0, nextMovePct: 0, atrPct: 1, ...o,
    }) as Bar;

  // The control must be same-coin, same-day, and never a touch bar.
  const day = Date.UTC(2024, 0, 1);
  const H = 3_600_000;
  const set = [
    bar({ coin: 'A', time: day, touched: true, nextMovePct: 5 }),
    bar({ coin: 'A', time: day + H, touched: false, nextMovePct: 1 }),
    bar({ coin: 'A', time: day + 2 * H, touched: false, nextMovePct: 2 }),
    // A different coin on the same day must never be drawn as A's control.
    bar({ coin: 'B', time: day + H, touched: false, nextMovePct: 99 }),
  ];
  const { touch, control } = sameDayControl(set, 7);
  assert(touch.length === 1 && control.length === 1, 'one control per touch');
  assert(control[0].coin === 'A', 'the control is the same coin');
  assert(!control[0].touched, 'the control is never itself a touch');
  assert(control[0].nextMovePct !== 99, 'and never another coin');

  // A touch with no untouched hour that day is dropped, not matched wrongly.
  const lonely = [bar({ coin: 'A', time: day, touched: true })];
  assert(sameDayControl(lonely, 7).touch.length === 0, 'a touch with no control is dropped');

  // Same seed, same draw.
  const a = sameDayControl(set, 3).control[0].nextMovePct;
  const b = sameDayControl(set, 3).control[0].nextMovePct;
  assert(a === b, 'the control draw is reproducible');

  console.log('self-check passed (fixed buckets, same-day control, determinism)');
}

if (require.main === module && args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────

function report(path: string): void {
  const all = load(path);
  const t0 = all[0].time;
  const t1 = all[all.length - 1].time;
  const cut = t0 + (t1 - t0) * 0.7;
  const hold = all.filter((b) => b.time >= cut);
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

  console.log(`\nSTEP 1 — DOES A LEVEL TOUCH PRECEDE A BIGGER NEXT HOUR?`);
  console.log(`source  ${path}`);
  console.log(`HOLDOUT ${day(cut)} → ${day(t1)}  ${hold.length} bars\n`);

  // How rare is a "touch" at all? If it is most bars, it cannot be an event.
  console.log('how selective is a touch?');
  console.table(
    [
      { rule: 'bar range intersects a zone band', n: hold.filter((b) => b.touched).length },
      ...[0.1, 0.25, 0.5, 1].map((p) => ({
        rule: `nearest zone within ${p}% of spot`,
        n: hold.filter((b) => Math.abs(b.nearestPct) <= p).length,
      })),
    ].map((r) => ({ ...r, share: `${((r.n / hold.length) * 100).toFixed(1)}%` })),
  );

  // ── the claim as stated ──
  const { touch, control } = sameDayControl(hold, SEED);
  const pts = (bs: Bar[]): Array<{ time: number; value: number }> =>
    bs.map((b) => ({ time: b.time, value: b.nextMovePct }));
  const gap = blockSpread(pts(touch), pts(control), BLOCK_DAYS, B, SEED);
  const ciT = blockBootstrap(pts(touch), BLOCK_DAYS, B, SEED);
  const ciC = blockBootstrap(pts(control), BLOCK_DAYS, B, SEED);

  console.log('\n1. THE CLAIM AS STATED — post-touch vs a random non-touch hour, same coin, same day');
  console.table([
    {
      group: 'post-touch',
      n: touch.length,
      'mean next-hour move': `${mean(touch.map((b) => b.nextMovePct)).toFixed(3)}%`,
      median: `${median(touch.map((b) => b.nextMovePct)).toFixed(3)}%`,
      '95% CI': `[${ciT.lo.toFixed(3)}, ${ciT.hi.toFixed(3)}]`,
    },
    {
      group: 'random hour (control)',
      n: control.length,
      'mean next-hour move': `${mean(control.map((b) => b.nextMovePct)).toFixed(3)}%`,
      median: `${median(control.map((b) => b.nextMovePct)).toFixed(3)}%`,
      '95% CI': `[${ciC.lo.toFixed(3)}, ${ciC.hi.toFixed(3)}]`,
    },
  ]);
  console.log(
    `  difference ${(mean(touch.map((b) => b.nextMovePct)) - mean(control.map((b) => b.nextMovePct))).toFixed(4)}pp` +
      `  CI [${gap.lo.toFixed(4)}, ${gap.hi.toFixed(4)}] over ${gap.blocks} blocks` +
      `  ${gap.lo > 0 || gap.hi < 0 ? 'excludes zero' : 'CROSSES ZERO'}`,
  );

  // ── the control that matters ──
  console.log('\n2. MATCHED ON THE PRIOR HOUR — the same comparison inside prior-move buckets');
  console.log('   If the gap lives only in the pooled number, it was momentum, not the level.\n');
  console.table(
    PRIOR_EDGES.slice(0, -1).map((e, i) => {
      const label = `${e}-${PRIOR_EDGES[i + 1]}%`;
      const inB = hold.filter((b) => bucketOf(b.priorMovePct) === label);
      const t = inB.filter((b) => b.touched);
      const c = inB.filter((b) => !b.touched);
      const s =
        t.length > 10 && c.length > 10 ? blockSpread(pts(t), pts(c), BLOCK_DAYS, B, SEED) : null;
      return {
        'prior-hour move': label,
        'n touch': t.length,
        'n no-touch': c.length,
        'touch next': t.length ? `${mean(t.map((b) => b.nextMovePct)).toFixed(3)}%` : '—',
        'no-touch next': c.length ? `${mean(c.map((b) => b.nextMovePct)).toFixed(3)}%` : '—',
        gap:
          t.length && c.length
            ? `${(mean(t.map((b) => b.nextMovePct)) - mean(c.map((b) => b.nextMovePct))).toFixed(4)}pp`
            : '—',
        '95% CI': s ? `[${s.lo.toFixed(4)}, ${s.hi.toFixed(4)}]` : '—',
      };
    }),
  );

  // Prior-move itself, to size the confound being controlled for.
  const t = hold.filter((b) => b.touched);
  const c = hold.filter((b) => !b.touched);
  console.log(
    `\nthe confound, measured: prior-hour move was ${mean(t.map((b) => b.priorMovePct)).toFixed(3)}% ` +
      `before a touch vs ${mean(c.map((b) => b.priorMovePct)).toFixed(3)}% before a non-touch`,
  );
}

if (require.main === module && !args.includes('--self-check')) {
  const path = args.find((a) => a.endsWith('.csv'));
  if (!path) throw new Error('pass the touch log CSV as the first argument');
  report(path);
}
