/**
 * Import Binance's bulk flow archive into `FlowSample`.
 *
 *   npx ts-node --transpile-only scripts/flow-import.ts --dir <archive-dir>
 *   npx ts-node --transpile-only scripts/flow-import.ts --dir <dir> --dry-run
 *
 * The archive (`data.binance.vision/data/futures/um/daily/metrics/`) publishes
 * six columns at 5-minute resolution from 2021-12-01, BTC from 2020-09-01. It
 * is the only source of this data older than the live API's ~30-day retention.
 *
 * Per file, in this order and for reasons measured over all 17,766 of them:
 *
 *  1. SORT. 1,044 files are not in chronological order, starting 2024-04-04,
 *     and it is not a clean boundary — 51 dates have both sorted and unsorted
 *     files. Reading in file order builds a scrambled series with no error.
 *  2. FLOOR to the 5-minute bucket. Twelve rows across four files (BNBUSDT and
 *     LTCUSDT 2024-04-03, SOLUSDT 2024-04-02, LINKUSDT 2024-04-01) are stamped
 *     1-3 seconds late on the right minute. Matching on exact epoch equality
 *     drops or collides them.
 *  3. DEDUPE on the floored timestamp. 263 files repeat every row — all
 *     BTCUSDT, 2020-09-01 to 2021-05-21, none inside the ten-coin window.
 *  4. SHIFT per metric, from ARCHIVE_METRICS. This is the look-ahead fix; the
 *     evidence is in that table's comment, not repeated here.
 *
 * Short files are imported AS-IS. 105 files in the ten-coin window hold fewer
 * than 288 rows, and they are the same dates across all ten coins at once
 * (2021-12-04 has 285 everywhere, 2021-12-15 has 287) — Binance-side collection
 * outages, which are real holes in the market record. Filling them would be
 * inventing data. The dates are reported instead.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ARCHIVE_METRICS, ARCHIVE_BAR_MS } from '../src/flow/flow-collector.service';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DIR = str('dir', '');
const DRY = args.includes('--dry-run');
const BATCH = Number(str('batch', '20000'));

/** One archive CSV, already unzipped, as (metric, ts, value) triples. */
export interface Sample { symbol: string; metric: string; ts: number; value: number }

/**
 * The whole transform, as a pure function, so the test can drive it without a
 * database or a network. `csv` is the decompressed file body.
 */
export function transform(symbol: string, csv: string, fileDate?: string): Sample[] {
  return transformDetailed(symbol, csv, fileDate).samples;
}

/**
 * As `transform`, but also reports how many 5-minute buckets the file held and
 * how many cells were BLANK per column.
 *
 * Blank cells are real and not rare: 2,273,616 across the archive, and they are
 * concentrated in 2022 — that year is 87.2% empty for both top-trader columns
 * and 35.0% empty for the taker ratio, against ~0% from 2023 on. They are
 * SKIPPED rather than written as 0 or NaN, because absence is not a reading.
 * Counting them here is what stops that skipping from being silent.
 */
export function transformDetailed(
  symbol: string,
  csv: string,
  /**
   * The date in the filename. When given, rows belonging to a DIFFERENT day are
   * dropped, so every bucket comes from the file that owns it.
   *
   * Four files hold one row each that belongs to the next day — the same four
   * whose clocks drifted a second or two past the boundary (BNBUSDT and LTCUSDT
   * 2024-04-03, SOLUSDT 2024-04-02, LINKUSDT 2024-04-01). The next day's file
   * ALSO carries that bucket, with a DIFFERENT value: BNB open interest reads
   * 449697.58 in the earlier file against 449671.69 in its own. Without this,
   * which value survives is decided by insertion order, which is no way to pick.
   */
  fileDate?: string,
): { samples: Sample[]; buckets: number; blank: Record<string, number>; strays: number } {
  const lines = csv.trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim());
  const iTime = head.indexOf('create_time');
  if (iTime < 0) {
    throw new Error(`${symbol}: no create_time column — header was "${lines[0]}"`);
  }

  // 1. parse  2. floor  3. dedupe (last wins; duplicates are byte-identical)
  const byBucket = new Map<number, string[]>();
  let strays = 0;
  for (const line of lines.slice(1)) {
    const cell = line.split(',');
    const stamp = cell[iTime].trim();
    // `2026-08-20 00:35:00` is UTC. Date.parse needs the marker or it reads local.
    const ms = Date.parse(`${stamp.replace(' ', 'T')}Z`);
    if (!Number.isFinite(ms)) {
      throw new Error(`${symbol}: unparseable create_time "${cell[iTime]}"`);
    }
    if (fileDate !== undefined && !stamp.startsWith(fileDate)) {
      strays += 1;
      continue;
    }
    byBucket.set(Math.floor(ms / ARCHIVE_BAR_MS) * ARCHIVE_BAR_MS, cell);
  }

  // 4. shift, per metric
  const out: Sample[] = [];
  const blank: Record<string, number> = {};
  for (const [bucket, cell] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    for (const m of ARCHIVE_METRICS) {
      const i = head.indexOf(m.column);
      if (i < 0) throw new Error(`${symbol}: archive column ${m.column} is missing`);
      const value = Number(cell[i]);
      // A blank cell is absence, not a zero. Skipped, and counted so the
      // skipping shows up in the import summary instead of vanishing.
      if (cell[i] === undefined || cell[i].trim() === '' || !Number.isFinite(value)) {
        blank[m.metric] = (blank[m.metric] ?? 0) + 1;
        continue;
      }
      out.push({ symbol, metric: m.metric, ts: bucket + m.shiftBars * ARCHIVE_BAR_MS, value });
    }
  }
  return { samples: out, buckets: byBucket.size, blank, strays };
}

