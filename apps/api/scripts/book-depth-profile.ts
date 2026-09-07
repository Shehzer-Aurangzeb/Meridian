/**
 * Reimport the order-book depth archive KEEPING ITS SHAPE.
 *
 *   npx ts-node --transpile-only scripts/book-depth-profile.ts --dir <dir>
 *   npx ts-node --transpile-only scripts/book-depth-profile.ts --dir <dir> --dry-run
 *   npx ts-node --transpile-only scripts/book-depth-profile.ts --dir <dir> \
 *     --coins BTC --from 2023-01-01 --to 2023-01-31
 *
 * ─── Why this exists next to book-depth-import.ts ────────────────────────
 * `book-depth-import.ts` reads the same files and writes three scalars per
 * bucket — `bookImbalanceNear`, `bookImbalanceFar`, `bookDepthNotional`. That
 * was correct for the study it fed: the published bands are CUMULATIVE and
 * therefore heavily correlated, and every extra feature raises the bar its
 * survivors have to clear. It is the wrong shape for a depth profile, and the
 * 3.8M FlowSample rows it produced cannot be turned back into one — the
 * structure was discarded on purpose, so it has to be re-derived from the
 * files.
 *
 * This script keeps the structure and writes nothing else. It shares the
 * fetch, the checksum verification and the unzip with the original; only the
 * transform differs.
 *
 * ─── What the archive publishes ──────────────────────────────────────────
 * One snapshot every ~30 seconds. Per snapshot, CUMULATIVE resting notional at
 * ±1, ±2, ±3, ±4 and ±5% of mid, plus ±0.2% from 2026-01-15 onward. Negative
 * percentage is below mid, which is the bid side.
 *
 * Cumulative means the ±3% row already contains the ±2% row. Differencing
 * consecutive bands gives the notional resting in each SHELL:
 *
 *   shell 1 = (0, 1%]   = band1
 *   shell 2 = (1%, 2%]  = band2 - band1
 *   shell 3 = (2%, 3%]  = band3 - band2
 *   shell 4 = (3%, 4%]  = band4 - band3
 *   shell 5 = (4%, 5%]  = band5 - band4
 *
 * Shell 1 is the whole first band, NOT (0.2%, 1%]. The 0.2% band is ignored
 * here: it starts 2026-01-15, and building shell 1 out of it would make three
 * years of history structurally different from the last seven months. Seven
 * months against 3.6 years is a live reading, not a base rate.
 *
 * ─── Two conventions inherited from the original, both load-bearing ──────
 *
 * 1. STAMPED AT THE END OF THE BUCKET. A snapshot at 00:00:06 is known at
 *    00:00:06, but the bucket covering 00:00–00:05 is only complete at 00:05.
 *    Stamping it 00:00 makes the whole bucket readable five minutes before it
 *    finished. That is the same look-ahead `ARCHIVE_METRICS.shiftBars` exists
 *    to remove from the metrics archive, and it is why the reconciliation in
 *    `book-depth-verify.ts` is keyed on (symbol, ts) rather than on aggregates.
 *
 * 2. MEAN OF READINGS, NOT SUM. These are STATE snapshots, not flows. Each one
 *    is an equally valid reading of how the book looked, so a bucket's value is
 *    the average reading. Summing notional across snapshots would weight the
 *    bucket toward whichever moments the book happened to be deepest. The same
 *    choice on the taker ratio moves the number 13.9% at the median.
 *
 * ─── A negative shell is a real reading, and it is kept ──────────────────
 * Differencing two cumulative bands can come out slightly negative when the two
 * rows in a snapshot were sampled a moment apart and the book moved between
 * them. Clamping that to zero would silently invent resting size where the
 * archive reports none. The value is kept as published and the count of
 * negatives is reported at the end, so a systematic problem is visible rather
 * than smoothed away.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { unzipSingle } from './flow-import';
import { BOOK_DEPTH_START, datesBetween, fetchAll } from './book-depth-import';
import { ARCHIVE_BAR_MS } from '../src/flow/flow-collector.service';

const BASE = 'https://data.binance.vision/data/futures/um/daily/bookDepth';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DIR = str('dir', '');
const DRY = args.includes('--dry-run');
const FETCH = args.includes('--fetch');
const BATCH = Number(str('batch', '20000'));
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const FROM = str('from', BOOK_DEPTH_START);
const TO = str('to', new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
const CONCURRENCY = Number(str('concurrency', '8'));

/** The cumulative bands this reads, in order. Shells are their differences. */
export const BANDS = [1, 2, 3, 4, 5];

