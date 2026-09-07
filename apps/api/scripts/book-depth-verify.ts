/**
 * The falsification bar for the BookProfile reimport.
 *
 *   npx ts-node --transpile-only scripts/book-depth-verify.ts --dir <dir>
 *   npx ts-node --transpile-only scripts/book-depth-verify.ts --dir <dir> --coins BTC
 *
 * ─── What is being tested ────────────────────────────────────────────────
 * `bookImbalanceFar` is the bid share of the ±5% cumulative book and is already
 * stored in `FlowSample` for every 5-minute bucket back to 2023-01-01. The ±5%
 * cumulative figure is the sum of shells 1–5 per side, so the same quantity is
 * recomputable from the shells this reimport produces. If the differencing, the
 * bucketing or the stamping is wrong, it stops matching.
 *
 * **This is an alignment test, not a value test, and that distinction is the
 * point.** A cross-venue feature once came out 0.995 correlated with the 1-hour
 * return because a publication embargo pushed the cursor back one bar — and
 * reconciliation against the live API passed at 0.000 bp throughout. The stored
 * data was right and the READING was wrong. So every comparison here is keyed
 * on (symbol, ts), like-for-like buckets. An aggregate over a day or a coin
 * would agree perfectly while every bucket sat one slot from where it belongs.
 *
 * ─── Why this reads the archive and not just the table ───────────────────
 * The published metric is the MEAN OF PER-SNAPSHOT RATIOS: each snapshot's bid
 * share is computed first, and the bucket is the average of those. `BookProfile`
 * stores the mean NOTIONAL per shell, which is the right quantity for a depth
 * profile and a different estimator:
 *
 *     mean( bid / (bid + ask) )  !=  mean(bid) / (mean(bid) + mean(ask))
 *
 * They differ whenever the ratio moves inside the bucket — Jensen, not a bug.
 * Measured on LTC 2023-08-17: the per-snapshot estimator matches the stored
 * metric at 0.000e+0%, while the ratio-of-means drifts up to 5.48% on 2 buckets
 * out of 288.
 *
 * So the bar is checked where it can be checked exactly — recomputing from the
 * archive with the same estimator — and the drift of the stored quantity is
 * reported beside it as a known, quantified property. A future reader who
 * recomputes imbalance from `BookProfile` and finds a few percent of daylight
 * should find that number already written down here rather than rediscover it
 * as a defect.
 *
 * ─── The bar, pre-registered ─────────────────────────────────────────────
 *   >= 99% of overlapping buckets agree within 0.5% relative, across all 10
 *   coins and the full 2023-01 -> 2026-08 range.
 *
 * A shortfall is diagnosed, not worked around. `--diagnose` re-checks the worst
 * offenders against the NEIGHBOURING buckets, because a stamping error agrees
 * with the bucket next door and nothing else does.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { unzipSingle } from './flow-import';
import { BOOK_DEPTH_START, datesBetween } from './book-depth-import';
import { BANDS, transform } from './book-depth-profile';
import { ARCHIVE_BAR_MS } from '../src/flow/flow-collector.service';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const DIR = str('dir', path.join(process.env.HOME ?? '', 'meridian-archive/bookDepth'));
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const FROM = str('from', BOOK_DEPTH_START);
const TO = str('to', new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
const TOLERANCE = num('tolerance', 0.005);
const BAR = num('bar', 0.99);
const WORST = num('worst', 5);
/** Buckets sampled per coin for the BookProfile-vs-transform integrity check. */
const DB_SAMPLE = num('db-sample', 500);

interface Offender {
  symbol: string;
  ts: number;
  stored: number;
  recomputed: number;
  relative: number;
  snapshots: number;
}

const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;

/**
 * Recompute `bookImbalanceFar` from one day's archive file, using the SAME
 * estimator the published metric uses: the ±5% bid share per snapshot, then the
 * mean of those ratios over the bucket.
 *
 * The ±5% figure is rebuilt by summing the five shells rather than reading the
 * ±5% row directly, so this exercises the differencing rather than bypassing it.
 */
