/**
 * Mid-cap direction — does anything predict weekly direction outside the majors?
 *
 *   pnpm --filter api midcap-direction
 *   pnpm --filter api midcap-direction -- --fee-bp 50
 *
 * ─── The question, and why it is worth asking again ──────────────────────
 * Twenty pre-registered tests found no directional edge in ten liquid majors.
 * The standard objection to that result is that the majors are the most
 * efficiently priced instruments in crypto, and that whatever edge exists lives
 * further down the volume ranking where fewer participants are looking.
 *
 * This tests that objection directly: the same weekly cross-sectional
 * methodology, on 90 coins ranked #11-#100 by volume, with the ten majors
 * removed because they are already dead.
 *
 * The statistical core is `weekly-direction.ts`, imported rather than copied —
 * same IC, same Newey-West lag, same 30-week block bootstrap, same shuffle,
 * same persistence gate. A second implementation of the same test that happened
 * to disagree would be indistinguishable from a discovery.
 *
 * ─── What is different, beyond the universe ──────────────────────────────
 *
 * **The fee is 50 bp, not 14.** Mid-caps are thinner. Quoting a mid-cap result
 * against a major's round trip would be comparing a wider spread to a narrower
 * one and calling the difference alpha.
 *
 * **`oiChange` is gone.** `/futures/data/openInterestHist` retains about 30
 * days and the flow collector — off since 5 September 2026 — only ever wrote
 * the ten majors. There is no open-interest history for any coin in this
 * universe at any price, so the feature is dropped rather than filled with a
 * shorter window that would silently make a 3.6-year question into a monthly
 * one.
 *
 * **Funding is fetched from Binance, not from `FlowSample`.** Same reason:
 * `FlowSample` holds ten symbols. `/fapi/v1/fundingRate` publishes years of
 * history and pages at 1000. That endpoint is the one methodology rule 7 was
 * written about — it caps `limit` at 500 while accepting 1000, and reading the
 * short page as the end of history once truncated a 2,200-day backfill to 166
 * days while reporting no failures. So this pages by timestamp and stops only
 * when a page comes back empty.
 *
 * ─── The bias this test cannot remove, stated up front ───────────────────
 * The universe is chosen by CURRENT volume and then tested backwards. Coins
 * that were liquid in 2023 and have since died are absent, and every coin here
 * survived to be ranked. That is survivorship bias and it points one way: it
 * flatters the result. A pass would need this discounted; a failure is if
 * anything strengthened by it, because the sample is already tilted toward the
 * winners.
 *
 * ─── Four falsification bars, pre-registered ─────────────────────────────
 *   1. Some feature clears |t| > 3.0.
 *   2. Priced top-3 vs bottom-3, it clears a 50 bp round trip.
 *   3. It beats its own shuffled control by an interval excluding zero.
 *   4. It is not momentum: |corr| with the 4-week backward return under 0.70.
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { Candle } from '../../src/common/types/candle.types';
import {
  Panel, Row, Result, assemble, extremes, measure, price, permuted, weeklyCandles,
} from './weekly-direction';
import { mean, normalCdf } from './phase-b';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const START = str('start', '2023-01-01');
const OUT = str('out', 'test/manual/results/midcap-direction.csv');
const CACHE = str('cache', path.join(process.env.HOME ?? '', 'meridian-archive/midcap'));
/** Already tested to death on 1h and weekly bars. */
const MAJORS = str('majors', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC')
  .split(',')
  .map((c) => c.toUpperCase());
const UNIVERSE_SIZE = num('universe', 100);
/** Candidates to measure 30-day volume on before ranking. */
const CANDIDATES = num('candidates', 160);
const FETCH = num('fetch', 400);
const CTX = num('ctx', 60);
const HIGH_LOW_WEEKS = 20;
const HORIZONS = [1, 2, 4];
const BAR = num('bar', 3.0);
/** The mid-cap round trip. Wider than a major's, because these books are thinner. */
const FEE_BP = num('fee-bp', 50);
const MAX_PERSIST = num('max-persist', 0.5);
const MOMENTUM_BAR = num('momentum-bar', 0.7);
const SHUFFLES = num('shuffles', 1000);
const SEED = num('seed', 12345);
const MIN_WEEKS = num('min-weeks', 60);

const WEEK_MS = TIMEFRAME_MS['1w'];

/**
 * Twelve features, not thirteen. `oiChange` is absent and cannot be obtained —
 * see the header.
 */
const FEATURES = [
  'rsi', 'adx', 'diSpread', 'percentB', 'bandWidth', 'bandWidthPct',
  'atrPct', 'qqe', 'funding', 'volChange', 'dist20wHigh', 'dist20wLow',
] as const;

const cacheRead = <T>(name: string): T | null => {
  const file = path.join(CACHE, name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
};
const cacheWrite = (name: string, value: unknown): void => {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, name), JSON.stringify(value));
};

