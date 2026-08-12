/**
 * Forward test — scores the analyses the schedule ACTUALLY SAVED.
 *
 *   pnpm forward-test
 *   pnpm forward-test --since 2026-08-09 --draws 50
 *   pnpm forward-test --csv forward.csv
 *
 * ─── How this differs from backtest:plans ────────────────────────────────
 * `backtest:plans` rebuilds the level map as of each historical bar and scores
 * the plan the tool WOULD have printed. This scores the plans it DID print, on
 * candles that had not happened when it printed them. No sweep, no knob, no
 * hindsight — the only measurement here that is genuinely out of sample.
 *
 * The scoring itself is deliberately the same code (`scorePlans`, and through
 * it `findFirstFill` and `scoreLadder`), because a forward number computed
 * differently from §14h would not be comparable to §14h.
 *
 * ─── What this CANNOT tell you ───────────────────────────────────────────
 * A confidence interval. The unit of evidence is the month, not the trade
 * (STATE_OF_PLAY.md methodology rule 7) — ten coins moving together inside one
 * regime are closer to one observation than to a thousand. A month of schedule
 * output is ONE cluster, so this prints point estimates and no p-value. The
 * honest reading of a single month is "consistent with §14h" or "inconsistent
 * with §14h", never "proven".
 *
 * ─── Modelling choices, matched to §14h so the numbers are comparable ────
 *  1. One opportunity per zone. The same coin is analysed three times a day and
 *     re-emits the same plan on the same zone each time; counting all three
 *     triples n and makes one good zone look like three wins. A later plan is a
 *     repeat if its zone overlaps the open one and --cooldown hours have not
 *     passed. This is the standing analogue of the backtest's --cooldown.
 *  2. Cost = round-trip % / risk % — charged in R, so a 0.5% stop pays four
 *     times what a 2% stop pays.
 *  3. Control = the same plans entered at another saved analysis's timestamp,
 *     matched in count, averaged over --draws draws. Crypto trends; only the
 *     delta against this is edge, and one draw is a noisy control (rule 13).
 *  4. Open positions are marked to market, and their share is printed —
 *     9% of §14h trades carried the sign of the whole result (rule 18).
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

// Defaults to production: the schedule writes to Neon, and .env.local points at
// a localhost Postgres that is empty. Silently reading the empty one would
// print a clean zero and look like a finding.
dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'production'}` });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { AnalysisRecord } from '../../src/analysis-coordinator/analyze.service';
import {
  costR,
  FILL_WINDOW_HOURS,
  PlanResult,
  scorePlans,
} from '../../src/analysis-coordinator/outcome';
import { ConfluenceZone } from '../../src/analysis/interfaces/support-resistance.types';
import { TradePlan } from '../../src/analysis/services/trade-plan.service';
import { Candle } from '../../src/common/types/candle.types';
import { makeRng } from './rng';

Logger.overrideLogger(false);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SINCE = str('since', '');
const COOLDOWN_H = num('cooldown', 24);
// §14h held for 72 bars (1h bars, so 3 days) and closed the rest at market.
// Matched here or the two are not comparable — and §14h's whole edge over
// random flipped sign on this number alone (rule 17), so it is also printed
// uncapped, and the gap between the two is the finding.
const MAX_HOLD_H = num('max-hold', 72);
const FEE_PCT = num('fee', 0.05);
const SLIP_PCT = num('slip', 0.02);
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);
const DRAWS = num('draws', 20);
const SEED = num('seed', 12345);
const CSV = str('csv', '');

const CONFIG =
  `since=${SINCE || 'all'} cooldown=${COOLDOWN_H}h max-hold=${MAX_HOLD_H}h ` +
  `fee=${FEE_PCT}% slip=${SLIP_PCT}% (round trip ${ROUND_TRIP_PCT}%) ` +
  `draws=${DRAWS} seed=${SEED}`;

interface Row {
  id: string;
  symbol: string;
  createdAt: Date;
  analysis: AnalysisRecord;
}

interface Scored {
  id: string;
  coin: string;
  time: Date;
  direction: 'long' | 'short';
  regime: string;
  route: string;
  state: string;
  sources: number;
  riskPercent: number;
  plannedR: number;
  outcome: PlanResult['outcome'];
  /** Gross R. Null while PENDING or MISSED — there is no trade to score. */
  r: number | null;
  costR: number;
  netR: number | null;
  /** Same trade with no hold limit. §14h's edge flipped sign on this knob. */
  netRUncapped: number | null;
}

