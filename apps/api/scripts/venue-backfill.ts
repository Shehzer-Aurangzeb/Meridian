/**
 * Cross-exchange backfill — OKX and Bybit into the LOCAL database.
 *
 *   pnpm --filter api venue-backfill --from 2023-01-01
 *
 * ─── Why ─────────────────────────────────────────────────────────────────
 * Every one of the 160 columns in the Phase D panel is Binance-only. Phases B
 * through D found that set worth roughly a third of a retail fee, and the
 * stage-0 fill test then measured the gross as negative over 3.1 years. So the
 * remaining question is not "can we squeeze more out of these features" — it is
 * whether a genuinely different phenomenon carries anything.
 *
 * Where the same contract trades on three venues, the gaps between them are
 * that different phenomenon: dislocation, and where crowding and leverage sit.
 * Nothing in the panel can see it.
 *
 * ─── What is actually available, measured 3 Sept 2026 ────────────────────
 * Probed rather than read from docs, because a documented limit has already
 * been wrong once here — `/fapi/v1/fundingRate` accepts `limit=1000` and caps
 * at 500, which silently truncated a 2,200-day backfill to 166 days.
 *
 *              1h price      funding        open interest
 *   Binance    have it       2020+          2020+
 *   OKX        2023-01 ok    ~3 months      ~1 month
 *   Bybit      2023-01 ok    2023-01 ok     2023-01 ok
 *
 * So OKX contributes PRICE ONLY to a 2023-start panel. Its open-interest
 * endpoint deserves a specific warning: `begin` on its own is ignored and the
 * endpoint returns the most recent rows whatever you ask for. Counting rows
 * says "100 rows, works fine"; reading the timestamps says they are all from
 * today. Only `begin` AND `end` together filter, and that combination returns
 * nothing before roughly a month ago.
 *
 * ─── Timestamps ──────────────────────────────────────────────────────────
 * All three venues stamp a bar at its OPEN. `FlowSample` holds the live
 * convention — the instant a value became knowable — so every bar is stored at
 * `open + 1h`. Getting this wrong is not a rounding error: it hands `flowAsOf`
 * a row an hour before it existed, which is the look-ahead that guard exists to
 * stop. OKX's `confirm` flag is used rather than arithmetic to drop the bar
 * still forming; Bybit has no such flag, so its newest bar is dropped by time.
 *
 * Funding is stored at its settlement instant, unshifted — that is when it is
 * known, and it matches how Binance `fundingRate` is already stored.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import * as https from 'https';
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

const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const FROM = Date.parse(`${str('from', '2023-01-01')}T00:00:00Z`);
const TO = Date.parse(`${str('to', new Date().toISOString().slice(0, 10))}T00:00:00Z`);
const ONLY = str('metrics', '');
/** Politeness delay between requests. OKX public endpoints throttle around
 *  20 requests per 2 seconds; this stays well inside that and the run is short. */
const DELAY_MS = num('delay', 120);

