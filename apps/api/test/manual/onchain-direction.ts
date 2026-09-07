/**
 * On-chain direction — do free on-chain metrics predict BTC and ETH?
 *
 *   pnpm --filter api onchain-direction
 *   pnpm --filter api onchain-direction --self-check
 *
 * ─── What is actually free ───────────────────────────────────────────────
 * The brief names CryptoQuant, Glassnode and Dune. All three were probed and
 * all three refuse without a key: Glassnode and CryptoQuant answer 401, Dune
 * redirects to auth. No on-chain key exists in this project's environment.
 *
 * Two sources DO serve this data with no key at all, and they are what this
 * file uses:
 *
 *   - CoinMetrics Community API. 31 daily metrics for BTC and ETH going back
 *     to 2011, including `FlowInExNtv` / `FlowOutExNtv` (exchange flows) and
 *     `SplyExNtv` (supply held on exchanges). This is exchange netflow at the
 *     source, not a proxy for it.
 *   - DefiLlama. Per-exchange proof-of-reserve token balances, daily, from
 *     2022-11-12. Summed over the ten largest CEXs this gives USDT held on
 *     exchanges, which is the numerator the stablecoin ratio needs.
 *
 * ─── What is NOT available, and is therefore not tested ──────────────────
 * Whale transaction count (transfers over $1M/day). It is not in the
 * CoinMetrics community catalogue for either asset — the free tier has
 * `TxCnt` and `TxTfrCnt` but no value-banded transfer count. Blockchair and
 * blockchain.info, the two keyless chain-explorer APIs that could produce it,
 * are unreachable from this machine (connection refused, same as Binance
 * spot). Getting it needs a Dune API key — their free tier at 1000 credits a
 * month would cover a daily series easily.
 *
 * Rather than invent a proxy and quietly call it a whale count, the slot is
 * filled by `splyExChg7`: the 7-day change in the share of supply sitting on
 * exchanges. It is free, it is real, and it is the stock counterpart of the
 * netflow metric. It is labelled a substitute everywhere it appears.
 *
 * ─── Two coins means TIME-SERIES, not cross-sectional ────────────────────
 * A cross-sectional rank correlation over two assets is degenerate: Spearman
 * on n = 2 is +1 or -1 every single day and carries no information. The brief
 * allows for this ("or time-series IC if testing one coin's metric against its
 * own return") and that is the branch taken. Each coin is measured against its
 * own forward return.
 *
 * A time-series Spearman is one number, and one number has no standard error.
 * So the IC is decomposed into the daily series whose mean it is: rank both
 * sides, standardise both, and multiply. `mean(u_t * v_t)` IS the Spearman rho
 * exactly, and unlike the rho it is a series that Newey-West and a block
 * bootstrap can be run on. `selfCheck` asserts that identity.
 *
 * ─── Look-ahead ──────────────────────────────────────────────────────────
 * The publication lag is the whole game here and it is easy to get wrong.
 *
 * CoinMetrics stamps a daily row with the day's START, but the row aggregates
 * the entire day, and the response carries the moment it was published: the
 * probe showed `status-time` around 02:34 UTC on the FOLLOWING day. So the row
 * for day D lands about two and a half hours after day D has already closed.
 * A decision taken at the close of day D therefore cannot see day D's own
 * metric — it can only see day D-1's, which was published 02:34 on day D and
 * is safely in the past.
 *
 * Every metric here is lagged one full day for that reason. It costs a day of
 * freshness and removes any argument about the boundary.
 *
 * The descriptive IC ranks over the full sample, which is what a Spearman
 * always does and is stated as in-sample. The TRADEABLE number does not: the
 * decile thresholds are computed from a trailing 365-day window only, so the
 * portfolio never sees a threshold built out of its own future.
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import {
  blockBootstrapMean,
  mean,
  neweyWestSe,
  normalCdf,
  rank,
  spearman,
} from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const COINS = str('coins', 'BTC,ETH').split(',');
const START = str('start', '2023-01-01');
const END = str('end', '2026-09-07');
const OUT = str('out', 'test/manual/results/onchain-panel.csv');
const CACHE = str('cache', 'test/manual/results/onchain-cache.json');

const DAY_MS = 86_400_000;
const HORIZONS = [1, 3, 7];
const BAR = num('bar', 3.0);
const BLOCK_DAYS = num('block-days', 30);
const DRAWS = num('draws', 2000);
const SHUFFLES = num('shuffles', 1000);
const SEED = num('seed', 12345);
const FEE_BP = num('fee-bp', 14);
/** Trailing window the decile thresholds are built from. Never the future. */
const LOOKBACK = num('lookback', 365);
const MIN_LOOKBACK = num('min-lookback', 180);
/** Top and bottom decile. */
const DECILE = num('decile', 0.1);
/** Rank autocorrelation at this lag must stay under MAX_PERSIST. */
const PERSIST_LAG = num('persist-lag', 30);
const MAX_PERSIST = num('max-persist', 0.5);
/** CoinMetrics publishes a day's row ~02:34 UTC the NEXT day. See the header. */
const PUBLICATION_LAG_DAYS = num('pub-lag', 1);