const overlaps = (a: ConfluenceZone, b: ConfluenceZone): boolean =>
  a.low <= b.high && b.low <= a.high;

/**
 * Is this plan a fresh opportunity, or the same zone re-printed?
 *
 * ponytail: cooldown measured from the previous opportunity's ANALYSIS time,
 * not from when it closed — a saved row does not record when its ladder
 * finished. At a 24h fill window the two differ only for trades that run long.
 * Track the close time in outcome.ts if that starts mattering.
 */
function isRepeat(
  plan: TradePlan,
  at: Date,
  last: { zone: ConfluenceZone; busyUntil: number } | undefined,
): boolean {
  if (!last) return false;
  return at.getTime() < last.busyUntil && overlaps(plan.zone, last.zone);
}

/**
 * When the zone is free to be counted again.
 *
 * §14h ran one position at a time per direction and started its cooldown when
 * the trade CLOSED. Measuring from the analysis time instead let a 24h window
 * expire while the trade it belonged to was still running under a 72h hold —
 * so the same zone opened a second "opportunity" while the first was live.
 *
 * ponytail: a filled plan blocks for the full hold rather than to its real
 * close, which scorePlans does not report. The bound is exact whenever the
 * capped scoring bites and conservative otherwise; return the close time from
 * outcome.ts if the difference ever shows up in the counts.
 */
function busyUntil(at: Date, result: PlanResult): number {
  const from = result.filledAt
    ? result.filledAt.getTime() + MAX_HOLD_H * 3_600_000
    : at.getTime() + FILL_WINDOW_HOURS * 3_600_000;
  return from + COOLDOWN_H * 3_600_000;
}

function score(
  row: Row,
  plan: TradePlan,
  /** Closed at the hold limit, matching §14h. */
  result: PlanResult,
  /** The same plan left running to now. The gap between the two IS the finding. */
  uncapped: PlanResult,
): Scored {
  const cost = costR(plan.riskPercent, ROUND_TRIP_PCT);
  return {
    netRUncapped: uncapped.r === null ? null : uncapped.r - cost,
    id: row.id,
    coin: row.symbol,
    time: row.createdAt,
    direction: plan.direction,
    regime: row.analysis.regime.regime,
    route: row.analysis.route,
    state: plan.state,
    sources: plan.zone.sources.length,
    riskPercent: plan.riskPercent,
    plannedR: plan.blendedR,
    outcome: result.outcome,
    r: result.r,
    costR: cost,
    netR: result.r === null ? null : result.r - cost,
  };
}