// ── the universe ─────────────────────────────────────────────────────────

/**
 * Top `UNIVERSE_SIZE` USDT perps by 30-day average quote volume, minus the
 * majors.
 *
 * Ranked on the last 30 days rather than on a 24-hour ticker, because one day
 * of a coin being briefly fashionable is not liquidity. The 24-hour ticker is
 * used only to pick which coins are worth measuring properly — it costs one
 * request for the whole exchange, where measuring all ~500 perps would cost
 * one each.
 */
async function buildUniverse(): Promise<string[]> {
  const cached = cacheRead<string[]>('universe.json');
  if (cached) {
    console.log(`universe   ${cached.length} coins, from cache`);
    return cached;
  }

  const { data } = await axios.get<Array<{ symbol: string; quoteVolume: string }>>(
    'https://fapi.binance.com/fapi/v1/ticker/24hr',
    { timeout: 60_000 },
  );

  const candidates = data
    .filter((t) => t.symbol.endsWith('USDT'))
    .map((t) => ({ coin: t.symbol.replace(/USDT$/, ''), vol24h: parseFloat(t.quoteVolume) }))
    .filter((t) => Number.isFinite(t.vol24h) && t.vol24h > 0)
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, CANDIDATES);

  console.log(`ranking    ${candidates.length} candidates by 30-day average volume`);

  const measured: Array<{ coin: string; vol30d: number }> = [];
  for (const c of candidates) {
    try {
      const { data: kl } = await axios.get<Array<Array<string | number>>>(
        'https://fapi.binance.com/fapi/v1/klines',
        { params: { symbol: `${c.coin}USDT`, interval: '1d', limit: 30 }, timeout: 60_000 },
      );
      const quote = kl.map((k) => parseFloat(k[7] as string)).filter(Number.isFinite);
      if (quote.length >= 25) measured.push({ coin: c.coin, vol30d: mean(quote) });
    } catch {
      // A coin whose klines will not load is not in the universe. Silence here
      // is fine: it cannot be ranked, so it cannot be selected.
    }
  }

  const universe = measured
    .sort((a, b) => b.vol30d - a.vol30d)
    .slice(0, UNIVERSE_SIZE)
    .map((m) => m.coin)
    .filter((c) => !MAJORS.includes(c));

  cacheWrite('universe.json', universe);
  return universe;
}

// ── funding, from the endpoint rule 7 was written about ──────────────────

/**
 * Every funding print for one coin since `fromMs`, paged forward by time.
 *
 * `/fapi/v1/fundingRate` ACCEPTS limit=1000 and CAPS at 500. Reading the short
 * page as the end of history is what once truncated a 2,200-day backfill to 166
 * days while reporting no failures, so this pages until a request returns
 * nothing and never infers the end from a page being shorter than asked for.
 */