/** The ten largest CEXs by DefiLlama's own TVL, which is where the USDT is. */
const CEX_SLUGS = [
  'Binance-CEX', 'okx', 'bitfinex', 'Bybit', 'robinhood',
  'Gate', 'bitget', 'gemini', 'mexc', 'bitstamp',
];

const METRICS = [
  { key: 'netflow7', label: '7d exchange netflow (in - out), native', spec: true },
  { key: 'usdtExRatio', label: 'USDT on CEXs / USDT supply, level', spec: true },
  { key: 'usdtExRatioChg7', label: 'USDT on CEXs / USDT supply, 7d change', spec: true },
  { key: 'splyExChg7', label: '7d change in exchange supply share [SUBSTITUTE]', spec: false },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

// ── fetching ─────────────────────────────────────────────────────────────

/**
 * One GET, retried on the network faults these three public endpoints actually
 * throw: a timeout, a reset, a 429 or a 5xx. A 401 or a 404 is an answer, not a
 * fault, and is not retried.
 */
async function getWithRetry<T>(
  url: string,
  config: Record<string, unknown>,
  tries = 4,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await axios.get<T>(url, config);
      return res.data;
    } catch (e) {
      last = e;
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || i === tries) break;
      console.log(`  retry ${i}/${tries - 1}: ${url.slice(0, 60)}...`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

interface Daily {
  /** UTC day start, ms. The bar opens here and closes at +1 day. */
  day: number;
  close: number;
}

/**
 * Daily bars for one coin's PERPETUAL.
 *
 * The perp rather than spot for the same reason as the weekly test: the 14 bp
 * taker round trip below is a perp fee, so the book has to be a perp book.
 * `api.binance.com`, which is spot, is unreachable from this machine anyway.
 */
async function dailyCandles(coin: string): Promise<Daily[]> {
  const data = await getWithRetry<Array<Array<string | number>>>(
    'https://fapi.binance.com/fapi/v1/klines',
    {
      params: {
        symbol: `${coin.toUpperCase()}USDT`,
        interval: '1d',
        startTime: Date.parse(`${START}T00:00:00Z`) - 40 * DAY_MS,
        limit: 1500,
      },
      timeout: 60_000,
    },
  );
  // The final bar is the day still in progress and holds hours that have not
  // happened. It is never a row and never a forward return.
  return data
    .slice(0, -1)
    .map((k) => ({ day: k[0] as number, close: parseFloat(k[4] as string) }));
}

interface CoinMetricsPage {
  data: Array<Record<string, string>>;
  next_page_url?: string;
}

/** One CoinMetrics community series set. No key, no auth, 31 metrics per asset. */
async function coinMetrics(
  assets: string[],
  metrics: string[],
): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  for (const m of metrics) for (const a of assets) out.set(`${a}:${m}`, new Map());

  let url: string | undefined =
    `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${assets.join(',')}` +
    `&metrics=${metrics.join(',')}&frequency=1d&start_time=${START}&end_time=${END}&page_size=10000`;
  while (url) {
    const page: CoinMetricsPage = await getWithRetry<CoinMetricsPage>(url, {
      timeout: 90_000,
    });
    for (const row of page.data) {
      const day = Date.parse(row.time);
      for (const m of metrics) {
        const v = row[m];
        if (v !== undefined) out.get(`${row.asset}:${m}`)!.set(day, Number(v));
      }
    }
    url = page.next_page_url;
  }
  return out;
}

/**
 * USDT held on the ten largest exchanges, daily, from DefiLlama.
 *
 * Each exchange's history is a ~23 MB document and only one series is wanted
 * out of it, so the extract is cached and the raw payload is never kept. The
 * balances are proof-of-reserve wallet totals, which is a SUBSET of all
 * exchanges — the ratio below is therefore a tracked-exchange ratio, and its
 * level means less than its change.
 */
async function usdtOnExchanges(cacheFile: string): Promise<Map<number, number>> {
  if (fs.existsSync(cacheFile)) {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Record<string, number>;
    return new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
  }

  const total = new Map<number, number>();
  for (const slug of CEX_SLUGS) {
    const data = await getWithRetry<{
      chainTvls?: Record<string, { tokens?: Array<{ date: number; tokens: Record<string, number> }> }>;
    }>(`https://api.llama.fi/updatedProtocol/${slug}`, {
      timeout: 180_000,
      maxContentLength: 200 * 1024 * 1024,
    });
    for (const chain of Object.values(data.chainTvls ?? {})) {
      for (const pt of chain.tokens ?? []) {
        const usdt = pt.tokens?.USDT;
        if (!Number.isFinite(usdt)) continue;
        // Snapshots land at an arbitrary time of day; the UTC day they fall in
        // is the day they describe.
        const day = Math.floor((pt.date * 1000) / DAY_MS) * DAY_MS;
        total.set(day, (total.get(day) ?? 0) + (usdt as number));
      }
    }
    process.stdout.write(`  defillama ${slug} ok\n`);
  }

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(total)));
  return total;
}