export interface ProfileRow {
  symbol: string;
  ts: number;
  shell: number;
  bidNotional: number;
  askNotional: number;
}

export interface TransformStats {
  /** Snapshots that had all five bands on both sides. */
  snapshots: number;
  /** Snapshots dropped because a band was missing on one or both sides. */
  incomplete: number;
  /** Shell values that came out below zero. Kept, never clamped. */
  negatives: number;
}

/**
 * One day's CSV to `BookProfile` rows.
 *
 * A snapshot needs all five bands on BOTH sides to produce shells at all —
 * a missing band makes every shell above it a difference against nothing.
 * Such snapshots are counted and skipped rather than partially emitted.
 */
export function transform(
  symbol: string,
  csv: string,
  fileDate?: string,
): { rows: ProfileRow[]; stats: TransformStats } {
  const lines = csv.trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim());
  const iTime = head.indexOf('timestamp');
  const iPct = head.indexOf('percentage');
  const iNotional = head.indexOf('notional');
  if (iTime < 0 || iPct < 0 || iNotional < 0) {
    throw new Error(`${symbol}: bookDepth header changed — got "${lines[0]}"`);
  }

  // Gather the cumulative bands each snapshot contributes, keyed by its instant.
  const snaps = new Map<number, { bid: Map<number, number>; ask: Map<number, number> }>();
  for (const line of lines.slice(1)) {
    const cell = line.split(',');
    const stamp = cell[iTime].trim();
    // A file occasionally carries a row belonging to the neighbouring day. The
    // original importer filters the same way; without it a day's first bucket
    // silently absorbs the previous day's last snapshot.
    if (fileDate !== undefined && !stamp.startsWith(fileDate)) continue;
    // `2026-08-20 00:00:06` is UTC. Date.parse needs the marker or it reads local.
    const ms = Date.parse(`${stamp.replace(' ', 'T')}Z`);
    const pct = Number(cell[iPct]);
    const notional = Number(cell[iNotional]);
    if (!Number.isFinite(ms) || !Number.isFinite(pct) || !Number.isFinite(notional)) continue;

    const abs = Math.abs(pct);
    // The 0.2% band is deliberately not read. See the header.
    if (!BANDS.includes(abs)) continue;
    let s = snaps.get(ms);
    if (!s) snaps.set(ms, (s = { bid: new Map(), ask: new Map() }));
    if (pct < 0) s.bid.set(abs, notional);
    else s.ask.set(abs, notional);
  }

  const stats: TransformStats = { snapshots: 0, incomplete: 0, negatives: 0 };
  // shell -> bucket end -> the readings contributed by each snapshot
  const buckets = new Map<number, Map<number, { bid: number[]; ask: number[] }>>();

  for (const [ms, s] of snaps) {
    const complete = BANDS.every((b) => s.bid.has(b) && s.ask.has(b));
    if (!complete) {
      stats.incomplete += 1;
      continue;
    }
    stats.snapshots += 1;
    const key = Math.floor(ms / ARCHIVE_BAR_MS) * ARCHIVE_BAR_MS + ARCHIVE_BAR_MS;

    for (let i = 0; i < BANDS.length; i += 1) {
      const shell = i + 1;
      const below = i === 0 ? 0 : BANDS[i - 1];
      const bid = s.bid.get(BANDS[i])! - (below === 0 ? 0 : s.bid.get(below)!);
      const ask = s.ask.get(BANDS[i])! - (below === 0 ? 0 : s.ask.get(below)!);
      if (bid < 0 || ask < 0) stats.negatives += 1;

      let byTs = buckets.get(shell);
      if (!byTs) buckets.set(shell, (byTs = new Map()));
      let cell = byTs.get(key);
      if (!cell) byTs.set(key, (cell = { bid: [], ask: [] }));
      cell.bid.push(bid);
      cell.ask.push(ask);
    }
  }

  const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
  const rows: ProfileRow[] = [];
  for (const [shell, byTs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [ts, cell] of [...byTs.entries()].sort((a, b) => a[0] - b[0])) {
      rows.push({ symbol, ts, shell, bidNotional: mean(cell.bid), askNotional: mean(cell.ask) });
    }
  }
  return { rows, stats };
}

