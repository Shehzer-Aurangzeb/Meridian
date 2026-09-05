/**
 * Backfill named flow metrics into the LOCAL database, over a long window.
 *
 *   npx ts-node --transpile-only scripts/flow-backfill.ts \
 *     --metrics fundingRate,premium --days 2200
 *
 * ─── Why this exists ─────────────────────────────────────────────────────
 * The collector runs on a schedule against PRODUCTION. Every experiment runs
 * against LOCAL. The two are not replicas — ROADMAP §8 says so — and the
 * consequence is easy to miss: adding a metric to `METRICS` starts it
 * accumulating in Neon and leaves local with nothing at all.
 *
 * That is exactly what happened to `fundingRate`. It was added to the collector
 * on 30 Aug and a panel built the same day would have had an empty column,
 * which does not fail — it quietly shrinks the sample the feature is measured
 * on, and effective sample size is already the tightest constraint here.
 *
 * ─── What it will and will not recover ───────────────────────────────────
 * Binance keeps `fundingRate` and `premiumIndexKlines` for years, so those are
 * recoverable to any depth. `takerBuySellRatio1h` is NOT: ~30 days of live
 * retention and no archive column. Asking for more than 30 days of it just
 * returns 30.
 *
 * `--metrics` is required rather than defaulted. Three of the eight are in the
 * bulk archive at 5-minute resolution, and a multi-year re-fetch of those is
 * hundreds of pages per coin to re-store rows the database already holds.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { FlowCollectorService, METRICS } from '../src/flow/flow-collector.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const METRIC_ARG = str('metrics', '');
const DAYS = Number(str('days', '2200'));
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');

async function main(): Promise<void> {
  if (!METRIC_ARG) {
    throw new Error(
      `--metrics is required. Known: ${METRICS.map((m) => m.metric).join(', ')}`,
    );
  }
  const wanted = METRIC_ARG.split(',');
  const unknown = wanted.filter((w) => !METRICS.some((m) => m.metric === w));
  if (unknown.length > 0) {
    throw new Error(`unknown metric(s): ${unknown.join(', ')}`);
  }

  const url = process.env.DATABASE_URL ?? '';
  // Said out loud. This script exists because the two databases got confused
  // once already, and a backfill into the wrong one is silent.
  console.log(`\nFLOW BACKFILL — ${wanted.join(', ')} · ${COINS.length} coins · ${DAYS} days`);
  console.log(`target: ${url.replace(/:\/\/[^@]*@/, '://***@')}\n`);

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const collector = new FlowCollectorService(prisma as unknown as PrismaService);

  const t0 = Date.now();
  const result = await collector.collect(COINS, DAYS, Date.now(), wanted);
  console.log(
    `\nsaved ${result.saved.toLocaleString()} new rows, ` +
      `${result.duplicates.toLocaleString()} already held, ` +
      `in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  if (Object.keys(result.failed).length > 0) {
    console.log('\nfailed:');
    for (const [k, v] of Object.entries(result.failed)) console.log(`  ${k}: ${v}`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