// ── panel ────────────────────────────────────────────────────────────────

interface Panel {
  coins: string[];
  /** Decision days: the UTC day whose CLOSE the decision is taken at. */
  days: number[];
  /** column -> Float64Array[days.length * coins.length], NaN where absent. */
  data: Map<string, Float64Array>;
}

/** Sum of a daily series over `n` days ending at `day`, inclusive. */
function windowSum(s: Map<number, number>, day: number, n: number): number {
  let acc = 0;
  for (let k = 0; k < n; k += 1) {
    const v = s.get(day - k * DAY_MS);
    if (v === undefined || !Number.isFinite(v)) return NaN;
    acc += v;
  }
  return acc;
}

const change = (s: Map<number, number>, day: number, n: number): number => {
  const a = s.get(day);
  const b = s.get(day - n * DAY_MS);
  return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)
    ? a - b
    : NaN;
};

// ── measurement ──────────────────────────────────────────────────────────

/**
 * The daily series whose mean is the Spearman rho.
 *
 * Rank both sides over the pairs where both exist, centre and scale each by its
 * own population standard deviation, and multiply. The mean of the product is
 * the Pearson correlation of the ranks, which is the definition of Spearman —
 * and being a series, it has a standard error that Newey-West can correct.
 */
export function icProducts(x: number[], y: number[]): number[] {
  const rx = rank(x);
  const ry = rank(y);
  const n = x.length;
  const mx = mean(rx);
  const my = mean(ry);
  const sx = Math.sqrt(rx.reduce((a, v) => a + (v - mx) ** 2, 0) / n);
  const sy = Math.sqrt(ry.reduce((a, v) => a + (v - my) ** 2, 0) / n);
  if (sx === 0 || sy === 0) return [];
  return rx.map((v, i) => ((v - mx) / sx) * ((ry[i] - my) / sy));
}

/** Rank autocorrelation of a series at `lag` days. */
export function persistence(v: Float64Array, lag: number): number {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i + lag < v.length; i += 1) {
    if (Number.isFinite(v[i]) && Number.isFinite(v[i + lag])) {
      a.push(v[i]);
      b.push(v[i + lag]);
    }
  }
  return a.length < 30 ? NaN : spearman(a, b);
}

/**
 * Percentile of each value within its own TRAILING window.
 *
 * This is what makes the portfolio tradeable. A decile computed over the whole
 * sample would tell the strategy in 2023 which days of 2026 turned out extreme,
 * which is the single most common way a backtest of a threshold rule leaks.
 */
export function trailingPct(
  v: Float64Array,
  lookback: number,
  minObs: number,
): Float64Array {
  const out = new Float64Array(v.length).fill(NaN);
  for (let i = 0; i < v.length; i += 1) {
    if (!Number.isFinite(v[i])) continue;
    let n = 0;
    let below = 0;
    for (let k = Math.max(0, i - lookback + 1); k <= i; k += 1) {
      if (!Number.isFinite(v[k])) continue;
      n += 1;
      if (v[k] <= v[i]) below += 1;
    }
    if (n >= minObs) out[i] = below / n;
  }
  return out;
}

interface Result {
  metric: MetricKey;
  coin: string;
  horizon: number;
  n: number;
  ic: number;
  se: number;
  t: number;
  lo: number;
  hi: number;
  persist: number;
}