async function fundingFor(coin: string, fromMs: number): Promise<Map<number, number>> {
  const cached = cacheRead<Array<[number, number]>>(`funding-${coin}.json`);
  const prints: Array<[number, number]> = cached ?? [];

  if (!cached) {
    let cursor = fromMs;
    for (let page = 0; page < 40; page += 1) {
      const { data } = await axios.get<Array<{ fundingTime: number; fundingRate: string }>>(
        'https://fapi.binance.com/fapi/v1/fundingRate',
        {
          params: { symbol: `${coin}USDT`, startTime: cursor, limit: 1000 },
          timeout: 60_000,
        },
      );
      if (data.length === 0) break;
      for (const d of data) prints.push([d.fundingTime, parseFloat(d.fundingRate)]);
      const last = data[data.length - 1].fundingTime;
      if (last <= cursor) break;
      cursor = last + 1;
    }
    cacheWrite(`funding-${coin}.json`, prints);
  }

  // Mean of the week's 8-hourly prints, bucketed into the week that CLOSES
  // after them. A print stamped exactly at the close belongs to the next week
  // and must not be readable at that close.
  const sums = new Map<number, { s: number; n: number }>();
  for (const [ts, rate] of prints) {
    if (!Number.isFinite(rate)) continue;
    const openMs = Math.floor((ts - 345_600_000) / WEEK_MS) * WEEK_MS + 345_600_000;
    const cell = sums.get(openMs) ?? { s: 0, n: 0 };
    cell.s += rate;
    cell.n += 1;
    sums.set(openMs, cell);
  }
  return new Map([...sums].map(([k, v]) => [k, v.s / v.n]));
}

// ── one coin's rows ──────────────────────────────────────────────────────

async function buildCoin(
  coin: string,
  indicators: IndicatorsService,
  startMs: number,
): Promise<Row[]> {
  const cacheName = `candles-${coin}.json`;
  let candles = cacheRead<Array<[number, number, number, number, number, number]>>(cacheName)
    ?.map(([t, o, h, l, c, v]) => ({ time: new Date(t), open: o, high: h, low: l, close: c, volume: v })) ?? null;
  if (!candles) {
    candles = await weeklyCandles(coin, FETCH);
    cacheWrite(cacheName, candles.map((c) => [c.time.getTime(), c.open, c.high, c.low, c.close, c.volume]));
  }
  if (candles.length < CTX + HIGH_LOW_WEEKS + 8) return [];

  const funding = await fundingFor(coin, Date.parse(START) - 8 * WEEK_MS);

  // The last bar is still forming: it holds days that have not happened.
  const lastComplete = candles.length - 2;
  const rows: Row[] = [];

  for (let i = Math.max(CTX, HIGH_LOW_WEEKS, 4); i <= lastComplete - 1; i += 1) {
    const bar = candles[i];
    const openMs = bar.time.getTime();
    if (openMs < startMs) continue;
    const price_ = bar.close;

    const ctx = indicators.buildContext(coin, '1w', candles.slice(i - CTX + 1, i + 1));
    const { upper, lower } = ctx.bollingerBands;
    const prevVol = candles[i - 1].volume;
    const { hi, lo } = extremes(candles, i, HIGH_LOW_WEEKS);

    const v = new Map<string, number>();
    v.set('close', price_);
    v.set('rsi', ctx.rsi);
    v.set('adx', ctx.adx.adx);
    v.set('diSpread', ctx.adx.pdi - ctx.adx.mdi);
    v.set('percentB', upper === lower ? NaN : (price_ - lower) / (upper - lower));
    v.set('bandWidth', ctx.bandWidth);
    v.set('bandWidthPct', indicators.percentileRank(ctx.bandWidth, [...ctx.bandWidthSeries]));
    v.set('atrPct', (ctx.atr / price_) * 100);
    v.set('qqe', ctx.qqe.value);
    v.set('funding', funding.get(openMs) ?? NaN);
    v.set('volChange', bar.volume > 0 && prevVol > 0 ? Math.log(bar.volume / prevVol) : NaN);
    v.set('dist20wHigh', ((price_ - hi) / price_) * 100);
    v.set('dist20wLow', ((price_ - lo) / price_) * 100);

    for (const h of HORIZONS) {
      v.set(`fwd${h}w`, i + h <= lastComplete ? Math.log(candles[i + h].close / price_) : NaN);
    }
    v.set('back4w', Math.log(price_ / candles[i - 4].close));

    rows.push({ closeMs: openMs + WEEK_MS, values: v });
  }
  return rows;
}