/** `BTCUSDT-metrics-2026-08-20.zip` -> `BTC`, matching the collector's keying. */
export const coinOf = (file: string): string =>
  path.basename(file).split('-')[0].replace(/USDT$/, '');

/** Read one .zip holding exactly one CSV. Avoids a dependency for a stored file. */
export function unzipSingle(file: string): string {
  const buf = fs.readFileSync(file);
  // End-of-central-directory -> first local header. These archives hold one
  // entry, deflated, which is the only case this needs to handle.
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig !== 0) throw new Error(`${file}: not a zip local header at offset 0`);
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const cdIdx = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const body = buf.subarray(start, cdIdx < 0 ? undefined : cdIdx);
  if (method === 0) return body.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(body).toString('utf8');
  throw new Error(`${file}: unsupported zip compression method ${method}`);
}

async function main(): Promise<void> {
  if (!DIR) throw new Error('--dir <archive-dir> is required');
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.zip'))
    .sort();
  if (files.length === 0) throw new Error(`${DIR} holds no .zip files`);
  console.log(`\nFLOW IMPORT — ${files.length} files from ${DIR}${DRY ? '  [DRY RUN]' : ''}\n`);

  // Same adapter the app uses, so the import writes through the same driver
  // the collector does rather than a second, subtly different client.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const perCoin = new Map<string, { rows: number; first: number; last: number }>();
  const short: string[] = [];
  const blankByMetric: Record<string, number> = {};
  let strayTotal = 0;
  const rowsByMetric: Record<string, number> = {};
  let buf: Sample[] = [];
  let written = 0;
  let parsed = 0;

  const flush = async (): Promise<void> => {
    if (buf.length === 0) return;
    if (!DRY) {
      const { count } = await prisma.flowSample.createMany({
        data: buf.map((s) => ({
          symbol: s.symbol,
          metric: s.metric,
          ts: new Date(s.ts),
          value: s.value,
        })),
        skipDuplicates: true,
      });
      written += count;
    }
    buf = [];
  };

  const t0 = Date.now();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const coin = coinOf(file);
    const fileDate = /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1];
    const { samples, buckets, blank, strays } = transformDetailed(
      coin,
      unzipSingle(path.join(DIR, file)),
      fileDate,
    );
    strayTotal += strays;
    if (buckets !== 288) short.push(`${file.replace('.zip', '')}:${buckets}`);
    for (const [m, n] of Object.entries(blank)) blankByMetric[m] = (blankByMetric[m] ?? 0) + n;
    for (const s of samples) rowsByMetric[s.metric] = (rowsByMetric[s.metric] ?? 0) + 1;

    const agg = perCoin.get(coin) ?? { rows: 0, first: Infinity, last: -Infinity };
    agg.rows += samples.length;
    for (const s of samples) {
      if (s.ts < agg.first) agg.first = s.ts;
      if (s.ts > agg.last) agg.last = s.ts;
    }
    perCoin.set(coin, agg);
    parsed += samples.length;

    buf.push(...samples);
    if (buf.length >= BATCH) await flush();
    if (i % 1000 === 0) {
      console.log(
        `  ${String(i).padStart(5)}/${files.length}  ${coin.padEnd(5)} ` +
          `parsed ${parsed.toLocaleString()}  ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    }
  }
  await flush();

  console.log(`\n${DRY ? 'would import' : 'imported'} ${parsed.toLocaleString()} rows` +
    `${DRY ? '' : `, ${written.toLocaleString()} new`} in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  console.table(
    [...perCoin.entries()].sort().map(([coin, a]) => ({
      coin,
      rows: a.rows,
      'per metric': a.rows / ARCHIVE_METRICS.length,
      first: new Date(a.first).toISOString().slice(0, 16),
      last: new Date(a.last).toISOString().slice(0, 16),
    })),
  );
  console.log('\nper metric — written vs blank in the archive');
  console.table(
    ARCHIVE_METRICS.map((m) => {
      const rows = rowsByMetric[m.metric] ?? 0;
      const blank = blankByMetric[m.metric] ?? 0;
      return {
        metric: m.metric,
        'archive column': m.column,
        shift: `+${m.shiftBars}`,
        rows,
        blank,
        'blank%': `${((100 * blank) / (rows + blank || 1)).toFixed(1)}%`,
      };
    }),
  );
  console.log(`\nrows dropped as belonging to another day: ${strayTotal}`);
  console.log(`files with fewer than 288 buckets: ${short.length} (imported as-is)`);
  console.log(short.join(' '));
  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