function measure(panel: Panel, metric: MetricKey, ci: number, horizon: number): Result {
  const nC = panel.coins.length;
  const f = panel.data.get(metric)!;
  const y = panel.data.get(`fwd${horizon}d`)!;

  const xs: number[] = [];
  const ys: number[] = [];
  const ts: number[] = [];
  for (let di = 0; di < panel.days.length; di += 1) {
    const at = di * nC + ci;
    if (Number.isFinite(f[at]) && Number.isFinite(y[at])) {
      xs.push(f[at]);
      ys.push(y[at]);
      ts.push(panel.days[di]);
    }
  }

  const own = new Float64Array(panel.days.length);
  for (let di = 0; di < panel.days.length; di += 1) own[di] = f[di * nC + ci];
  const persist = persistence(own, PERSIST_LAG);

  if (xs.length < 60) {
    return {
      metric, coin: panel.coins[ci], horizon, n: xs.length,
      ic: NaN, se: NaN, t: NaN, lo: NaN, hi: NaN, persist,
    };
  }

  const prod = icProducts(xs, ys);
  const ic = spearman(xs, ys);
  // Lag = the horizon: two readings more than H days apart share no part of the
  // same forward return.
  const se = neweyWestSe(prod, horizon);
  const boot = blockBootstrapMean(
    prod.map((v, i) => ({ time: ts[i], value: v })),
    BLOCK_DAYS,
    DRAWS,
    SEED,
  );
  return {
    metric, coin: panel.coins[ci], horizon, n: xs.length,
    ic, se, t: ic / se, lo: boot.lo, hi: boot.hi, persist,
  };
}

// ── pricing ──────────────────────────────────────────────────────────────

interface Priced {
  rows: Array<{ time: number; value: number }>;
  grossBp: number;
  turnover: number;
  daysInMarket: number;
}

/**
 * Price a metric as a decile long-short, held `horizon` days.
 *
 * Long when the metric sits in its top trailing decile, short in the bottom,
 * flat in between — so the book is deployed on roughly a fifth of days, and the
 * basis points below are per unit of capital ON THE DAYS IT TRADES. Days flat
 * are reported separately rather than being averaged in to flatter the number.
 *
 * Weights across the active coins sum to 1.0 in absolute value, so the 14 bp is
 * charged once against a whole unit of gross.
 */
function price(
  panel: Panel,
  metric: MetricKey,
  horizon: number,
  sign: number,
  pctOverride?: Float64Array,
): Priced {
  const nC = panel.coins.length;
  const pct = pctOverride ?? panel.data.get(`pct_${metric}`)!;
  const y = panel.data.get(`fwd${horizon}d`)!;

  const rows: Array<{ time: number; value: number }> = [];
  const ws: Array<Float64Array | null> = [];
  for (let di = 0; di < panel.days.length; di += 1) {
    const raw: number[] = [];
    let active = 0;
    for (let ci = 0; ci < nC; ci += 1) {
      const at = di * nC + ci;
      const p = pct[at];
      let s = 0;
      if (Number.isFinite(p) && Number.isFinite(y[at])) {
        if (p >= 1 - DECILE) s = sign;
        else if (p <= DECILE) s = -sign;
      }
      raw.push(s);
      if (s !== 0) active += 1;
    }
    if (active === 0) {
      ws.push(null);
      continue;
    }
    const w = new Float64Array(nC);
    let ret = 0;
    for (let ci = 0; ci < nC; ci += 1) {
      if (raw[ci] === 0) continue;
      w[ci] = raw[ci] / active;
      // Simple, not log: a portfolio is a weighted sum of arithmetic returns.
      ret += w[ci] * (Math.exp(y[di * nC + ci]) - 1);
    }
    ws.push(w);
    rows.push({ time: panel.days[di], value: ret * 1e4 });
  }

  // How much of the book is different a holding period later. Half the summed
  // absolute change, so a fully replaced book is 1.0 and not 2.0. A move from
  // flat into a position, or out of one, is a real trade and counts.
  const tos: number[] = [];
  const zero = new Float64Array(nC);
  for (let di = 0; di + horizon < ws.length; di += 1) {
    const a = ws[di];
    if (a === null) continue;
    const b = ws[di + horizon] ?? zero;
    let d = 0;
    for (let ci = 0; ci < nC; ci += 1) d += Math.abs(b[ci] - a[ci]);
    tos.push(d / 2);
  }

  return {
    rows,
    grossBp: rows.length === 0 ? NaN : mean(rows.map((r) => r.value)),
    turnover: tos.length === 0 ? NaN : mean(tos),
    daysInMarket: rows.length,
  };
}