// ── self-check ──────────────────────────────────────────────────────────
// The dedup rule decides n, and n decides every number below it. Runs without
// a database or a network: `pnpm forward-test --self-check`.
function selfCheck(): void {
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`self-check FAILED: ${msg}`);
  };
  const zone = (low: number, high: number): ConfluenceZone =>
    ({ low, high }) as ConfluenceZone;
  const plan = (low: number, high: number): TradePlan =>
    ({ zone: zone(low, high) }) as TradePlan;
  const t = (hoursIn: number): Date => new Date(Date.UTC(2026, 7, 9) + hoursIn * 3_600_000);

  const result = (o: PlanResult['outcome'], filledAt: Date | null): PlanResult =>
    ({ outcome: o, filledAt }) as PlanResult;

  // Never filled: blocks for the 24h fill window plus the cooldown.
  const missed = { zone: zone(100, 110), busyUntil: busyUntil(t(0), result('MISSED', null)) };
  // Filled at hour 2 and still running: blocks until hour 2 + hold + cooldown.
  const open = { zone: zone(100, 110), busyUntil: busyUntil(t(0), result('OPEN', t(2))) };

  assert(!isRepeat(plan(100, 110), t(0), undefined), 'the first plan is never a repeat');
  assert(isRepeat(plan(100, 110), t(8), missed), 'same zone, 8h later → repeat');
  assert(isRepeat(plan(105, 115), t(8), missed), 'overlapping zone → repeat');
  assert(!isRepeat(plan(120, 130), t(8), missed), 'a different zone is a new opportunity');
  assert(
    !isRepeat(plan(100, 110), t(FILL_WINDOW_HOURS + COOLDOWN_H + 1), missed),
    'an unfilled zone is takeable again after the fill window and cooldown',
  );
  // Touching-but-not-crossing has to count as overlap, or a zone that drifts by
  // one tick between runs is counted twice.
  assert(isRepeat(plan(110, 120), t(1), missed), 'zones that touch at one price overlap');

  // The bug this rule exists for: a 24h window expiring while the trade it
  // belongs to is still open under a 72h hold.
  assert(
    isRepeat(plan(100, 110), t(COOLDOWN_H + 1), open),
    'a zone whose trade is still running is NOT a fresh opportunity',
  );
  assert(
    !isRepeat(plan(100, 110), t(2 + MAX_HOLD_H + COOLDOWN_H + 1), open),
    'it frees up once the hold and the cooldown have both passed',
  );

  // t-stat: the failure that matters is a sign flip or a silent NaN, either of
  // which would turn "significantly negative" into "looks fine".
  assert(tStat([1, 1, 1]) === null, 'zero variance has no t-stat, not Infinity');
  assert(tStat([1, 2]) === null, 'under 3 observations there is no t-stat');
  assert((tStat([-1, -1, -1, 1]) as number) < 0, 'a negative mean gives a negative t');
  // [0,1,1,2]: mean 1, sum of squared deviations 2, so sd = sqrt(2/3) with the
  // n-1 divisor and t = 1 / sqrt(2/3) * sqrt(4) = sqrt(6). Dividing by n
  // instead would give t = sqrt(8) — this is the assert that catches it.
  assert(
    Math.abs((tStat([0, 1, 1, 2]) as number) - Math.sqrt(6)) < 1e-9,
    'sd uses the n-1 divisor',
  );

  console.log(
    'self-check passed (dedup: overlap + busy-until-close, first plan always taken)',
  );
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Per-trade t-stat, mean / (sd / sqrt(n)).
 *
 * OPTIMISTIC BY CONSTRUCTION. It assumes trades are independent and they are
 * not — ten coins inside one regime move together (rule 7), so the effective
 * sample is far smaller than n and the true |t| is smaller than this one.
 *
 * That makes it useful in exactly one direction: |t| below 2 means the result
 * is not significant even BEFORE the clustering haircut, which is a real
 * finding. |t| above 2 is never proof of anything on its own.
 *
 * ponytail: no p-value. Converting t to p would imply a distribution this
 * sample does not have; bootstrap.ts is the tool for that once there are
 * enough month-clusters to resample.
 */
const tStat = (xs: number[]): number | null => {
  if (xs.length < 3) return null;
  const m = mean(xs);
  const sd = Math.sqrt(
    xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1),
  );
  return sd === 0 ? null : (m / sd) * Math.sqrt(xs.length);
};

const fmtT = (xs: number[]): string => {
  const t = tStat(xs);
  return t === null ? 't —' : `t ${t >= 0 ? '+' : ''}${t.toFixed(2)}`;
};

