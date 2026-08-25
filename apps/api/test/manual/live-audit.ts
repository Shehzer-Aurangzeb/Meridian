/**
 * What the live system has actually done since it went live.
 *
 *   npx ts-node --transpile-only test/manual/live-audit.ts
 *
 * Reads saved analyses straight from the production database and scores each
 * one with the SAME code the website uses, against real price history anchored
 * at each analysis. Read-only — nothing is written anywhere.
 *
 * The market control at the end is the important part: a losing fortnight in a
 * violent rally says something different from a losing fortnight in a flat one.
 */
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config({ path: '.env.production' });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { scoreTrade, TradeScore } from '../../src/common/replay/trade-scoring';
import {
  FILL_WINDOW_HOURS, MAX_HOLD_HOURS, OUTCOME_WINDOW_HOURS, DEFAULT_ROUND_TRIP_PCT,
} from '../../src/analysis-coordinator/outcome';
import { leadPlan } from '../../src/analysis-coordinator/verdict';
import type { AnalysisRecord } from '../../src/analysis-coordinator/analyze.service';
import type { TradePlan } from '../../src/analysis/services/trade-plan.service';

Logger.overrideLogger(false);
const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

const SINCE = new Date(process.argv[2] ?? '2026-08-16T00:00:00Z');
const CFG = { fillBars: FILL_WINDOW_HOURS, maxBars: MAX_HOLD_HOURS, breakevenAfterTarget: 1, roundTripPct: DEFAULT_ROUND_TRIP_PCT };
const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const mean = (x: number[]) => (x.length ? sum(x) / x.length : NaN);
const pct = (a: number, b: number) => `${f((100 * a) / b, 0)}%`;

interface Rec { coin: string; dir: 'long' | 'short'; lead: boolean; up: boolean; s: TradeScore; nTargets: number; }

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const binance = new BinanceService(cache, new CacheTelemetryService());

  const rows = await prisma.coordinatorRun.findMany({
    where: { createdAt: { gte: SINCE } },
    orderBy: { createdAt: 'asc' },
    select: { symbol: true, createdAt: true, coordinatorPayload: true, errorMessage: true },
  });

  const recs: Rec[] = [];
  let noPlan = 0, noZones = 0, failed = 0, missed = 0;
  const CONC = 8;
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(rows.slice(i, i + CONC).map(async (row) => {
      const a = row.coordinatorPayload as AnalysisRecord | null;
      if (row.errorMessage) { failed += 1; return; }
      if (!a?.map?.zones?.length) { noZones += 1; return; }
      if (!a.plans?.length) { noPlan += 1; return; }
      const k = await binance.getCandlesFrom(row.symbol, '1h', row.createdAt.getTime(), OUTCOME_WINDOW_HOURS + 2).catch(() => []);
      const fwd = k.filter((c) => c.time.getTime() > row.createdAt.getTime());
      if (fwd.length < 20) return;
      const lead = leadPlan(a.plans);
      const m = a.regime?.metrics;
      const up = m ? m.pdi > m.mdi : true;
      for (const p of a.plans as TradePlan[]) {
        const s = scoreTrade(fwd, p, CFG);
        if (!s.filled) { if (p === lead) missed += 1; continue; }
        recs.push({ coin: row.symbol, dir: p.direction, lead: p === lead, up, s, nTargets: p.targets.length });
      }
    }));
    process.stdout.write(`\r  ${Math.min(i + CONC, rows.length)}/${rows.length}`);
  }

  const L = recs.filter((r) => r.lead);
  const R = (xs: Rec[]) => xs.map((x) => x.s.netR);
  const stops = (xs: Rec[]) => xs.filter((x) => x.s.status === 'STOPPED');
  const line = (label: string, xs: Rec[]) =>
    console.log(`${label.padEnd(24)} ${String(xs.length).padStart(4)}  ${f(sum(R(xs)), 2).padStart(8)}  ${f(mean(R(xs))).padStart(8)}   ${xs.length ? pct(stops(xs).length, xs.length) : '—'}`);

  console.log(`\n\n${rows.length} analyses since ${SINCE.toISOString().slice(0, 10)}`);
  console.log(`  produced no plan  ${noPlan}   (no zones at all: ${noZones}, failed runs: ${failed})`);
  console.log(`  lead plan never reached its entry  ${missed}`);

  console.log('\narm                     opened     total      mean   stopped');
  line('LEAD PLAN (the badge)', L);
  const closed = L.filter((r) => r.s.status !== 'TIMEOUT');
  console.log(`  of which closed        ${String(closed.length).padStart(4)}  ${f(sum(R(closed)), 2).padStart(8)}  ${f(mean(R(closed))).padStart(8)}`);
  line('long only', recs.filter((r) => r.dir === 'long'));
  line('short only', recs.filter((r) => r.dir === 'short'));
  line('both plans, every one', recs);
  line('with the trend', recs.filter((r) => (r.dir === 'long') === r.up));
  line('against the trend', recs.filter((r) => (r.dir === 'long') !== r.up));

  console.log('\nhow deep price went into the zone before turning:');
  console.log('  steps filled    n   stopped   mean netR   median hours held');
  for (const n of [1, 2, 3]) {
    const g = L.filter((r) => r.s.legsFilled === n);
    if (!g.length) continue;
    const h = g.map((r) => r.s.barsHeld).sort((a, b) => a - b);
    console.log(`       ${n}        ${String(g.length).padStart(3)}   ${pct(stops(g).length, g.length).padStart(5)}     ${f(mean(R(g))).padStart(7)}          ${h[Math.floor(h.length / 2)]}`);
  }

  console.log('\nby coin, worst first:');
  const byCoin = [...new Set(L.map((r) => r.coin))]
    .map((c) => [c, L.filter((r) => r.coin === c)] as const)
    .sort((a, b) => sum(R(a[1])) - sum(R(b[1])));
  for (const [c, g] of byCoin) line(`  ${c}`, g);

  console.log('\nwhat the market itself did over the window:');
  for (const c of byCoin.slice(0, 4).map(([c]) => c)) {
    const k = await binance.getCandlesFrom(c, '1h', SINCE.getTime(), 24 * 20);
    console.log(`  ${c.padEnd(6)} ${f(((k[k.length - 1].close - k[0].open) / k[0].open) * 100, 1).padStart(6)}%`);
  }

  await prisma.$disconnect();
  await pool.end();
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
