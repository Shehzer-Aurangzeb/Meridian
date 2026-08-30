/**
 * Import Binance's order-book depth archive into `FlowSample`.
 *
 *   npx ts-node --transpile-only scripts/book-depth-import.ts --dir <dir> --fetch
 *   npx ts-node --transpile-only scripts/book-depth-import.ts --dir <dir> --dry-run
 *   npx ts-node --transpile-only scripts/book-depth-import.ts --dir <dir> --fetch \
 *     --coins BTC --from 2026-08-01 --to 2026-08-03
 *
 * `data.binance.vision/data/futures/um/daily/bookDepth/` publishes a snapshot of
 * resting order-book depth every 30 seconds, from 2023-01-01, free and without a
 * key — the same bucket the metrics archive comes from. Twelve rows per
 * snapshot: cumulative `depth` and `notional` at ±0.2%, ±1%, ±2%, ±3%, ±4% and
 * ±5% of mid. Negative is below mid, so bids; positive is asks.
 *
 * Book imbalance is the one input class here that is genuine microstructure, is
 * not visible on a retail screen, and is orthogonal to everything tested so far.
 * It costs about 566 KB/day/coin compressed — roughly 6.7 GB for ten coins over
 * the full history, against ~440 GB for `aggTrades`.
 *
 * ─── This one fetches, unlike flow-import ────────────────────────────────
 * ROADMAP §8 records that the metrics fetch script "lives with the probe
 * artefacts, not in the repo", and that rebuilding the local archive from
 * nothing therefore starts with a missing step. This script does not repeat
 * that: `--fetch` downloads what it needs, skips what is already on disk, and
 * verifies every file against its published .CHECKSUM before reading it.
 */
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { unzipSingle } from './flow-import';
import { ARCHIVE_BAR_MS } from '../src/flow/flow-collector.service';

const BASE = 'https://data.binance.vision/data/futures/um/daily/bookDepth';
/** The archive starts here. Asking for earlier dates returns 404s. */
export const BOOK_DEPTH_START = '2023-01-01';

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

/**
 * What one snapshot becomes.
 *
 * Three metrics, not twelve. The bands are cumulative and therefore heavily
 * correlated — 1%, 2%, 3% and 4% are close to interpolations between the two
 * ends — and every extra feature raises the bar its survivors must clear. So the
 * near band and the far band, which is the contrast that actually differs, plus
 * one liquidity level to normalise against.
 */
export const NEAR_PCT = 0.2;
export const FAR_PCT = 5;

export interface Sample { symbol: string; metric: string; ts: number; value: number }

interface Snapshot { bidNear: number; askNear: number; bidFar: number; askFar: number }

/**
 * Bid share of the book: 0.5 is balanced, above 0.5 is more resting size below
 * mid than above it.
 *
 * A side reading exactly zero is kept, not skipped. The archive publishes all
 * twelve bands on every snapshot, so a zero is "no resting size in this band",
 * which is a real and extreme reading rather than a missing one — and within
 * 0.2% of mid on a thin coin it will happen. Null is reserved for BOTH sides
 * empty, which is the only case that is genuinely unreadable.
 */
const share = (bid: number, ask: number): number | null =>
  bid + ask > 0 ? bid / (bid + ask) : null;

/**
 * One day's CSV to `FlowSample` rows, bucketed to five minutes.
 *
 * ─── Two decisions that would be invisible if they were wrong ────────────
 *
 * 1. STAMPED AT THE END OF THE BUCKET. A snapshot at 00:00:06 is known at
 *    00:00:06, but the five-minute bucket covering 00:00–00:05 is only complete
 *    at 00:05. Stamping it 00:00 would make the whole bucket readable five
 *    minutes before it finished, which is the same look-ahead that
 *    `ARCHIVE_METRICS.shiftBars` exists to remove from the metrics archive. The
 *    live convention is "stamped when known", and this matches it.
 *
 * 2. MEAN OF RATIOS, NOT RATIO OF SUMS. These are STATE snapshots, not flows:
 *    each one is an equally valid reading of how the book looked, so the
 *    bucket's value is the average reading. Summing notional across snapshots
 *    and dividing once would weight the bucket toward whichever moments the book
 *    happened to be deepest. The distinction is not academic here — the same
 *    choice on the taker ratio moves the number by 13.9% at the median (ROADMAP
 *    §8), which is why the metric name says which window it covers and this
 *    comment says which average it is.
 */