export interface Sample {
  symbol: string;
  metric: string;
  ts: number;
  value: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * GET one JSON document, with retries.
 *
 * A dropped socket over a few thousand requests is close to certain, and the
 * bookDepth backfill already died at 8% for want of this.
 */
async function getJson(url: string, attempts = 4): Promise<unknown> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await new Promise((resolve, reject) => {
        // OKX rejects the default Node agent with 403.
        const req = https.get(url, { headers: { 'User-Agent': 'meridian-research/1.0' } }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`${res.statusCode} for ${url}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (e) {
              reject(e as Error);
            }
          });
        });
        req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      });
    } catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
  throw new Error('unreachable');
}

/** One venue series: how to fetch a page ending at `end`, and what it yields. */
interface Source {
  metric: string;
  /** Rows are returned NEWEST FIRST by every endpoint here. */
  page: (coin: string, end: number) => Promise<Sample[]>;
  /** Rows per page, MEASURED. OKX open interest caps at 100 while accepting 300. */
  pageRows: number;
  /** Spacing between rows, for working out how far a page reaches back. */
  stepMs: number;
}

const okxPair = (c: string): string => `${c.toUpperCase()}-USDT-SWAP`;
const bybitPair = (c: string): string => `${c.toUpperCase()}USDT`;

const SOURCES: Source[] = [
  {
    metric: 'okxClose',
    pageRows: 300,
    stepMs: HOUR,
    page: async (coin, end) => {
      const url =
        `https://www.okx.com/api/v5/market/history-candles?instId=${okxPair(coin)}` +
        `&bar=1H&after=${end}&limit=300`;
      const body = (await getJson(url)) as { data?: string[][] };
      return (body.data ?? [])
        // `confirm === '1'` is the venue saying the bar is closed. Trusting the
        // flag beats comparing against our own clock.
        .filter((r) => r[8] === '1')
        .map((r) => ({
          symbol: coin.toUpperCase(),
          metric: 'okxClose',
          ts: Number(r[0]) + HOUR,
          value: Number(r[4]),
        }));
    },
  },
  {
    metric: 'bybitClose',
    pageRows: 1000,
    stepMs: HOUR,
    page: async (coin, end) => {
      const url =
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitPair(coin)}` +
        `&interval=60&end=${end}&limit=1000`;
      const body = (await getJson(url)) as { result?: { list?: string[][] } };
      const cutoff = Date.now() - HOUR; // the bar still forming
      return (body.result?.list ?? [])
        .filter((r) => Number(r[0]) < cutoff)
        .map((r) => ({
          symbol: coin.toUpperCase(),
          metric: 'bybitClose',
          ts: Number(r[0]) + HOUR,
          value: Number(r[4]),
        }));
    },
  },
  {
    metric: 'bybitOpenInterest',
    pageRows: 200,
    stepMs: HOUR,
    page: async (coin, end) => {
      const url =
        `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${bybitPair(coin)}` +
        `&intervalTime=1h&endTime=${end}&limit=200`;
      const body = (await getJson(url)) as {
        result?: { list?: Array<{ openInterest: string; timestamp: string }> };
      };
      const cutoff = Date.now() - HOUR;
      return (body.result?.list ?? [])
        .filter((r) => Number(r.timestamp) < cutoff)
        .map((r) => ({
          symbol: coin.toUpperCase(),
          metric: 'bybitOpenInterest',
          ts: Number(r.timestamp) + HOUR,
          value: Number(r.openInterest),
        }));
    },
  },
  {
    metric: 'bybitFundingRate',
    pageRows: 200,
    stepMs: 8 * HOUR,
    page: async (coin, end) => {
      const url =
        `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${bybitPair(coin)}` +
        `&endTime=${end}&limit=200`;
      const body = (await getJson(url)) as {
        result?: { list?: Array<{ fundingRate: string; fundingRateTimestamp: string }> };
      };
      return (body.result?.list ?? []).map((r) => ({
        symbol: coin.toUpperCase(),
        metric: 'bybitFundingRate',
        // Settlement instant, unshifted: that IS when it becomes known.
        ts: Number(r.fundingRateTimestamp),
        value: Number(r.fundingRate),
      }));
    },
  },
];

/**
 * Page backwards from `to` until `from` is reached or the venue runs dry.
 *
 * The stopping rule is deliberately NOT "a short page means the end". A short
 * page is exactly what a capped `limit` looks like, and reading a short page as
 * the live edge is what truncated the Binance funding backfill to 166 days
 * while reporting success. This stops when a page yields no row older than the
 * oldest already seen — real exhaustion — or when `from` is passed.
 */
export async function pageBack(
  source: Source,
  coin: string,
  from: number,
  to: number,
  delayMs: number,
): Promise<Sample[]> {
  const out: Sample[] = [];
  let cursor = to;
  let oldest = Infinity;
  for (let guard = 0; guard < 5000; guard += 1) {
    const rows = await source.page(coin, cursor);
    if (rows.length === 0) break;
    const min = Math.min(...rows.map((r) => r.ts));
    if (min >= oldest) break; // no progress: the venue has nothing older
    oldest = min;
    out.push(...rows.filter((r) => r.ts >= from));
    if (min <= from) break;
    cursor = min - source.stepMs;
    await sleep(delayMs);
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const sources = ONLY ? SOURCES.filter((s) => ONLY.split(',').includes(s.metric)) : SOURCES;
  if (sources.length === 0) {
    throw new Error(`--metrics matched nothing. Known: ${SOURCES.map((s) => s.metric).join(', ')}`);
  }

  // Said out loud: this writes LOCAL, and the two databases have been confused
  // once already. See scripts/flow-backfill.ts.
  console.log(`\nVENUE BACKFILL — ${sources.map((s) => s.metric).join(', ')}`);
  console.log(`coins   ${COINS.length}`);
  console.log(`window  ${new Date(FROM).toISOString().slice(0, 10)} -> ${new Date(TO).toISOString().slice(0, 10)}`);
  console.log(`target  ${url.replace(/:\/\/[^@]*@/, '://***@')}\n`);

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const t0 = Date.now();
  let saved = 0;
  for (const coin of COINS) {
    for (const source of sources) {
      const rows = await pageBack(source, coin, FROM, TO, DELAY_MS);
      if (rows.length > 0) {
        const { count } = await prisma.flowSample.createMany({
          data: rows.map((r) => ({
            symbol: r.symbol,
            metric: r.metric,
            ts: new Date(r.ts),
            value: r.value,
          })),
          skipDuplicates: true,
        });
        saved += count;
      }
      const span = rows.length
        ? `${new Date(Math.min(...rows.map((r) => r.ts))).toISOString().slice(0, 10)} -> ` +
          `${new Date(Math.max(...rows.map((r) => r.ts))).toISOString().slice(0, 10)}`
        : 'nothing';
      console.log(
        `  ${coin.padEnd(5)} ${source.metric.padEnd(18)} ${rows.length.toLocaleString().padStart(8)} rows  ${span}`,
      );
    }
  }

  console.log(`\nsaved ${saved.toLocaleString()} new rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await prisma.$disconnect();
  await pool.end();
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
