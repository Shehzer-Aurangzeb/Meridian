/**
 * Post-import verification: does what is IN the database match the live API?
 *
 *   npx ts-node --transpile-only scripts/flow-verify.ts --live <live.json.gz>
 *
 * This is the check that the importer did what the reconciliation said. After
 * the shift is applied at import, a stored row and a live row for the same
 * metric MUST carry the same timestamp — no offset, no allowance. If the shift
 * were dropped, mis-signed, or applied to the wrong column, the rows would miss
 * by one 5-minute bar and this reports it as a mismatch rather than a warning.
 *
 * Tolerance is the one Phase 1 measured over 82,850 comparisons per column:
 * open interest is bit-exact, the ratios agree to ~3e-4 because the live API
 * serves 4 decimal places against the archive's 8.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as zlib from 'zlib';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ARCHIVE_METRICS } from '../src/flow/flow-collector.service';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIVE = str('live', '');
/** Phase 1's measured ceiling per column, plus headroom. Not a guess. */
const TOL: Record<string, number> = {
  openInterest: 0,
  openInterestValue: 0,
  longShortRatio: 1e-3,
  topTraderAccountRatio: 1e-3,
  topTraderPositionRatio: 1e-3,
  takerBuySellRatio5m: 1e-2,
};

async function main(): Promise<void> {
  if (!LIVE) throw new Error('--live <live.json.gz> is required');
  const live = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(LIVE)).toString('utf8'),
  ) as Record<string, Record<string, string>>;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const byColumn = Object.fromEntries(ARCHIVE_METRICS.map((m) => [m.column, m]));
  const rows: Array<Record<string, string | number>> = [];
  let worstRel = 0;
  let failures = 0;

  for (const key of Object.keys(live)) {
    const [pair, column] = key.split('|');
    const spec = byColumn[column];
    if (!spec) continue;
    const coin = pair.replace(/USDT$/, '');
    const points = live[key];
    const stamps = Object.keys(points).map(Number).sort((a, b) => a - b);
    if (stamps.length === 0) continue;

    const stored = await prisma.flowSample.findMany({
      where: {
        symbol: coin,
        metric: spec.metric,
        ts: { gte: new Date(stamps[0]), lte: new Date(stamps[stamps.length - 1]) },
      },
      select: { ts: true, value: true },
    });
    const db = new Map(stored.map((r) => [r.ts.getTime(), r.value]));

    let compared = 0;
    let bad = 0;
    let maxRel = 0;
    let missing = 0;
    for (const t of stamps) {
      const got = db.get(t);
      if (got === undefined) {
        missing += 1;
        continue;
      }
      const want = Number(points[String(t)]);
      const rel = want === got ? 0 : Math.abs(want - got) / Math.max(Math.abs(want), Math.abs(got), 1e-12);
      compared += 1;
      if (rel > maxRel) maxRel = rel;
      if (rel > TOL[spec.metric]) bad += 1;
    }
    if (maxRel > worstRel) worstRel = maxRel;
    failures += bad;
    rows.push({
      coin,
      metric: spec.metric,
      live: stamps.length,
      compared,
      'not in db': missing,
      mismatched: bad,
      'max rel': maxRel.toExponential(1),
      verdict: bad === 0 ? 'PASS' : 'FAIL',
    });
  }

  console.table(rows);
  console.log(`\nworst relative difference anywhere: ${worstRel.toExponential(2)}`);
  console.log(`rows outside tolerance: ${failures}`);
  await prisma.$disconnect();
  await pool.end();
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