// Below `tStat`, not above: these are `const`, so running the check any earlier
// dies in the temporal dead zone rather than testing anything.
if (args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

/** Only filled plans have an R. PENDING and MISSED are selectivity, not returns. */
const filled = (rows: Scored[]): Scored[] => rows.filter((s) => s.netR !== null);

function summarise(label: string, rows: Scored[]): Record<string, string | number> {
  const done = filled(rows);
  const net = done.map((s) => s.netR as number);
  const wins = net.filter((r) => r > 0).length;
  return {
    group: label,
    plans: rows.length,
    filled: done.length,
    'fill%': rows.length === 0 ? '—' : `${((done.length / rows.length) * 100).toFixed(0)}%`,
    'win%': done.length === 0 ? '—' : `${((wins / done.length) * 100).toFixed(0)}%`,
    'net R': done.length === 0 ? '—' : mean(net).toFixed(3),
    'gross R': done.length === 0 ? '—' : mean(done.map((s) => s.r as number)).toFixed(3),
    'cost R': done.length === 0 ? '—' : mean(done.map((s) => s.costR)).toFixed(3),
    'planned R': done.length === 0 ? '—' : mean(done.map((s) => s.plannedR)).toFixed(2),
    'risk%': done.length === 0 ? '—' : mean(done.map((s) => s.riskPercent)).toFixed(2),
  };
}

function group(rows: Scored[], key: (s: Scored) => string): string[] {
  return [...new Set(rows.map(key))].sort();
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(`\nFORWARD TEST — scores the analyses the schedule actually saved`);
  console.log(`config  ${CONFIG}`);
  console.log(`db      ${url.replace(/\/\/[^@]*@/, '//***@').split('?')[0]}\n`);

  const rows = (await prisma.coordinatorRun.findMany({
    where: {
      errorMessage: null,
      ...(SINCE ? { createdAt: { gte: new Date(SINCE) } } : {}),
    },
    select: { id: true, symbol: true, createdAt: true, coordinatorPayload: true },
    orderBy: { createdAt: 'asc' },
  })) as unknown as Array<Omit<Row, 'analysis'> & { coordinatorPayload: AnalysisRecord }>;

  if (rows.length === 0) {
    console.log('No saved analyses. Is DATABASE_URL pointing at the deployed database?');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const analyses: Row[] = rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    createdAt: r.createdAt,
    analysis: r.coordinatorPayload,
  }));

  const coins = [...new Set(analyses.map((a) => a.symbol))].sort();
  const first = analyses[0].createdAt;
  const now = Date.now();

  // One candle pull per coin, sliced per analysis. The window has to reach back
  // to the oldest analysis plus enough bars for its ladder to have played out.
  const hours = Math.ceil((now - first.getTime()) / 3_600_000) + 48;
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const candles = new Map<string, Candle[]>();
  for (const coin of coins) {
    candles.set(
      coin,
      await binance.getCandlesPaged(coin, '1h', Math.min(hours, 8760)).catch(() => []),
    );
  }

  // ── funnel ───────────────────────────────────────────────────────────
  let plansEmitted = 0;
  let repeats = 0;
  const taken: Scored[] = [];
  const lastZone = new Map<string, { zone: ConfluenceZone; busyUntil: number }>();

  for (const row of analyses) {
    const series = candles.get(row.symbol) ?? [];
    const since = series.filter((c) => c.time.getTime() > row.createdAt.getTime());
    const results = scorePlans(row.analysis.plans, since, row.createdAt, now);

    // Second pass for anything still running past the hold limit: re-score it
    // against candles cut at fill + MAX_HOLD, which is what §14h did. Two
    // passes rather than one because the fill time is not knowable until the
    // first pass has found it.
    const capped = results.map((result, i) => {
      if (result.outcome !== 'OPEN' || !result.filledAt) return result;
      const closeAt = result.filledAt.getTime() + MAX_HOLD_H * 3_600_000;
      if (closeAt >= now) return result;
      const [rescored] = scorePlans(
        [row.analysis.plans[i]],
        since.filter((c) => c.time.getTime() <= closeAt),
        row.createdAt,
        closeAt,
      );
      return rescored;
    });

    row.analysis.plans.forEach((plan, i) => {
      plansEmitted += 1;
      const key = `${row.symbol}:${plan.direction}`;
      if (isRepeat(plan, row.createdAt, lastZone.get(key))) {
        repeats += 1;
        return;
      }
      lastZone.set(key, {
        zone: plan.zone,
        busyUntil: busyUntil(row.createdAt, capped[i]),
      });
      taken.push(score(row, plan, capped[i], results[i]));
    });
  }

  const days = (now - first.getTime()) / 86_400_000;
  console.log(
    `${analyses.length} analyses · ${coins.length} coins · ` +
      `${first.toISOString().slice(0, 10)} → ${new Date(now).toISOString().slice(0, 10)} ` +
      `(${days.toFixed(1)} days)\n`,
  );

  const done = filled(taken);
  const open = taken.filter((s) => s.outcome === 'OPEN');
  console.table([
    { stage: 'plans emitted', n: plansEmitted },
    { stage: 'same zone re-printed', n: repeats },
    { stage: 'opportunities', n: taken.length },
    { stage: '  never reached entry', n: taken.filter((s) => s.outcome === 'MISSED').length },
    { stage: '  still inside 24h window', n: taken.filter((s) => s.outcome === 'PENDING').length },
    { stage: '  filled', n: done.length },
    { stage: '    still open', n: open.length },
  ]);

  if (done.length === 0) {
    console.log(
      '\nNothing has filled yet. Nothing below would mean anything, so it is not printed.',
    );
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  console.log('');
  console.table([
    summarise('ALL', taken),
    summarise('  long', taken.filter((s) => s.direction === 'long')),
    summarise('  short', taken.filter((s) => s.direction === 'short')),
    ...coins.map((c) => summarise(`  ${c}`, taken.filter((s) => s.coin === c))),
  ]);

  console.table([
    ...group(taken, (s) => s.regime).map((g) =>
      summarise(`regime ${g}`, taken.filter((s) => s.regime === g)),
    ),
    ...group(taken, (s) => s.route).map((g) =>
      summarise(`route ${g}`, taken.filter((s) => s.route === g)),
    ),
    ...group(taken, (s) => s.state).map((g) =>
      summarise(`zone ${g}`, taken.filter((s) => s.state === g)),
    ),
    ...group(taken, (s) => String(s.sources)).map((g) =>
      summarise(`${g} sources`, taken.filter((s) => String(s.sources) === g)),
    ),
  ]);

  // ── why it failed ────────────────────────────────────────────────────
  console.log('\nwhere the R went');
  console.table(
    (['MISSED', 'STOPPED', 'PARTIAL', 'ALL_TARGETS', 'OPEN'] as const).map((o) => {
      const rows_ = taken.filter((s) => s.outcome === o);
      const net = rows_.filter((s) => s.netR !== null).map((s) => s.netR as number);
      return {
        outcome: o,
        n: rows_.length,
        'share%': `${((rows_.length / taken.length) * 100).toFixed(0)}%`,
        'net R': net.length === 0 ? '—' : mean(net).toFixed(3),
        'total R': net.length === 0 ? '—' : net.reduce((a, b) => a + b, 0).toFixed(1),
      };
    }),
  );

  // Open positions are marked to market, which is a guess about the future
  // dressed as a result. §14h's sign flipped on exactly this.
  // Marking to market is a guess about the future dressed as a result, and
  // §14h's sign flipped on exactly this. So print all three framings side by
  // side: the spread between them IS the uncertainty the headline hides.
  const closed = done.filter((s) => s.outcome !== 'OPEN');
  const row = (basis: string, xs: number[]) => ({
    basis,
    n: xs.length,
    'net R/trade': xs.length === 0 ? '—' : mean(xs).toFixed(3),
    'total R': xs.length === 0 ? '—' : (mean(xs) * xs.length).toFixed(1),
    t: xs.length === 0 ? '—' : fmtT(xs),
  });

  console.log('\nnet R/trade, by what we assume about the open positions');
  console.table([
    row('open marked to market', done.map((s) => s.netR as number)),
    row(
      'open scored at 0R',
      done.map((s) => (s.outcome === 'OPEN' ? 0 : (s.netR as number))),
    ),
    row('closed only', closed.map((s) => s.netR as number)),
  ]);
  console.log(
    `${((open.length / done.length) * 100).toFixed(0)}% of fills are still open. ` +
      `t assumes independent trades and they are not — treat it as an upper ` +
      `bound on significance, not a p-value.`,
  );

  // The knob §14h's conclusion moved with. If these two disagree, the holding
  // period is doing the work, not the levels.
  const uncapped = done.filter((s) => s.netRUncapped !== null);
  console.log(
    `hold        ${mean(done.map((s) => s.netR as number)).toFixed(3)} at ${MAX_HOLD_H}h ` +
      `· ${uncapped.length === 0 ? '—' : mean(uncapped.map((s) => s.netRUncapped as number)).toFixed(3)} with no limit`,
  );

  // ── control: same plans, another analysis's timing ───────────────────
  const rng = makeRng(SEED);
  const deltas: number[] = [];
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const control: number[] = [];
    for (const s of done) {
      const pool_ = analyses.filter((a) => a.symbol === s.coin);
      const at = pool_[Math.floor(rng() * pool_.length)].createdAt;
      const source = analyses.find((a) => a.id === s.id);
      const plan = source?.analysis.plans.find((p) => p.direction === s.direction);
      if (!plan) continue;
      const series = (candles.get(s.coin) ?? []).filter(
        (c) => c.time.getTime() > at.getTime(),
      );
      const [result] = scorePlans([plan], series, at, now);
      if (result.r !== null) control.push(result.r - s.costR);
    }
    if (control.length > 0) {
      deltas.push(mean(done.map((s) => s.netR as number)) - mean(control));
    }
  }

  if (deltas.length > 0) {
    console.log(
      `edge over random  ${mean(deltas).toFixed(3)}R/trade ` +
        `(same plans, another analysis's timing, averaged over ${deltas.length} draws)`,
    );
  }

  console.log(
    `\nNo confidence interval: ${days.toFixed(1)} days is one month-cluster, and the unit of\n` +
      `evidence is the month (STATE_OF_PLAY.md rule 7). Read this as consistent or\n` +
      `inconsistent with §14h's net −0.039R, never as proof of either.`,
  );

  if (CSV) {
    const keys = Object.keys(taken[0]) as Array<keyof Scored>;
    fs.writeFileSync(
      CSV,
      `# ${CONFIG}\n${keys.join(',')}\n` +
        taken
          .map((s) =>
            keys.map((k) => (s[k] instanceof Date ? (s[k] as Date).toISOString() : s[k])).join(','),
          )
          .join('\n'),
    );
    console.log(`\nwrote ${taken.length} opportunities to ${CSV} (config on line 1)`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