export function transform(symbol: string, csv: string, fileDate?: string): Sample[] {
  const lines = csv.trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim());
  const iTime = head.indexOf('timestamp');
  const iPct = head.indexOf('percentage');
  const iNotional = head.indexOf('notional');
  if (iTime < 0 || iPct < 0 || iNotional < 0) {
    throw new Error(`${symbol}: bookDepth header changed — got "${lines[0]}"`);
  }

  // Gather the four numbers each snapshot contributes, keyed by its own instant.
  const snaps = new Map<number, Snapshot>();
  for (const line of lines.slice(1)) {
    const cell = line.split(',');
    const stamp = cell[iTime].trim();
    if (fileDate !== undefined && !stamp.startsWith(fileDate)) continue;
    // `2026-08-20 00:00:06` is UTC. Date.parse needs the marker or it reads local.
    const ms = Date.parse(`${stamp.replace(' ', 'T')}Z`);
    const pct = Number(cell[iPct]);
    const notional = Number(cell[iNotional]);
    if (!Number.isFinite(ms) || !Number.isFinite(pct) || !Number.isFinite(notional)) continue;

    const abs = Math.abs(pct);
    if (abs !== NEAR_PCT && abs !== FAR_PCT) continue;
    let s = snaps.get(ms);
    if (!s) snaps.set(ms, (s = { bidNear: 0, askNear: 0, bidFar: 0, askFar: 0 }));
    // Negative percentage is below mid, which is the bid side.
    if (abs === NEAR_PCT) {
      if (pct < 0) s.bidNear = notional;
      else s.askNear = notional;
    } else if (pct < 0) s.bidFar = notional;
    else s.askFar = notional;
  }

  // Average each bucket's readings, then stamp the bucket at its END.
  const buckets = new Map<number, { near: number[]; far: number[]; depth: number[] }>();
  for (const [ms, s] of snaps) {
    const near = share(s.bidNear, s.askNear);
    const far = share(s.bidFar, s.askFar);
    if (near === null || far === null) continue;
    const key = Math.floor(ms / ARCHIVE_BAR_MS) * ARCHIVE_BAR_MS + ARCHIVE_BAR_MS;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { near: [], far: [], depth: [] }));
    b.near.push(near);
    b.far.push(far);
    b.depth.push(s.bidFar + s.askFar);
  }

  const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
  const out: Sample[] = [];
  for (const [ts, b] of [...buckets.entries()].sort((a, x) => a[0] - x[0])) {
    out.push({ symbol, metric: 'bookImbalanceNear', ts, value: mean(b.near) });
    out.push({ symbol, metric: 'bookImbalanceFar', ts, value: mean(b.far) });
    out.push({ symbol, metric: 'bookDepthNotional', ts, value: mean(b.depth) });
  }
  return out;
}

/** Every date from `from` to `to` inclusive, as `YYYY-MM-DD`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** GET to a Buffer, following one redirect. 404 returns null rather than throwing. */
function getOnce(url: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        return resolve(null);
      }
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(getOnce(res.headers.location as string));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url}: HTTP ${res.statusCode}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    // Without this a stalled socket hangs the whole run rather than failing it.
    req.setTimeout(30_000, () => req.destroy(new Error(`${url}: timed out`)));
    req.on('error', reject);
  });
}

/**
 * The same GET, retried.
 *
 * A single `read ETIMEDOUT` killed the first full run at 8% — 1,070 files in,
 * about half an hour of downloading thrown away. Over 13,362 files and several
 * hours a transient network error is not an edge case, it is a certainty, so
 * surviving one is the difference between a job that finishes and a job that
 * has to be babysat.
 *
 * A 404 is NOT retried: Binance has genuine holes in the record, and re-asking
 * three times does not fill one.
 */
async function get(url: string, attempts = 4): Promise<Buffer | null> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await getOnce(url);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
}

/**
 * Download one day, verified against its published checksum.
 *
 * A file already on disk is left alone, so an interrupted fetch resumes by being
 * run again. A missing day resolves to null: Binance has real holes, and a hole
 * is a fact about the record rather than an error.
 */
async function fetchDay(dir: string, pair: string, date: string): Promise<string | null> {
  const name = `${pair}-bookDepth-${date}.zip`;
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return dest;

  const zip = await get(`${BASE}/${pair}/${name}`);
  if (zip === null) return null;

  // The .CHECKSUM is "<sha256>  <filename>". Verified before the bytes are
  // trusted, because a truncated download parses as a short file rather than
  // failing, and a short file imports as a quiet hole in the series.
  const sumFile = await get(`${BASE}/${pair}/${name}.CHECKSUM`);
  if (sumFile) {
    const want = sumFile.toString('utf8').trim().split(/\s+/)[0];
    const got = crypto.createHash('sha256').update(zip).digest('hex');
    if (want !== got) throw new Error(`${name}: checksum ${got} != published ${want}`);
  }

  fs.writeFileSync(dest, zip);
  return dest;
}