/**
 * Two shuffle controls, because the one the brief names is the weaker of them.
 *
 * `iid` permutes the metric across days, which breaks the alignment — and also
 * destroys the metric's own autocorrelation, so the shuffled book trades far
 * more often than the real one and the comparison is not quite like for like.
 *
 * `shift` rotates the series by a random offset instead. Every value keeps its
 * neighbours, so the autocorrelation, the trading frequency and the decile
 * structure all survive and ONLY the alignment with returns dies. It is the
 * stricter control and both are reported.
 */
function permuteDays(pct: Float64Array, nC: number, nD: number, rng: () => number): Float64Array {
  const out = Float64Array.from(pct);
  for (let ci = 0; ci < nC; ci += 1) {
    const idx: number[] = [];
    for (let di = 0; di < nD; di += 1) idx.push(di);
    for (let i = nD - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }
    for (let di = 0; di < nD; di += 1) out[di * nC + ci] = pct[idx[di] * nC + ci];
  }
  return out;
}

function shiftDays(pct: Float64Array, nC: number, nD: number, rng: () => number): Float64Array {
  const out = Float64Array.from(pct);
  const k = 1 + Math.floor(rng() * (nD - 2));
  for (let ci = 0; ci < nC; ci += 1) {
    for (let di = 0; di < nD; di += 1) {
      out[di * nC + ci] = pct[((di + k) % nD) * nC + ci];
    }
  }
  return out;
}

const quantile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// ── self-check ───────────────────────────────────────────────────────────

function selfCheck(): void {
  const ok = (name: string, cond: boolean): void => {
    if (!cond) throw new Error(`self-check FAILED: ${name}`);
    console.log(`  ok  ${name}`);
  };

  // 1. The whole t-stat rests on this: the mean of the rank products IS the
  //    Spearman rho. If it drifts, the reported IC and its standard error stop
  //    describing the same quantity.
  const x = [3, 1, 4, 1, 5, 9, 2, 6, 8, 7];
  const y = [-1, 0.5, 2, 0.1, 3, 8, -2, 4, 6, 5];
  ok(
    'mean(rank products) === spearman',
    Math.abs(mean(icProducts(x, y)) - spearman(x, y)) < 1e-10,
  );

  // 2. A trailing percentile must never see the future. The last value of a
  //    strictly increasing series is the highest SO FAR, which is 1.0; the same
  //    value early in a series that later rises must not be.
  const rising = Float64Array.from(Array.from({ length: 100 }, (_, i) => i));
  const p = trailingPct(rising, 365, 10);
  ok('trailing percentile of a rising series is 1.0 throughout', p[50] === 1 && p[99] === 1);
  const falling = Float64Array.from(Array.from({ length: 100 }, (_, i) => -i));
  const q = trailingPct(falling, 365, 10);
  ok('trailing percentile of a falling series is at its floor', q[99] < 0.02);
  ok('trailing percentile is NaN before minObs', !Number.isFinite(p[5]));

  // 3. Newey-West at lag 0 is the ordinary standard error.
  const s = [0.1, -0.2, 0.3, 0.05, -0.1, 0.22, -0.03, 0.14, 0.0, -0.08];
  const m = mean(s);
  const plain = Math.sqrt(s.reduce((a, v) => a + (v - m) ** 2, 0) / s.length / s.length);
  ok('Newey-West at lag 0 === sd/sqrt(n)', Math.abs(neweyWestSe(s, 0) - plain) < 1e-12);

  // 4. A circular shift is a permutation: it must move things and lose nothing.
  const nD = 50;
  const src = new Float64Array(nD);
  for (let i = 0; i < nD; i += 1) src[i] = i;
  const sh = shiftDays(src, 1, nD, makeRng(7));
  const sameSet =
    [...sh].sort((a, b) => a - b).every((v, i) => v === i) &&
    [...sh].some((v, i) => v !== src[i]);
  ok('circular shift permutes without loss', sameSet);

  console.log('\nself-check passed\n');
}