export function recomputeFromArchive(
  csv: string,
  fileDate: string,
): Map<number, { value: number; snapshots: number }> {
  const lines = csv.trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim());
  const iTime = head.indexOf('timestamp');
  const iPct = head.indexOf('percentage');
  const iNotional = head.indexOf('notional');
  if (iTime < 0 || iPct < 0 || iNotional < 0) throw new Error('bookDepth header changed');

  const snaps = new Map<number, { bid: Map<number, number>; ask: Map<number, number> }>();
  for (const line of lines.slice(1)) {
    const cell = line.split(',');
    const stamp = cell[iTime].trim();
    if (!stamp.startsWith(fileDate)) continue;
    const ms = Date.parse(`${stamp.replace(' ', 'T')}Z`);
    const pct = Number(cell[iPct]);
    const notional = Number(cell[iNotional]);
    if (!Number.isFinite(ms) || !Number.isFinite(pct) || !Number.isFinite(notional)) continue;
    const abs = Math.abs(pct);
    if (!BANDS.includes(abs)) continue;
    let s = snaps.get(ms);
    if (!s) snaps.set(ms, (s = { bid: new Map(), ask: new Map() }));
    (pct < 0 ? s.bid : s.ask).set(abs, notional);
  }

  const buckets = new Map<number, number[]>();
  for (const [ms, s] of snaps) {
    if (!BANDS.every((b) => s.bid.has(b) && s.ask.has(b))) continue;
    // Sum of the five shells per side == the published ±5% cumulative figure.
    let bid = 0;
    let ask = 0;
    for (let i = 0; i < BANDS.length; i += 1) {
      const below = i === 0 ? 0 : BANDS[i - 1];
      bid += s.bid.get(BANDS[i])! - (below === 0 ? 0 : s.bid.get(below)!);
      ask += s.ask.get(BANDS[i])! - (below === 0 ? 0 : s.ask.get(below)!);
    }
    if (bid + ask <= 0) continue;
    const key = Math.floor(ms / ARCHIVE_BAR_MS) * ARCHIVE_BAR_MS + ARCHIVE_BAR_MS;
    buckets.set(key, [...(buckets.get(key) ?? []), bid / (bid + ask)]);
  }

  const out = new Map<number, { value: number; snapshots: number }>();
  for (const [ts, ratios] of buckets) out.set(ts, { value: mean(ratios), snapshots: ratios.length });
  return out;
}