/**
 * Download everything missing, several at a time.
 *
 * The archive is ONE FILE PER COIN PER DAY, so ten coins over 1,337 days is
 * 13,362 files and 26,724 requests counting checksums. Sequentially that is
 * about five and a half hours, and every second of it is latency rather than
 * work — the CPU sits at zero.
 *
 * Fetching is therefore split from importing and run with a small pool. The
 * import stays sequential and reads from disk, which also means a fetch failure
 * cannot leave a half-written batch in the database.
 *
 * ponytail: a fixed pool of eight, not a rate-limiter. S3 does not throttle at
 * this scale and the job runs once. Lower it if a future run starts seeing 503s.
 */
async function fetchAll(
  dir: string,
  jobs: Array<{ pair: string; date: string }>,
  concurrency: number,
): Promise<void> {
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= jobs.length) return;
      await fetchDay(dir, jobs[i].pair, jobs[i].date);
      done += 1;
      if (done % 500 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(
          `  fetched ${done}/${jobs.length}  ${rate.toFixed(1)}/s  ` +
            `eta ${(((jobs.length - done) / rate) / 60).toFixed(0)}m`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function main(): Promise<void> {
  if (!DIR) throw new Error('--dir <dir> is required');
  fs.mkdirSync(DIR, { recursive: true });
  if (FROM < BOOK_DEPTH_START) {
    throw new Error(`--from ${FROM} is before the archive start ${BOOK_DEPTH_START}`);
  }

  const dates = datesBetween(FROM, TO);
  console.log(
    `\nBOOK DEPTH IMPORT — ${COINS.length} coins x ${dates.length} days` +
      `${FETCH ? ' [FETCH]' : ''}${DRY ? ' [DRY RUN]' : ''}\n`,
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  let buf: Sample[] = [];
  let parsed = 0;
  let written = 0;
  const missing: string[] = [];
  const perCoin = new Map<string, { rows: number; days: number }>();

  const flush = async (): Promise<void> => {
    if (buf.length === 0 || DRY) {
      buf = [];
      return;
    }
    const { count } = await prisma.flowSample.createMany({
      data: buf.map((s) => ({ symbol: s.symbol, metric: s.metric, ts: new Date(s.ts), value: s.value })),
      skipDuplicates: true,
    });
    written += count;
    buf = [];
  };

  const t0 = Date.now();

  // Download first, in parallel, then import from disk. Splitting the two is
  // what makes the run finish in under an hour instead of five and a half.
  if (FETCH) {
    const jobs = COINS.flatMap((c) =>
      dates.map((date) => ({ pair: `${c.toUpperCase()}USDT`, date })),
    ).filter((j) => !fs.existsSync(path.join(DIR, `${j.pair}-bookDepth-${j.date}.zip`)));
    console.log(`fetching ${jobs.length} missing files with ${CONCURRENCY} workers\n`);
    await fetchAll(DIR, jobs, CONCURRENCY);
    console.log(`\nfetch done in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}m\n`);
  }

  for (const coin of COINS) {
    const pair = `${coin.toUpperCase()}USDT`;
    for (const date of dates) {
      const p = path.join(DIR, `${pair}-bookDepth-${date}.zip`);
      const file = fs.existsSync(p) ? p : null;
      if (file === null) {
        missing.push(`${coin}:${date}`);
        continue;
      }

      const samples = transform(coin.toUpperCase(), unzipSingle(file), date);
      parsed += samples.length;
      const agg = perCoin.get(coin) ?? { rows: 0, days: 0 };
      agg.rows += samples.length;
      agg.days += 1;
      perCoin.set(coin, agg);

      buf.push(...samples);
      if (buf.length >= BATCH) await flush();
    }
    await flush();
    const a = perCoin.get(coin);
    console.log(
      `  ${coin.padEnd(5)} ${String(a?.days ?? 0).padStart(5)} days  ` +
        `${(a?.rows ?? 0).toLocaleString().padStart(10)} rows  ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }
  await flush();

  console.log(
    `\n${DRY ? 'would import' : 'imported'} ${parsed.toLocaleString()} rows` +
      `${DRY ? '' : `, ${written.toLocaleString()} new`} in ` +
      `${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  // Named, not swallowed. A day Binance never published is a hole in the market
  // record, and one that stays invisible becomes a gap somebody later reads as
  // a quiet book.
  console.log(`days with no file: ${missing.length}`);
  if (missing.length > 0) console.log(missing.slice(0, 40).join(' '));

  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