// ── main ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const t0 = Date.now();
  const indicators = new IndicatorsService();
  const startMs = Date.parse(`${START}T00:00:00Z`);

  console.log('\nMID-CAP DIRECTION — weekly, coins #11-#100 by volume');
  const universe = await buildUniverse();

  console.log(`\n── pre-registered, before any result ──`);
  console.log(`universe   top ${UNIVERSE_SIZE} by 30-day volume, minus the ${MAJORS.length} majors`);
  console.log(`features   ${FEATURES.length} (oiChange dropped — no history exists for these coins)`);
  console.log(`horizons   ${HORIZONS.join('w, ')}w`);
  console.log(`bar 1      some feature clears |t| > ${BAR.toFixed(1)}`);
  console.log(`bar 2      priced top-3 vs bottom-3, it clears a ${FEE_BP} bp round trip`);
  console.log(`bar 3      it beats its shuffled control by an interval excluding zero`);
  console.log(`bar 4      |momentum correlation| < ${MOMENTUM_BAR}`);
  console.log(`gate       weekly rank persistence < ${MAX_PERSIST}`);
  console.log(`WARNING    the universe is picked on CURRENT volume and tested backwards.`);
  console.log(`           Coins that died are absent. That bias flatters any pass.\n`);

  const byCoin = new Map<string, Row[]>();
  let skipped = 0;
  for (const coin of universe) {
    try {
      const rows = await buildCoin(coin, indicators, startMs);
      if (rows.length >= MIN_WEEKS) byCoin.set(coin, rows);
      else skipped += 1;
    } catch (err) {
      skipped += 1;
    }
    if (byCoin.size % 10 === 0 && byCoin.size > 0) process.stdout.write('.');
  }
  console.log('');

  const panel = assemble(byCoin);
  console.log(
    `panel      ${panel.times.length} weeks x ${panel.coins.length} coins ` +
      `(${skipped} coins skipped: under ${MIN_WEEKS} usable weeks or no data)`,
  );
  if (panel.coins.length < 20 || panel.times.length < 40) {
    console.log('\nNot enough panel to run the test. Stopping rather than reporting a thin result.');
    return;
  }
  console.log(
    `           ${new Date(panel.times[0]).toISOString().slice(0, 10)} -> ` +
      `${new Date(panel.times[panel.times.length - 1]).toISOString().slice(0, 10)}`,
  );

  const tests = FEATURES.length * HORIZONS.length;
  console.log(`tests      ${tests}, expected false passes at |t| > ${BAR}: ${(tests * 2 * (1 - normalCdf(BAR))).toFixed(2)}\n`);

  // ── the measurements ──
  const results: Result[] = [];
  for (const f of FEATURES) for (const h of HORIZONS) results.push(measure(panel, f, h));

  const lines = ['feature,horizon,n,ic,t,bootLo,bootHi,persist,momentum,grossBp,netBp,shuffleLo,shuffleHi'];
  const byT = (a: Result, b: Result): number => Math.abs(b.t) - Math.abs(a.t);
  const overBar = results.filter((r) => Number.isFinite(r.t) && Math.abs(r.t) > BAR).sort(byT);

  console.log(`── features over |t| > ${BAR.toFixed(1)} ──`);
  if (overBar.length === 0) console.log('  none');

  let anyPass = false;
  const passes: string[] = [];

  for (const r of overBar) {
    const sign = r.ic >= 0 ? 1 : -1;
    const priced = price(panel, r.feature, r.horizon, sign);
    const net = priced.grossBp - FEE_BP;

    // Shuffle control: the same book, on forward returns reassigned among the
    // coins present in each week. The market-wide move survives; only the
    // pairing dies.
    const rng = makeRng(SEED);
    const shuffled: number[] = [];
    for (let s = 0; s < SHUFFLES; s += 1) {
      const y = permuted(panel, r.horizon, rng);
      const p = price(panel, r.feature, r.horizon, sign, y);
      if (Number.isFinite(p.grossBp)) shuffled.push(p.grossBp);
    }
    shuffled.sort((a, b) => a - b);
    const q = (p: number): number =>
      shuffled[Math.min(shuffled.length - 1, Math.max(0, Math.round(p * (shuffled.length - 1))))];
    const sLo = shuffled.length === 0 ? NaN : q(0.025);
    const sHi = shuffled.length === 0 ? NaN : q(0.975);

    const gatePersist = Math.abs(r.persist) < MAX_PERSIST;
    const bar2 = net > 0;
    const bar3 = priced.grossBp > sHi;
    const bar4 = Math.abs(r.momentum) < MOMENTUM_BAR;
    const all = gatePersist && bar2 && bar3 && bar4;
    if (all) {
      anyPass = true;
      passes.push(`${r.feature} @${r.horizon}w (net ${net.toFixed(1)} bp)`);
    }

    console.log(
      `\n  ${r.feature} @${r.horizon}w  IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}  t ${r.t.toFixed(2)}  n ${r.n}`,
    );
    console.log(
      `    gross ${priced.grossBp.toFixed(1)} bp, 95% [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}] on IC, turnover ${priced.turnover.toFixed(2)}`,
    );
    console.log(
      `    bar 2  net@${FEE_BP} = ${net.toFixed(1)} bp  ${bar2 ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `    bar 3  shuffled 95% [${sLo.toFixed(1)}, ${sHi.toFixed(1)}] bp  ${bar3 ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `    bar 4  momentum corr ${r.momentum.toFixed(3)}  ${bar4 ? 'PASS' : 'FAIL — it IS momentum'}`,
    );
    console.log(
      `    gate   persistence ${r.persist.toFixed(2)}  ${gatePersist ? 'ok' : 'FAIL — a coin label, not a forecast'}`,
    );
    console.log(`    ALL FOUR: ${all ? 'PASS' : 'FAIL'}`);

    lines.push([
      r.feature, r.horizon, r.n, r.ic, r.t, r.lo, r.hi, r.persist, r.momentum,
      priced.grossBp, net, sLo, sHi,
    ].join(','));
  }

  console.log(`\n── largest |t| overall, whether or not it cleared ──`);
  for (const r of [...results].filter((x) => Number.isFinite(x.t)).sort(byT).slice(0, 5)) {
    console.log(
      `  ${r.feature.padEnd(14)} @${r.horizon}w  IC ${r.ic >= 0 ? '+' : ''}${r.ic.toFixed(4)}  ` +
        `t ${r.t.toFixed(2).padStart(6)}  persist ${r.persist.toFixed(2)}  momentum ${r.momentum.toFixed(2)}`,
    );
  }

  fs.writeFileSync(OUT, lines.join('\n') + '\n');

  console.log('\n── verdict ──');
  console.log(`bar 1 (|t| > ${BAR}): ${overBar.length > 0 ? `PASS — ${overBar.length} of ${tests}` : 'FAIL — nothing cleared'}`);
  if (anyPass) {
    console.log(`\nALL FOUR BARS PASSED: ${passes.join(', ')}`);
    console.log('Discount it for survivorship before believing it — see the header.');
  } else {
    console.log('\nNo feature passes all four bars.');
    console.log('MID-CAP DIRECTION IS DEAD ON THIS DATA.');
  }
  console.log(`\nwritten ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) {
  run().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