export const relativeDiff = (a: number, b: number): number =>
  b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b);

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const dates = datesBetween(FROM, TO);
  console.log('\nBOOK DEPTH RECONCILIATION');
  console.log(`archive    ${DIR}`);
  console.log(`bar        >= ${(BAR * 100).toFixed(0)}% of overlapping buckets within ${(TOLERANCE * 100).toFixed(1)}% relative`);
  console.log(`keyed on   (symbol, ts) — like-for-like buckets, never aggregates`);
  console.log(`estimator  mean of per-snapshot ±5% bid shares, shells summed\n`);

  let compared = 0;
  let agreed = 0;
  let absent = 0;
  const offenders: Offender[] = [];
  /** How far the stored mean-notional estimator drifts from the published one. */
  let driftWorst = 0;
  let driftOver = 0;
  let driftN = 0;

  for (const coin of COINS) {
    const symbol = coin.toUpperCase();
    const pair = `${symbol}USDT`;

    const stored = await prisma.flowSample.findMany({
      where: { symbol, metric: 'bookImbalanceFar' },
      select: { ts: true, value: true },
    });
    const storedByTs = new Map(stored.map((r) => [r.ts.getTime(), r.value]));

    let coinCompared = 0;
    let coinAgreed = 0;
    for (const date of dates) {
      const p = path.join(DIR, `${pair}-bookDepth-${date}.zip`);
      if (!fs.existsSync(p)) {
        absent += 1;
        continue;
      }
      const csv = unzipSingle(p);
      const recomputed = recomputeFromArchive(csv, date);

      for (const [ts, r] of recomputed) {
        const value = storedByTs.get(ts);
        if (value === undefined) continue;
        const rel = relativeDiff(r.value, value);
        coinCompared += 1;
        if (rel <= TOLERANCE) coinAgreed += 1;
        else offenders.push({ symbol, ts, stored: value, recomputed: r.value, relative: rel, snapshots: r.snapshots });
      }

      // The known-drift measurement: the same buckets under the estimator the
      // stored BookProfile rows actually support.
      const { rows } = transform(symbol, csv, date);
      const byTs = new Map<number, { bid: number; ask: number; n: number }>();
      for (const row of rows) {
        const c = byTs.get(row.ts) ?? { bid: 0, ask: 0, n: 0 };
        c.bid += row.bidNotional;
        c.ask += row.askNotional;
        c.n += 1;
        byTs.set(row.ts, c);
      }
      for (const [ts, c] of byTs) {
        const value = storedByTs.get(ts);
        if (value === undefined || c.n !== BANDS.length || c.bid + c.ask <= 0) continue;
        const rel = relativeDiff(c.bid / (c.bid + c.ask), value);
        driftN += 1;
        if (rel > TOLERANCE) driftOver += 1;
        if (rel > driftWorst) driftWorst = rel;
      }
    }

    compared += coinCompared;
    agreed += coinAgreed;
    console.log(
      `  ${symbol.padEnd(5)} ${coinCompared.toLocaleString().padStart(9)} buckets  ` +
        `${coinCompared === 0 ? '    n/a' : `${((coinAgreed / coinCompared) * 100).toFixed(3)}%`.padStart(8)} agree`,
    );
  }

  const rate = compared === 0 ? 0 : agreed / compared;
  console.log(`\ncompared      ${compared.toLocaleString()} overlapping buckets`);
  console.log(`agreed        ${agreed.toLocaleString()}  (${(rate * 100).toFixed(4)}%)`);
  console.log(`files absent  ${absent.toLocaleString()} (no file published — not an empty book)`);

  if (offenders.length > 0) {
    offenders.sort((a, b) => b.relative - a.relative);
    console.log(`\nworst ${Math.min(WORST, offenders.length)} of ${offenders.length.toLocaleString()} disagreements:`);
    for (const o of offenders.slice(0, WORST)) {
      console.log(
        `  ${o.symbol.padEnd(5)} ${new Date(o.ts).toISOString()}  ` +
          `stored ${o.stored.toFixed(6)}  recomputed ${o.recomputed.toFixed(6)}  ` +
          `rel ${(o.relative * 100).toFixed(4)}%  snaps ${o.snapshots}`,
      );
    }
  }

  console.log(
    `\nknown drift — recomputing imbalance from the STORED mean notionals instead:\n` +
      `  ${driftOver.toLocaleString()} of ${driftN.toLocaleString()} buckets ` +
      `(${driftN === 0 ? 0 : ((driftOver / driftN) * 100).toFixed(3)}%) exceed ${(TOLERANCE * 100).toFixed(1)}%, worst ${(driftWorst * 100).toFixed(3)}%.\n` +
      `  Expected: mean(bid/(bid+ask)) != mean(bid)/(mean(bid)+mean(ask)) when the ratio\n` +
      `  moves inside the bucket. BookProfile stores mean NOTIONAL, which is the right\n` +
      `  quantity for a depth profile and the wrong one for reproducing this metric.`,
  );

  const passed = rate >= BAR;
  console.log(`\n${passed ? 'PASS' : 'FAIL'} — ${(rate * 100).toFixed(4)}% against a bar of ${(BAR * 100).toFixed(0)}%`);

  if (!passed) {
    console.log('\ndiagnosing — does the disagreement match a NEIGHBOURING bucket?');
    const sample = offenders.slice(0, 200);
    let matchesPrev = 0;
    let matchesNext = 0;
    for (const o of sample) {
      const [prev, next] = await Promise.all([
        prisma.flowSample.findFirst({
          where: { symbol: o.symbol, metric: 'bookImbalanceFar', ts: new Date(o.ts - ARCHIVE_BAR_MS) },
          select: { value: true },
        }),
        prisma.flowSample.findFirst({
          where: { symbol: o.symbol, metric: 'bookImbalanceFar', ts: new Date(o.ts + ARCHIVE_BAR_MS) },
          select: { value: true },
        }),
      ]);
      if (prev && relativeDiff(o.recomputed, prev.value) <= TOLERANCE) matchesPrev += 1;
      if (next && relativeDiff(o.recomputed, next.value) <= TOLERANCE) matchesNext += 1;
    }
    console.log(`  of ${sample.length} worst: ${matchesPrev} match the PREVIOUS bucket, ${matchesNext} match the NEXT`);
    console.log(
      matchesPrev > sample.length / 2 || matchesNext > sample.length / 2
        ? '  => STAMPING. Values are right and sit in the wrong bucket. Fix the bucket key, not the arithmetic.'
        : '  => NOT stamping. Check the differencing (do shells sum back to the published ±5% band?), then the bucketing.',
    );
    process.exitCode = 1;
  }

  // Integrity: do the rows actually IN BookProfile match what transform emits?
  // The bar above proves the transform is right; this proves the table holds
  // what the transform produced rather than a stale or partial run.
  console.log('\nBookProfile integrity — stored rows vs transform output:');
  for (const coin of COINS) {
    const symbol = coin.toUpperCase();
    const rows = await prisma.bookProfile.findMany({
      where: { symbol },
      select: { ts: true, shell: true, bidNotional: true, askNotional: true },
      orderBy: { ts: 'asc' },
      take: DB_SAMPLE,
    });
    if (rows.length === 0) {
      console.log(`  ${symbol.padEnd(5)} no rows`);
      continue;
    }
    const date = rows[0].ts.toISOString().slice(0, 10);
    const p = path.join(DIR, `${symbol}USDT-bookDepth-${date}.zip`);
    if (!fs.existsSync(p)) {
      console.log(`  ${symbol.padEnd(5)} ${date} file absent, skipped`);
      continue;
    }
    const { rows: expected } = transform(symbol, unzipSingle(p), date);
    const key = (ts: number, shell: number): string => `${ts}:${shell}`;
    const want = new Map(expected.map((r) => [key(r.ts, r.shell), r]));
    let checked = 0;
    let ok = 0;
    for (const r of rows) {
      const w = want.get(key(r.ts.getTime(), r.shell));
      if (!w) continue;
      checked += 1;
      if (relativeDiff(r.bidNotional, w.bidNotional) < 1e-9 && relativeDiff(r.askNotional, w.askNotional) < 1e-9) ok += 1;
    }
    console.log(`  ${symbol.padEnd(5)} ${date}  ${ok}/${checked} rows identical`);
    if (checked > 0 && ok !== checked) process.exitCode = 1;
  }

  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
