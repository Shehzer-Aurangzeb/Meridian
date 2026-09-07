/**
 * Layer 4's measurable bars: latency, and the no-direction check on the
 * narrator prompt.
 *
 *   pnpm --filter api layer4-bars
 *
 * Bar 4b (the API contract) is covered by `src/map/map.contract.spec.ts`,
 * which runs in the normal suite — a contract that only holds when someone
 * remembers to run a manual script is not a contract.
 *
 * Bar 4a (the misreading test) CANNOT be run here. It requires showing the
 * screen to a person who has not read the design document and asking what it
 * tells them. This file measures what a machine can measure and says plainly
 * that 4a is outstanding rather than inventing a proxy and calling it a pass.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { MapService } from '../../src/map/map.service';
import { MapNarrationService } from '../../src/ai/map-narration.service';
import { findDirectionalLanguage } from '../../src/ai/direction-guard';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const SYMBOL = str('symbol', 'BTC');
const RUNS = num('runs', 10);
/** The Lambda ceiling. Not a target — a wall the request dies against. */
const LAMBDA_CEILING_MS = 120_000;
/** What "well inside" means, declared before the run. */
const BAR_P95_MS = num('bar-p95', 30_000);

async function main(): Promise<void> {
  Logger.overrideLogger(['error', 'warn']);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const map = app.get(MapService);
  const narration = app.get(MapNarrationService);

  console.log('\nLAYER 4 — MEASURABLE BARS');
  console.log(`4d  GET /map/:symbol p95 well inside the ${LAMBDA_CEILING_MS / 1000}s Lambda ceiling`);
  console.log(`    declared: p95 under ${BAR_P95_MS / 1000}s on a warm process\n`);

  // ── 4d: latency ──
  //
  // Two populations, reported apart, because conflating them answers neither
  // question. Assembly time is ours to control. Time spent inside a retry
  // after Binance rate-limits us is an upstream property, and hammering the
  // API in a tight loop provokes it in a way real traffic does not — the
  // schedule runs three times a day.
  console.log(`── 4d: latency for ${SYMBOL} ──`);
  console.log('  warming the candle cache (5-minute TTL) with one call first');
  let built: Awaited<ReturnType<MapService['build']>> | null = null;
  try {
    const t = Date.now();
    built = await map.build(SYMBOL);
    console.log(`  cold call: ${Date.now() - t}ms`);
  } catch (err) {
    console.log(`  cold call FAILED: ${(err as Error).message}`);
  }

  const timings: number[] = [];
  let stalled = 0;
  let failed = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const t = Date.now();
    try {
      built = await map.build(SYMBOL);
      const ms = Date.now() - t;
      timings.push(ms);
      // An upstream stall, not assembly: nothing in this service computes for
      // ten seconds, so anything past it was spent waiting on Binance.
      if (ms > 10_000) stalled += 1;
    } catch (err) {
      failed += 1;
      console.log(`  call ${i + 1} FAILED: ${(err as Error).message}`);
    }
  }

  let pass4d = false;
  if (timings.length === 0) {
    console.log('  every call failed — cannot measure');
  } else {
    const sorted = [...timings].sort((a, b) => a - b);
    const p = (xs: number[], q: number): number => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
    const clean = sorted.filter((ms) => ms <= 10_000);

    console.log(`\n  ALL calls        n=${sorted.length}  p50 ${p(sorted, 0.5)}ms  p95 ${p(sorted, 0.95)}ms  max ${sorted[sorted.length - 1]}ms`);
    if (clean.length > 0) {
      console.log(`  assembly only    n=${clean.length}  p50 ${p(clean, 0.5)}ms  p95 ${p(clean, 0.95)}ms  max ${clean[clean.length - 1]}ms`);
    }
    console.log(`  upstream stalls  ${stalled} of ${sorted.length} calls exceeded 10s waiting on Binance; ${failed} failed outright`);

    pass4d = clean.length > 0 && p(clean, 0.95) < BAR_P95_MS && stalled === 0;
    console.log(`  4d: ${pass4d ? 'PASS' : 'FAIL'}`);
    console.log(
      `  assembly p95 uses ${clean.length > 0 ? ((p(clean, 0.95) / LAMBDA_CEILING_MS) * 100).toFixed(2) : '-'}% of the ${LAMBDA_CEILING_MS / 1000}s ceiling.`,
    );
    console.log(
      '  NOTE: a warm local process, not a deployed Lambda — a cold start adds container\n' +
        '  pull and Nest boot. And a tight loop provokes rate limiting that three scheduled\n' +
        '  runs a day would not, so the stall count is a worst case, not an expectation.',
    );
  }

  // ── 4c: the prompt itself must not smuggle a direction in ──
  console.log('\n── 4c: the narrator prompt states no direction ──');
  let pass4c = false;
  if (!built) {
    console.log('  no map to narrate');
  } else {
    const prompt = narration.buildPrompt(built);
    // The prompt QUOTES forbidden phrases in order to forbid them, so the
    // guard is run against the data section only — the part that would be
    // repeated back by a model reading it.
    const dataStart = prompt.indexOf('# THE MAP');
    const dataEnd = prompt.indexOf('# HOW TO WRITE');
    const data = prompt.slice(dataStart, dataEnd);
    const found = findDirectionalLanguage(data);
    console.log(`  prompt data section: ${data.length.toLocaleString()} chars`);
    console.log(`  directional phrases found: ${found.length}`);
    for (const f of found.slice(0, 5)) console.log(`    "${f.phrase}" (${f.category})`);
    pass4c = found.length === 0;
    console.log(`  4c (prompt side): ${pass4c ? 'PASS' : 'FAIL'}`);
    console.log(
      '  The output side is enforced at runtime by assertNoDirection(), which DISCARDS ' +
        'a narration that states a direction. Its unit tests cover 19 cases including 12 ' +
        'phrases that must NOT trip it.',
    );
  }

  console.log('\n── 4a: the misreading test ──');
  console.log('  OUTSTANDING — requires a human subject and cannot be self-certified.');
  console.log('  Procedure: show the map screen to someone who has not read the design');
  console.log('  document. Ask what it tells them. If they state a direction, a target or');
  console.log('  an entry, the layer has failed.');

  console.log('\n── verdict ──');
  console.log(`4a NOT RUN (needs a person)   4b see map.contract.spec.ts   4c ${pass4c ? 'PASS' : 'FAIL'}   4d ${pass4d ? 'PASS' : 'FAIL'}`);

  await app.close();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