// ── run ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const t0 = Date.now();
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const endMs = Date.parse(`${END}T00:00:00Z`);

  console.log('\nON-CHAIN DIRECTION — do free on-chain metrics predict BTC and ETH?');
  console.log(`coins      ${COINS.join(', ')}  (USDT perpetuals for price)`);
  console.log(`window     ${START} -> ${END}`);
  console.log('sources    CoinMetrics Community (no key), DefiLlama (no key)');
  console.log('excluded   Glassnode 401, CryptoQuant 401, Dune needs a key\n');

  const candles = new Map<string, Daily[]>();
  for (const c of COINS) candles.set(c.toUpperCase(), await dailyCandles(c));

  const cm = await coinMetrics(
    COINS.map((c) => c.toLowerCase()).concat('usdt'),
    ['FlowInExNtv', 'FlowOutExNtv', 'SplyExNtv', 'SplyCur'],
  );
  const usdtEx = await usdtOnExchanges(CACHE);
  const usdtSply = cm.get('usdt:SplyCur')!;

  // The market-wide stablecoin ratio, one number per day, shared by both coins.
  const ratio = new Map<number, number>();
  for (const [day, ex] of usdtEx) {
    const sply = usdtSply.get(day);
    if (sply !== undefined && sply > 0 && Number.isFinite(ex)) ratio.set(day, ex / sply);
  }

  const coins = COINS.map((c) => c.toUpperCase()).sort();
  const nC = coins.length;
  const dayList = (candles.get(coins[0]) ?? [])
    .map((d) => d.day)
    .filter((d) => d >= startMs && d <= endMs);
  const days: number[] = [];
  for (const d of dayList) {
    if (coins.every((c) => candles.get(c)!.some((x) => x.day === d))) days.push(d);
  }
  const dayIdx = new Map(days.map((d, i) => [d, i]));

  const cols = [
    'close', ...METRICS.map((m) => m.key), ...METRICS.map((m) => `pct_${m.key}`),
    ...HORIZONS.map((h) => `fwd${h}d`),
  ];
  const data = new Map<string, Float64Array>();
  for (const c of cols) data.set(c, new Float64Array(days.length * nC).fill(NaN));

  coins.forEach((coin, ci) => {
    const bars = candles.get(coin)!;
    const byDay = new Map(bars.map((b) => [b.day, b.close]));
    const a = coin.toLowerCase();
    const inflow = cm.get(`${a}:FlowInExNtv`)!;
    const outflow = cm.get(`${a}:FlowOutExNtv`)!;
    const splyEx = cm.get(`${a}:SplyExNtv`)!;
    const sply = cm.get(`${a}:SplyCur`)!;

    // Netflow and exchange share as their own daily series, so the window sums
    // and differences below are one lookup each.
    const netflow = new Map<number, number>();
    const exShare = new Map<number, number>();
    for (const [day, i] of inflow) {
      const o = outflow.get(day);
      if (o !== undefined) netflow.set(day, i - o);
    }
    for (const [day, e] of splyEx) {
      const s = sply.get(day);
      if (s !== undefined && s > 0) exShare.set(day, e / s);
    }

    for (const day of days) {
      const di = dayIdx.get(day)!;
      const at = di * nC + ci;
      const close = byDay.get(day);
      if (close === undefined) continue;
      data.get('close')![at] = close;

      // Everything the decision reads is stamped at least PUBLICATION_LAG_DAYS
      // before the close it is read at. See the header.
      const asOf = day - PUBLICATION_LAG_DAYS * DAY_MS;
      data.get('netflow7')![at] = windowSum(netflow, asOf, 7);
      data.get('usdtExRatio')![at] = ratio.get(asOf) ?? NaN;
      data.get('usdtExRatioChg7')![at] = change(ratio, asOf, 7);
      data.get('splyExChg7')![at] = change(exShare, asOf, 7);

      for (const h of HORIZONS) {
        const fwd = byDay.get(day + h * DAY_MS);
        // A horizon whose last bar has not closed is NaN, not a shorter return.
        if (fwd !== undefined) data.get(`fwd${h}d`)![at] = Math.log(fwd / close);
      }
    }

    // Trailing deciles, per coin, from that coin's own history only.
    for (const m of METRICS) {
      const own = new Float64Array(days.length);
      for (let di = 0; di < days.length; di += 1) own[di] = data.get(m.key)![di * nC + ci];
      const p = trailingPct(own, LOOKBACK, MIN_LOOKBACK);
      for (let di = 0; di < days.length; di += 1) data.get(`pct_${m.key}`)![di * nC + ci] = p[di];
    }
  });

  const panel: Panel = { coins, days, data };

  const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(8))) : '');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = [['coin', 'day', ...cols].join(',')];
  for (let di = 0; di < days.length; di += 1) {
    for (let ci = 0; ci < nC; ci += 1) {
      const at = di * nC + ci;
      if (!Number.isFinite(data.get('close')![at])) continue;
      lines.push(
        [coins[ci], new Date(days[di]).toISOString().slice(0, 10)]
          .concat(cols.map((c) => fmt(data.get(c)![at])))
          .join(','),
      );
    }
  }
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);

  const tests = METRICS.length * nC * HORIZONS.length;
  const tail = 2 * (1 - normalCdf(BAR));
  console.log(`\npanel      ${days.length} days x ${nC} coins = ${lines.length - 1} rows`);
  console.log(`            ${new Date(days[0]).toISOString().slice(0, 10)} -> ${new Date(days[days.length - 1]).toISOString().slice(0, 10)}`);
  console.log(`written    ${OUT}`);

  console.log('\n── pre-registered, before any result ──');
  for (const m of METRICS) console.log(`metric     ${m.key.padEnd(16)} ${m.label}`);
  console.log('metric     whaleTxCnt       NOT TESTED — absent from every keyless source');
  console.log(`IC         time-series, per coin (cross-sectional over 2 assets is degenerate)`);
  console.log(`horizons   ${HORIZONS.join('d, ')}d`);
  console.log(`tests      ${tests}  (${METRICS.length} metrics x ${nC} coins x ${HORIZONS.length} horizons)`);
  console.log(`bar 1      |t| > ${BAR.toFixed(1)}  Newey-West, lag = horizon`);
  console.log(`           expected false passes at that bar: ${(tests * tail).toFixed(2)}`);
  console.log(`bar 2      top/bottom ${(DECILE * 100).toFixed(0)}% decile long-short must clear ${FEE_BP} bp round trip`);
  console.log(`bar 3      must beat ${SHUFFLES} shuffled controls, interval excluding zero`);
  console.log(`interval   ${BLOCK_DAYS}-day block bootstrap, ${DRAWS} draws, seed ${SEED}`);
  console.log(`gate       ${PERSIST_LAG}-day rank persistence under ${MAX_PERSIST.toFixed(2)}`);
  console.log(`lag        every metric read ${PUBLICATION_LAG_DAYS} day late (CoinMetrics publishes ~02:34 next day)`);
  console.log(`deciles    trailing ${LOOKBACK} days, min ${MIN_LOOKBACK} — never the full sample`);

  console.log('\n── coverage ──');
  const cells = days.length * nC;
  for (const m of METRICS) {
    const arr = data.get(m.key)!;
    const pArr = data.get(`pct_${m.key}`)!;
    let n = 0;
    let np = 0;
    for (let i = 0; i < cells; i += 1) {
      if (Number.isFinite(arr[i])) n += 1;
      if (Number.isFinite(pArr[i])) np += 1;
    }
    console.log(`  ${m.key.padEnd(16)} ${((n / cells) * 100).toFixed(1).padStart(6)}% raw   ${((np / cells) * 100).toFixed(1).padStart(6)}% with a trailing decile`);
  }

  const results: Result[] = [];
  for (const m of METRICS) {
    for (let ci = 0; ci < nC; ci += 1) {
      for (const h of HORIZONS) results.push(measure(panel, m.key, ci, h));
    }
  }

  const byT = (a: Result, b: Result): number => Math.abs(b.t) - Math.abs(a.t);
  const row = (r: Result): string =>
    `  ${r.metric.padEnd(16)} ${r.coin.padEnd(4)} ${r.horizon}d  IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}  ` +
    `t ${r.t.toFixed(2).padStart(6)}  boot [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  ` +
    `persist ${r.persist.toFixed(2).padStart(5)}  n ${String(r.n).padStart(4)}`;

  console.log('\n── all tests, by |t| ──');
  [...results].sort(byT).forEach((r) => console.log(row(r)));

  const overBar = results.filter((r) => Number.isFinite(r.t) && Math.abs(r.t) > BAR).sort(byT);
  console.log(`\n── BAR 1: |t| > ${BAR.toFixed(1)} ──`);
  if (overBar.length === 0) console.log('  none');
  else overBar.forEach((r) => console.log(row(r)));

  const best = [...results].sort(byT)[0];
  const priced = overBar.length > 0 ? overBar : [best];
  console.log(
    overBar.length > 0
      ? '\n── BARS 2-3, on everything that cleared bar 1 ──'
      : '\n── BARS 2-3, on the largest |t| even though it did NOT clear bar 1 ──',
  );

  const verdicts: Array<{ r: Result; pass: boolean; netBp: number }> = [];
  for (const r of priced) {
    // The sign is fitted on the same data it is scored on. That can only
    // FLATTER the result, so a failure here is real and a pass is optimistic.
    const sign = r.ic >= 0 ? 1 : -1;
    const p = price(panel, r.metric, r.horizon, sign);
    const netFull = p.grossBp - FEE_BP;
    const feeMeasured = FEE_BP * p.turnover;
    const boot = blockBootstrapMean(
      p.rows.map((x) => ({ time: x.time, value: x.value - FEE_BP })),
      BLOCK_DAYS,
      DRAWS,
      SEED,
    );

    const rngA = makeRng(SEED);
    const rngB = makeRng(SEED + 1);
    const pct = panel.data.get(`pct_${r.metric}`)!;
    const iid: number[] = [];
    const shift: number[] = [];
    for (let s = 0; s < SHUFFLES; s += 1) {
      const a = price(panel, r.metric, r.horizon, sign, permuteDays(pct, nC, days.length, rngA));
      if (Number.isFinite(a.grossBp)) iid.push(a.grossBp);
      const b = price(panel, r.metric, r.horizon, sign, shiftDays(pct, nC, days.length, rngB));
      if (Number.isFinite(b.grossBp)) shift.push(b.grossBp);
    }
    iid.sort((a, b) => a - b);
    shift.sort((a, b) => a - b);
    const pIid = (iid.filter((v) => v >= p.grossBp).length + 1) / (iid.length + 1);
    const pShift = (shift.filter((v) => v >= p.grossBp).length + 1) / (shift.length + 1);

    const bar1 = Math.abs(r.t) > BAR;
    const bar2 = Number.isFinite(netFull) && netFull > 0;
    const bar3 = Number.isFinite(p.grossBp) && p.grossBp > quantile(iid, 0.975) && p.grossBp > quantile(shift, 0.975);
    const gate = Number.isFinite(r.persist) && Math.abs(r.persist) < MAX_PERSIST;

    console.log(`\n  ${r.metric} / ${r.coin} @ ${r.horizon}d   sign ${sign > 0 ? 'long-high' : 'long-low'}`);
    console.log(`    IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}   t ${r.t.toFixed(2)}   n ${r.n} days`);
    console.log(`    in market        ${p.daysInMarket} of ${days.length} days (${((p.daysInMarket / days.length) * 100).toFixed(0)}%)`);
    console.log(`    gross            ${p.grossBp.toFixed(2).padStart(8)} bp per ${r.horizon}d hold`);
    console.log(`    turnover         ${(p.turnover * 100).toFixed(1).padStart(8)} % of gross per rebalance`);
    console.log(`    fee, measured    ${feeMeasured.toFixed(2).padStart(8)} bp    net ${(p.grossBp - feeMeasured).toFixed(2)} bp`);
    console.log(`    fee, full ${FEE_BP} bp  ${FEE_BP.toFixed(2).padStart(8)} bp    net ${netFull.toFixed(2)} bp   95% CI [${boot.lo.toFixed(2)}, ${boot.hi.toFixed(2)}]`);
    console.log(`    shuffle, iid     95% band [${quantile(iid, 0.025).toFixed(2)}, ${quantile(iid, 0.975).toFixed(2)}] bp,  p = ${pIid.toFixed(4)}`);
    console.log(`    shuffle, shifted 95% band [${quantile(shift, 0.025).toFixed(2)}, ${quantile(shift, 0.975).toFixed(2)}] bp,  p = ${pShift.toFixed(4)}`);
    console.log(`    ${PERSIST_LAG}d persistence  ${r.persist.toFixed(3)}`);
    console.log(
      `    BAR 1 |t|>${BAR.toFixed(1)}  ${bar1 ? 'PASS' : 'FAIL'}` +
      `   BAR 2 pays ${FEE_BP}bp  ${bar2 ? 'PASS' : 'FAIL'}` +
      `   BAR 3 shuffle  ${bar3 ? 'PASS' : 'FAIL'}` +
      `   persistence gate  ${gate ? 'PASS' : 'FAIL'}`,
    );
    verdicts.push({ r, pass: bar1 && bar2 && bar3, netBp: netFull });
  }

  console.log('\n── VERDICT ──');
  const won = verdicts.filter((v) => v.pass);
  if (won.length === 0) {
    console.log('  No metric passes all three bars.');
    console.log('  ON-CHAIN DIRECTION IS DEAD ON FREE DATA.');
  } else {
    for (const v of won) {
      console.log(`  ${v.r.metric} / ${v.r.coin} @ ${v.r.horizon}d passes all three bars.`);
      console.log(`  net ${v.netBp.toFixed(2)} bp per ${v.r.horizon}-day hold after a full ${FEE_BP} bp round trip.`);
    }
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) {
  if (args.includes('--self-check')) selfCheck();
  else {
    run().catch((e: unknown) => {
      console.error(e instanceof Error ? e.stack : e);
      process.exit(1);
    });
  }
}