async function main(): Promise<void> {
  if (!DIR) throw new Error('--dir <dir> is required');
  fs.mkdirSync(DIR, { recursive: true });
  if (FROM < BOOK_DEPTH_START) {
    throw new Error(`--from ${FROM} is before the archive start ${BOOK_DEPTH_START}`);
  }

  const dates = datesBetween(FROM, TO);
  console.log(
    `\nBOOK DEPTH PROFILE — ${COINS.length} coins x ${dates.length} days` +
      `${FETCH ? ' [FETCH]' : ''}${DRY ? ' [DRY RUN]' : ''}\n`,
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  let buf: ProfileRow[] = [];
  let parsed = 0;
  let written = 0;
  const missing: string[] = [];
  const totals: TransformStats = { snapshots: 0, incomplete: 0, negatives: 0 };
  const perCoin = new Map<string, { rows: number; days: number }>();

  const flush = async (): Promise<void> => {
    if (buf.length === 0 || DRY) {
      buf = [];
      return;
    }
    const { count } = await prisma.bookProfile.createMany({
      data: buf.map((r) => ({
        symbol: r.symbol,
        ts: new Date(r.ts),
        shell: r.shell,
        bidNotional: r.bidNotional,
        askNotional: r.askNotional,
      })),
      skipDuplicates: true,
    });
    written += count;
    buf = [];
  };

  const t0 = Date.now();

  if (FETCH) {
    const jobs = COINS.flatMap((c) =>
      dates.map((date) => {
        const name = `${c.toUpperCase()}USDT-bookDepth-${date}.zip`;
        return { url: `${BASE}/${c.toUpperCase()}USDT/${name}`, dest: path.join(DIR, name) };
      }),
    ).filter((j) => !fs.existsSync(j.dest));
    console.log(`fetching ${jobs.length} missing files with ${CONCURRENCY} workers\n`);
    await fetchAll(jobs, CONCURRENCY);
    console.log(`\nfetch done in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}m\n`);
  }

  for (const coin of COINS) {
    const pair = `${coin.toUpperCase()}USDT`;
    for (const date of dates) {
      const p = path.join(DIR, `${pair}-bookDepth-${date}.zip`);
      if (!fs.existsSync(p)) {
        missing.push(`${coin}:${date}`);
        continue;
      }

      const { rows, stats } = transform(coin.toUpperCase(), unzipSingle(p), date);
      parsed += rows.length;
      totals.snapshots += stats.snapshots;
      totals.incomplete += stats.incomplete;
      totals.negatives += stats.negatives;

      const agg = perCoin.get(coin) ?? { rows: 0, days: 0 };
      agg.rows += rows.length;
      agg.days += 1;
      perCoin.set(coin, agg);

      buf.push(...rows);
      if (buf.length >= BATCH) await flush();
    }
    await flush();
    const a = perCoin.get(coin);
    console.log(
      `  ${coin.padEnd(5)} ${String(a?.days ?? 0).padStart(5)} days  ` +
        `${(a?.rows ?? 0).toLocaleString().padStart(11)} rows  ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }
  await flush();

  console.log(
    `\n${DRY ? 'would import' : 'imported'} ${parsed.toLocaleString()} rows` +
      `${DRY ? '' : `, ${written.toLocaleString()} new`} in ` +
      `${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  console.log(
    `snapshots ${totals.snapshots.toLocaleString()}, ` +
      `incomplete ${totals.incomplete.toLocaleString()}, ` +
      `negative shells ${totals.negatives.toLocaleString()}`,
  );

  // ABSENT, and named. A day Binance never published is a hole in the market
  // record. One that stays invisible becomes a gap somebody later reads as a
  // quiet book, which is the opposite reading.
  console.log(`\ndays with NO FILE (absent, not empty): ${missing.length}`);
  if (missing.length > 0) {
    const byDate = new Map<string, string[]>();
    for (const m of missing) {
      const [coin, date] = m.split(':');
      byDate.set(date, [...(byDate.get(date) ?? []), coin]);
    }
    for (const [date, coins] of [...byDate.entries()].sort()) {
      console.log(`  ${date}  ${coins.length === COINS.length ? 'ALL COINS' : coins.join(' ')}`);
    }
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
