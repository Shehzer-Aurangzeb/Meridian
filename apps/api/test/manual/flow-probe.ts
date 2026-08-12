/**
 * STEP 0 for the flow-signal plan: what is actually fetchable, and how far back?
 *
 *   npx ts-node test/manual/flow-probe.ts
 *   npx ts-node test/manual/flow-probe.ts --coins BTC,ETH
 *
 * Builds NOTHING. Answers one question per endpoint — earliest timestamp,
 * cadence, per-request cap, and whether all ten coins are covered — so the
 * plan is written against measured availability rather than documented
 * availability. The two differ, and the difference is the whole point of
 * running this before writing a line of feature code.
 *
 * Read-only against public endpoints. No key, no signing, no orders.
 */
const args = process.argv.slice(2);
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,DOT,LINK,LTC')
  .split(',')
  .map((c) => `${c.trim().toUpperCase()}USDT`);

const BASE = 'https://fapi.binance.com';
const DAY = 86_400_000;
const NOW = Date.now();

const iso = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const days = (t: number): string => `${((NOW - t) / DAY).toFixed(0)}d ago`;

/** Politeness delay — these are weighted endpoints and we are not in a hurry. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Probe {
  ok: boolean;
  status: number;
  rows: unknown[];
  error?: string;
}

async function get(path: string, params: Record<string, string | number>): Promise<Probe> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  try {
    const res = await fetch(`${BASE}${path}?${qs}`);
    const body = await res.json();
    if (!res.ok) {
      return { ok: false, status: res.status, rows: [], error: JSON.stringify(body).slice(0, 160) };
    }
    // A non-array 200 is an error envelope, not a result. Counting it as one
    // row is how `limit=1500` first read as "1 row available" rather than
    // "rejected" — a silent wrong answer in an availability check.
    if (!Array.isArray(body)) {
      return { ok: false, status: res.status, rows: [], error: JSON.stringify(body).slice(0, 160) };
    }
    return { ok: true, status: res.status, rows: body };
  } catch (e) {
    return { ok: false, status: 0, rows: [], error: (e as Error).message.slice(0, 160) };
  }
}

/** Median gap between consecutive timestamps — the cadence, measured not assumed. */
function cadence(times: number[]): string {
  if (times.length < 3) return '—';
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const m = gaps[Math.floor(gaps.length / 2)];
  return m % 3_600_000 === 0 ? `${m / 3_600_000}h` : `${(m / 60_000).toFixed(0)}m`;
}

const timeField = (r: Record<string, unknown>): number =>
  Number(r.fundingTime ?? r.timestamp ?? r.time ?? r.T ?? 0);

// ── 1. funding rate ─────────────────────────────────────────────────────

async function probeFunding(): Promise<void> {
  console.log('\n═══ 1. FUNDING RATE  /fapi/v1/fundingRate ═══');
  const out: Array<Record<string, string | number>> = [];

  // startTime=0 does NOT mean "from the beginning" — the endpoint ignored it
  // and returned the NEWEST `limit` rows, which read as "history starts 166
  // days ago" for BTC. Walk explicit windows oldest-first instead: the first
  // window that returns rows contains the true start of history.
  const probes = [
    Date.UTC(2019, 8, 1), Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1),
    Date.UTC(2022, 0, 1), Date.UTC(2023, 0, 1), Date.UTC(2023, 7, 1),
    Date.UTC(2024, 0, 1), Date.UTC(2025, 0, 1),
  ];

  for (const symbol of COINS) {
    let earliest: number | null = null;
    for (const start of probes) {
      const r = await get('/fapi/v1/fundingRate', {
        symbol, startTime: start, endTime: start + 60 * DAY, limit: 1000,
      });
      await sleep(130);
      if (r.ok && r.rows.length > 0) {
        earliest = Math.min(...r.rows.map((x) => timeField(x as Record<string, unknown>)));
        break;
      }
    }

    // Cadence and the real per-request cap, measured on a populated window.
    const win = await get('/fapi/v1/fundingRate', {
      symbol, startTime: Date.UTC(2024, 0, 1), endTime: Date.UTC(2025, 0, 1), limit: 1000,
    });
    await sleep(130);
    const over = await get('/fapi/v1/fundingRate', {
      symbol, startTime: Date.UTC(2024, 0, 1), endTime: Date.UTC(2025, 0, 1), limit: 1500,
    });
    await sleep(130);
    const times = win.rows.map((x) => timeField(x as Record<string, unknown>));

    out.push({
      symbol,
      'earliest funding': earliest ? iso(earliest) : 'NONE FOUND',
      age: earliest ? days(earliest) : '—',
      cadence: cadence(times),
      'rows/req (limit=1000)': win.ok ? win.rows.length : `ERR ${win.status}`,
      'limit=1500': over.ok ? `${over.rows.length}` : `REJECTED ${over.status}`,
    });
  }
  console.table(out);
}

