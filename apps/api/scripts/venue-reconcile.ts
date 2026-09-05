/**
 * Reconcile the stored venue series against a fresh fetch.
 *
 *   pnpm --filter api venue-reconcile --days 30
 *
 * Refetches the last N days from OKX and Bybit and compares, row by row,
 * against what `venue-backfill` wrote. Reports how many stored rows have no
 * live counterpart, how many differ, and by how much.
 *
 * ─── Why this is not paranoia ────────────────────────────────────────────
 * The whole cross-venue idea rests on a spread of a few basis points being
 * information. An hour of misalignment between venues manufactures a spread out
 * of ordinary drift, and it would look exactly like signal: real, stable, and
 * strongest when the market moves. This project has already had one metric
 * silently stamped an hour early, which is the reason `flowAsOf` exists.
 *
 * A price difference of a few bp between venues is REAL. A difference of tens
 * of bp on the same instant is a bug. This prints the distribution rather than a
 * pass/fail so the two are distinguishable.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const HOUR = 3_600_000;
const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const COINS = str('coins', 'BTC,ETH,SOL,LINK,LTC').split(',');
const DAYS = num('days', 30);
/** Above this, a mismatch is a bug rather than a venue difference. */
const TOLERANCE_BP = num('tolerance-bp', 1);

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'meridian-research/1.0' } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

/** Live rows as ts(close-stamped) -> value, matching what the backfill stores. */
async function live(metric: string, coin: string, since: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (metric === 'okxClose') {
    // 300 rows a page, walking back until `since` is covered.
    let cursor = Date.now();
    for (let i = 0; i < 20 && cursor > since; i += 1) {
      const body = (await getJson(
        `https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT-SWAP&bar=1H&after=${cursor}&limit=300`,
      )) as { data?: string[][] };
      const rows = body.data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) if (r[8] === '1') out.set(Number(r[0]) + HOUR, Number(r[4]));
      cursor = Math.min(...rows.map((r) => Number(r[0])));
    }
  } else if (metric === 'bybitClose') {
    let cursor = Date.now();
    for (let i = 0; i < 20 && cursor > since; i += 1) {
      const body = (await getJson(
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=${coin}USDT&interval=60&end=${cursor}&limit=1000`,
      )) as { result?: { list?: string[][] } };
      const rows = body.result?.list ?? [];
      if (rows.length === 0) break;
      for (const r of rows) out.set(Number(r[0]) + HOUR, Number(r[4]));
      cursor = Math.min(...rows.map((r) => Number(r[0]))) - HOUR;
    }
  } else {
    throw new Error(`reconcile: no live fetcher for ${metric}`);
  }
  return out;
}

async function main(): Promise<void> {
  const since = Date.now() - DAYS * 24 * HOUR;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(`\nVENUE RECONCILE — last ${DAYS} days, ${COINS.length} coins`);
  console.log(`a difference over ${TOLERANCE_BP} bp on the same instant is a bug, not a spread\n`);
  console.log(`${'coin'.padEnd(6)}${'metric'.padEnd(12)}${'stored'.padStart(8)}${'live'.padStart(8)}${'matched'.padStart(9)}${'missing'.padStart(9)}${'>tol'.padStart(6)}  worst`);

  let worstAll = 0;
  let missingAll = 0;
  for (const coin of COINS) {
    for (const metric of ['okxClose', 'bybitClose']) {
      const stored = await prisma.flowSample.findMany({
        where: { symbol: coin.toUpperCase(), metric, ts: { gte: new Date(since) } },
        select: { ts: true, value: true },
      });
      const liveRows = await live(metric, coin.toUpperCase(), since);

      let matched = 0;
      let missing = 0;
      let over = 0;
      let worst = 0;
      for (const row of stored) {
        const l = liveRows.get(row.ts.getTime());
        if (l === undefined) {
          missing += 1;
          continue;
        }
        matched += 1;
        const bp = Math.abs((row.value - l) / l) * 1e4;
        if (bp > worst) worst = bp;
        if (bp > TOLERANCE_BP) over += 1;
      }
      worstAll = Math.max(worstAll, worst);
      missingAll += missing;
      console.log(
        `${coin.padEnd(6)}${metric.padEnd(12)}${String(stored.length).padStart(8)}` +
          `${String(liveRows.size).padStart(8)}${String(matched).padStart(9)}` +
          `${String(missing).padStart(9)}${String(over).padStart(6)}  ${worst.toFixed(3)} bp`,
      );
    }
  }

  console.log(
    `\nworst single mismatch ${worstAll.toFixed(3)} bp · ${missingAll} stored rows with no live counterpart`,
  );
  console.log(
    worstAll <= TOLERANCE_BP
      ? 'PASS — stored values reproduce from the live API at the same instants.'
      : `FAIL — a stored row differs from live by more than ${TOLERANCE_BP} bp. Check the timestamp convention before trusting any spread.`,
  );

  await prisma.$disconnect();
  await pool.end();
  if (worstAll > TOLERANCE_BP) process.exit(1);
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
