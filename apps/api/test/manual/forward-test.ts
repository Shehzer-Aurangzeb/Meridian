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
import { PlanResult, scorePlans } from '../../src/analysis-coordinator/outcome';
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
const FEE_PCT = num('fee', 0.05);
const SLIP_PCT = num('slip', 0.02);
const ROUND_TRIP_PCT = 2 * (FEE_PCT + SLIP_PCT);
const DRAWS = num('draws', 20);
const SEED = num('seed', 12345);
const CSV = str('csv', '');

const CONFIG =
  `since=${SINCE || 'all'} cooldown=${COOLDOWN_H}h ` +
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
  last: { zone: ConfluenceZone; at: Date } | undefined,
): boolean {
  if (!last) return false;
  const hours = (at.getTime() - last.at.getTime()) / 3_600_000;
  return hours < COOLDOWN_H && overlaps(plan.zone, last.zone);
}

function score(
  row: Row,
  plan: TradePlan,
  result: PlanResult,
): Scored {
  const costR = plan.riskPercent === 0 ? 0 : ROUND_TRIP_PCT / plan.riskPercent;
  return {
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
    costR,
    netR: result.r === null ? null : result.r - costR,
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

  const prev = { zone: zone(100, 110), at: t(0) };

  assert(!isRepeat(plan(100, 110), t(0), undefined), 'the first plan is never a repeat');
  assert(isRepeat(plan(100, 110), t(8), prev), 'same zone, 8h later → repeat');
  assert(isRepeat(plan(105, 115), t(8), prev), 'overlapping zone → repeat');
  assert(!isRepeat(plan(120, 130), t(8), prev), 'a different zone is a new opportunity');
  assert(
    !isRepeat(plan(100, 110), t(COOLDOWN_H + 1), prev),
    'the same zone is takeable again after the cooldown',
  );
  // Touching-but-not-crossing has to count as overlap, or a zone that drifts by
  // one tick between runs is counted twice.
  assert(isRepeat(plan(110, 120), t(1), prev), 'zones that touch at one price overlap');

  console.log('self-check passed (dedup: overlap + cooldown, first plan always taken)');
}

if (args.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

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
  const lastZone = new Map<string, { zone: ConfluenceZone; at: Date }>();

  for (const row of analyses) {
    const series = candles.get(row.symbol) ?? [];
    const since = series.filter((c) => c.time.getTime() > row.createdAt.getTime());
    const results = scorePlans(row.analysis.plans, since, row.createdAt, now);

    row.analysis.plans.forEach((plan, i) => {
      plansEmitted += 1;
      const key = `${row.symbol}:${plan.direction}`;
      if (isRepeat(plan, row.createdAt, lastZone.get(key))) {
        repeats += 1;
        return;
      }
      lastZone.set(key, { zone: plan.zone, at: row.createdAt });
      taken.push(score(row, plan, results[i]));
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
  const closed = done.filter((s) => s.outcome !== 'OPEN');
  console.log(
    `\nnet R/trade  ${mean(done.map((s) => s.netR as number)).toFixed(3)} including open ` +
      `· ${closed.length === 0 ? '—' : mean(closed.map((s) => s.netR as number)).toFixed(3)} closed only ` +
      `(${((open.length / done.length) * 100).toFixed(0)}% of fills are open)`,
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