// ── 2-4. the /futures/data/ family ──────────────────────────────────────

async function probeFuturesData(
  label: string,
  path: string,
  extra: Record<string, string | number> = {},
): Promise<void> {
  console.log(`\n═══ ${label}  ${path} ═══`);

  // How far back does it go? Walk backwards until a window comes back empty.
  const symbol = COINS[0];
  const windows = [7, 30, 45, 60, 90, 180, 365, 730];
  const reach: Array<Record<string, string | number>> = [];
  for (const d of windows) {
    const r = await get(path, {
      symbol,
      period: '1h',
      limit: 500,
      startTime: NOW - d * DAY,
      endTime: NOW - (d - 7) * DAY,
      ...extra,
    });
    await sleep(150);
    const times = r.rows.map((x) => timeField(x as Record<string, unknown>));
    reach.push({
      [`window starting ${d}d ago`]: r.ok ? `${r.rows.length} rows` : `ERR ${r.status}`,
      oldest: times.length ? iso(Math.min(...times)) : '—',
      note: r.error ?? (r.rows.length === 0 ? 'EMPTY — beyond retention' : ''),
    });
  }
  console.table(reach);

  // Cadence + per-request cap on a window we know is populated.
  const recent = await get(path, { symbol, period: '1h', limit: 500, ...extra });
  await sleep(150);
  const over = await get(path, { symbol, period: '1h', limit: 1000, ...extra });
  await sleep(150);
  const times = recent.rows.map((x) => timeField(x as Record<string, unknown>));
  console.log(
    `  ${symbol}: limit=500 → ${recent.rows.length} rows · limit=1000 → ` +
      `${over.ok ? over.rows.length : `ERR ${over.status}`} · cadence ${cadence(times)}` +
      `${times.length ? ` · newest ${iso(Math.max(...times))}` : ''}`,
  );

  // Coverage across all ten coins.
  const cov: Array<Record<string, string | number>> = [];
  for (const s of COINS) {
    const r = await get(path, { symbol: s, period: '1h', limit: 30, ...extra });
    await sleep(120);
    const t = r.rows.map((x) => timeField(x as Record<string, unknown>));
    cov.push({
      symbol: s,
      rows: r.ok ? r.rows.length : `ERR ${r.status}`,
      oldest: t.length ? iso(Math.min(...t)) : '—',
      fields: r.rows.length ? Object.keys(r.rows[0] as object).join(' ') : (r.error ?? '—'),
    });
  }
  console.table(cov);
}

// ── 5. liquidations ─────────────────────────────────────────────────────

async function probeLiquidations(): Promise<void> {
  console.log('\n═══ 5. LIQUIDATIONS ═══');
  const out: Array<Record<string, string | number>> = [];
  // Every historical liquidation surface Binance has ever exposed on REST.
  for (const path of ['/fapi/v1/allForceOrders', '/fapi/v1/forceOrders']) {
    const r = await get(path, { symbol: COINS[0], limit: 100 });
    await sleep(150);
    out.push({
      endpoint: path,
      status: r.ok ? 'OK' : `HTTP ${r.status}`,
      rows: r.rows.length,
      note: r.error ?? '',
    });
  }
  console.table(out);
}

// ── 6. kline-shaped perp surfaces — do these carry history? ─────────────
//
// If the /futures/data/ family is capped at 30 days, the question becomes
// whether the same information is reachable some other way. Premium index,
// mark price and index price are all served as KLINES, and klines have
// historically been long-retention. Basis = (mark - index) / index is the
// perp premium at 1h granularity, which is what funding is a smoothed 8h
// sample OF — a strictly richer surface if the history is there.
async function probeKlineSurfaces(): Promise<void> {
  console.log('\n═══ 6. KLINE-SHAPED PERP SURFACES ═══');
  const paths = [
    '/fapi/v1/premiumIndexKlines',
    '/fapi/v1/markPriceKlines',
    '/fapi/v1/indexPriceKlines',
    '/fapi/v1/klines',
  ];
  const out: Array<Record<string, string | number>> = [];
  for (const path of paths) {
    // indexPriceKlines takes `pair`, the others take `symbol`.
    const key = path.includes('indexPrice') ? 'pair' : 'symbol';
    const old = await get(path, {
      [key]: 'BTCUSDT', interval: '1h', limit: 5,
      startTime: Date.UTC(2023, 7, 10), endTime: Date.UTC(2023, 7, 11),
    });
    await sleep(150);
    const cap = await get(path, { [key]: 'BTCUSDT', interval: '1h', limit: 1500 });
    await sleep(150);
    out.push({
      endpoint: path,
      '2023-08-10 reachable': old.ok && old.rows.length > 0 ? `YES (${old.rows.length} rows)` : `NO`,
      oldest: old.rows.length ? iso(Number((old.rows[0] as unknown[])[0])) : (old.error ?? '—'),
      'max rows/req': cap.ok ? cap.rows.length : `ERR ${cap.status}`,
    });
  }
  console.table(out);

  // All ten coins at the window start, and the field shape.
  const cov: Array<Record<string, string | number>> = [];
  for (const symbol of COINS) {
    const r = await get('/fapi/v1/premiumIndexKlines', {
      symbol, interval: '1h', limit: 3, startTime: Date.UTC(2023, 7, 10),
    });
    await sleep(120);
    cov.push({
      symbol,
      'premium @ 2023-08-10': r.ok && r.rows.length ? 'OK' : `MISSING ${r.error ?? ''}`,
      'first open time': r.rows.length ? iso(Number((r.rows[0] as unknown[])[0])) : '—',
      'close value': r.rows.length ? String((r.rows[0] as unknown[])[4]) : '—',
    });
  }
  console.table(cov);
}

// ── 7. funding coverage inside the actual study window ──────────────────

async function probeFundingCoverage(): Promise<void> {
  console.log('\n═══ 7. FUNDING COVERAGE, 2023-08-10 → 2026-08-09 ═══');
  const from = Date.UTC(2023, 7, 10);
  const to = Date.UTC(2026, 7, 9);
  const expected = Math.floor((to - from) / (8 * 3_600_000));
  const out: Array<Record<string, string | number>> = [];

  for (const symbol of COINS) {
    const times: number[] = [];
    let cursor = from;
    // Page forward at the measured 1000-row cap.
    for (let page = 0; page < 8 && cursor < to; page += 1) {
      const r = await get('/fapi/v1/fundingRate', {
        symbol, startTime: cursor, endTime: to, limit: 1000,
      });
      await sleep(130);
      if (!r.ok || r.rows.length === 0) break;
      const t = r.rows.map((x) => timeField(x as Record<string, unknown>));
      times.push(...t);
      cursor = Math.max(...t) + 1;
    }
    const uniq = [...new Set(times)].sort((a, b) => a - b);
    const gaps = uniq.slice(1).filter((t, i) => t - uniq[i] > 8 * 3_600_000 * 1.5).length;
    out.push({
      symbol,
      rows: uniq.length,
      expected,
      coverage: `${((uniq.length / expected) * 100).toFixed(1)}%`,
      'gaps > 12h': gaps,
      first: uniq.length ? iso(uniq[0]) : '—',
      last: uniq.length ? iso(uniq[uniq.length - 1]) : '—',
    });
  }
  console.table(out);
}

async function main(): Promise<void> {
  console.log(`FLOW-SIGNAL DATA AVAILABILITY PROBE`);
  console.log(`${COINS.length} symbols · now ${iso(NOW)} · read-only, unauthenticated`);

  await probeFunding();
  await probeFuturesData('2. OPEN INTEREST', '/futures/data/openInterestHist');
  await probeFuturesData('3. LONG/SHORT ACCOUNT RATIO', '/futures/data/globalLongShortAccountRatio');
  await probeFuturesData('4. TAKER BUY/SELL VOLUME', '/futures/data/takerlongshortRatio');
  await probeLiquidations();
  await probeKlineSurfaces();
  await probeFundingCoverage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
