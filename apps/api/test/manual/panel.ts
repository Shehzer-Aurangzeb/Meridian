/**
 * CROSS-SECTIONAL MOMENTUM PANEL — long/short direction test.
 *
 *   npx ts-node test/manual/panel.ts --self-check
 *   npx ts-node test/manual/panel.ts --out-dir /tmp/scratch
 *   npx ts-node test/manual/panel.ts --refresh        (re-download the panel)
 *
 * ─── What this tests ────────────────────────────────────────────────────
 * Rank the universe by trailing return; go LONG the top decile and SHORT
 * the bottom decile, equal weight, equal capital per leg. The output is a
 * DIRECTION per coin, which is the actual product requirement.
 *
 * Why this design and not long-only:
 *  - A market-neutral book removes market drift by construction. Every
 *    earlier result in STATE_OF_PLAY was ambiguous because "did the signal
 *    work" was entangled with "did crypto go up". Here it cannot be.
 *  - It gives shorts their only fair test: relative weakness against
 *    peers, rather than an absolute bet against a rising market.
 *  - It is venue-agnostic. Cost is a parameter, and the run reports the
 *    BREAKEVEN round-trip cost rather than assuming any exchange's fees.
 *
 * ─── Parameters, declared before the first run. No sweep. ───────────────
 *  | parameter        | value    | rationale                             |
 *  |------------------|----------|---------------------------------------|
 *  | formation        | 30 days  | standard medium-horizon momentum      |
 *  | skip             | 1 day    | avoid short-term reversal contamination|
 *  | rebalance / hold | 7 days   | weekly; survives manual execution     |
 *  | leg size         | 10%      | decile, floor of 3 coins per leg      |
 *  | min universe     | 20 coins | below this there is no cross-section  |
 *  | liquidity filter | top 100  | by trailing 30d median dollar volume  |
 *  | cost             | 0.14%    | round trip, charged on turnover       |
 *
 * ─── Known biases, stated up front ─────────────────────────────────────
 *  1. SURVIVORSHIP: the universe is built from pairs listed TODAY, so
 *     coins that were delisted are absent entirely. Delisted coins were
 *     usually losers, so their absence removes short-leg opportunities
 *     AND inflates the long leg's pool. This is the single most likely
 *     way this test produces a fake positive. Mitigated, not solved, by
 *     the point-in-time history + liquidity filter applied per date.
 *  2. FUNDING excluded. Crypto perp funding is usually mildly positive,
 *     meaning shorts RECEIVE it. Excluding it therefore understates the
 *     short leg — conservative in the direction that matters.
 *  3. Daily closes only. No intraday fills, no slippage curve.
 *
 * ponytail: no --formation / --hold / --decile flags. Adding them invites
 * the sweep that produced the retracted result in STATE_OF_PLAY 14c.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';
import axios from 'axios';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { Candle } from '../../src/common/types/candle.types';

// ── pre-registered constants ────────────────────────────────────────────
const FORMATION = 30;
const SKIP = 1;
const HOLD = 7;
const LEG_PCT = 0.1;
const MIN_LEG = 3;
const MIN_UNIVERSE = 20;
const MAX_UNIVERSE = 100;
const LIQ_WINDOW = 30;
const ROUND_TRIP_PCT = 0.14; // total, both sides; charged per unit turnover
const FUND_WINDOW = 7; // days of funding prints averaged into the signal
const BARS = 1200; // ~3.3y of daily, keeps the fetch to ~2 requests/coin

const args = process.argv.slice(2);
const flagStr = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OUT_DIR = flagStr('out-dir', '.');
const REFRESH = args.includes('--refresh');

/**
 * Which hypothesis to test. This selects a DISTINCT pre-registered
 * hypothesis, not a parameter value — momentum (price) vs funding
 * (positioning). It is not a sweep knob.
 *
 *  momentum — long the strongest trailing 30d return, short the weakest.
 *  funding  — CONTRARIAN on crowding: Binance funding is positive when
 *             longs pay shorts, so high funding = crowded long = short it,
 *             and low/negative funding = crowded short = long it. The
 *             signal is therefore NEGATED mean funding, which lets the same
 *             "long the top, short the bottom" code serve both.
 *
 * Funding SLOPE (whether crowding is building or unwinding) is NOT tested.
 */
const SIGNAL = (flagStr('signal', 'momentum') === 'funding' ? 'funding' : 'momentum') as
  | 'momentum'
  | 'funding';

let seed = 20260803;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

/** date (YYYY-MM-DD) -> { close, dollarVolume } per coin. */
interface Panel {
  coins: string[];
  dates: string[];
  data: Record<string, Record<string, { close: number; dv: number }>>;
}

/**
 * The date axis must be a CONTIGUOUS daily calendar, because every horizon
 * in this file is expressed as a number of array steps: `di - FORMATION`
 * means 30 days only if 30 steps equal 30 days.
 *
 * The raw union of coin dates is not contiguous. Building it from 400 pairs
 * produced a leading stretch covering exactly ONE delisted coin (FTT) and
 * then a 127-day hole, so a "30-day" signal spanning that hole actually
 * measured 157 days and a "7-day" hold spanned months.
 *
 * Fix: keep the longest run of consecutive calendar days on which at least
 * `minCoins` coins have data, and assert contiguity afterwards.
 */
export function trimToContiguous(panel: Panel, minCoins: number): Panel {
  const covered = panel.dates.filter(
    (d) => panel.coins.reduce((n, c) => n + (panel.data[c][d] ? 1 : 0), 0) >= minCoins,
  );
  const dayMs = 86_400_000;
  const asMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

  let bestStart = 0;
  let bestLen = 0;
  let runStart = 0;
  for (let i = 1; i <= covered.length; i++) {
    const broken =
      i === covered.length || asMs(covered[i]) - asMs(covered[i - 1]) !== dayMs;
    if (broken) {
      if (i - runStart > bestLen) {
        bestLen = i - runStart;
        bestStart = runStart;
      }
      runStart = i;
    }
  }
  const dates = covered.slice(bestStart, bestStart + bestLen);
  for (let i = 1; i < dates.length; i++) {
    if (asMs(dates[i]) - asMs(dates[i - 1]) !== dayMs) {
      throw new Error(`date axis not contiguous at ${dates[i - 1]} → ${dates[i]}`);
    }
  }
  return { ...panel, dates };
}

// Mechanical exclusions only — no judgement about which coins are good.
// Stablecoins and fiat have no momentum; leveraged tokens are derivatives
// of other members; tokenised equities are not crypto.
const STABLE = new Set([
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'XUSD', 'USD1',
  'EURI', 'RLUSD', 'USDE', 'USDS', 'EUR', 'GBP', 'TRY', 'BRL', 'ARS', 'JPY',
  'PAXG', 'XAUT', // metals
]);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;
const TOKENISED_EQUITY = /^[A-Z]{2,6}B$/; // Binance's xxxB stock tokens
const ASCII_ALNUM = /^[A-Z0-9]+$/;

async function fetchUniverse(): Promise<string[]> {
  const { data } = await axios.get<Array<{ symbol: string }>>(
    'https://api.binance.com/api/v3/exchangeInfo',
    { timeout: 30_000 },
  );
  const symbols = (data as unknown as { symbols: Array<{ symbol: string; status: string; quoteAsset: string; baseAsset: string }> }).symbols;
  const bases = symbols
    .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map((s) => s.baseAsset)
    .filter(
      (b) =>
        ASCII_ALNUM.test(b) &&
        !STABLE.has(b) &&
        !LEVERAGED.test(b) &&
        !TOKENISED_EQUITY.test(b),
    );
  return [...new Set(bases)].sort();
}

async function buildPanel(): Promise<Panel> {
  const fs = require('fs') as typeof import('fs');
  const cachePath = `${OUT_DIR}/panel_1d.json`;
  if (!REFRESH && fs.existsSync(cachePath)) {
    console.log(`reusing cached panel → ${cachePath} (--refresh to redownload)`);
    return finalisePanel(JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Panel);
  }

  const binance = new BinanceService(cache, new CacheTelemetryService());
  const universe = await fetchUniverse();
  console.log(`universe after mechanical filters: ${universe.length} USDT pairs`);
  console.log(`fetching ${BARS} daily bars each — this takes a few minutes...`);

  const data: Panel['data'] = {};
  const allDates = new Set<string>();
  let done = 0;
  let failed = 0;

  for (const coin of universe) {
    try {
      const candles = await binance.getCandlesPaged(coin, '1d', BARS);
      // Need at least enough history to form a signal and hold once.
      if (candles.length < FORMATION + SKIP + HOLD + 5) {
        failed++;
        continue;
      }
      const series: Record<string, { close: number; dv: number }> = {};
      for (const c of candles) {
        const d = c.time.toISOString().slice(0, 10);
        series[d] = { close: c.close, dv: c.close * c.volume };
        allDates.add(d);
      }
      data[coin] = series;
    } catch {
      failed++;
    }
    if (++done % 50 === 0) console.log(`  ${done}/${universe.length}`);
  }

  const panel: Panel = {
    coins: Object.keys(data).sort(),
    dates: [...allDates].sort(),
    data,
  };
  fs.writeFileSync(cachePath, JSON.stringify(panel));
  console.log(`raw panel: ${panel.coins.length} coins, ${panel.dates.length} raw dates (${failed} skipped)`);
  return finalisePanel(panel);
}

/** Trim the raw union of dates to a usable contiguous calendar. */
function finalisePanel(raw: Panel): Panel {
  const panel = trimToContiguous(raw, MIN_UNIVERSE);
  console.log(
    `panel: ${panel.coins.length} coins · ${panel.dates.length} contiguous days · ` +
      `${panel.dates[0]} → ${panel.dates[panel.dates.length - 1]} ` +
      `(trimmed from ${raw.dates.length} raw dates spanning ${raw.dates[0]} → ${raw.dates[raw.dates.length - 1]})`,
  );
  return panel;
}

/**
 * coin -> date -> { s: total funding that day, n: prints seen }.
 *
 * Both are needed: the SIGNAL ranks on the mean (s/n), while the CASHFLOW
 * a position actually pays or receives is the total (s). Storing only the
 * mean makes the cashflow unrecoverable, which is the bug that invalidated
 * the first funding run.
 */
type FundingMap = Record<string, Record<string, { s: number; n: number }>>;

async function buildFunding(panel: Panel): Promise<FundingMap> {
  const fs = require('fs') as typeof import('fs');
  const cachePath = `${OUT_DIR}/funding_1d.json`;
  if (!REFRESH && fs.existsSync(cachePath)) {
    console.log(`reusing cached funding → ${cachePath}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as FundingMap;
  }

  const binance = new BinanceService(cache, new CacheTelemetryService());
  const start = Date.parse(`${panel.dates[0]}T00:00:00Z`) - FUND_WINDOW * 86_400_000;
  const out: FundingMap = {};
  let done = 0;
  let noPerp = 0;

  console.log(`fetching funding history for ${panel.coins.length} coins...`);
  for (const coin of panel.coins) {
    try {
      const prints = await binance.getFundingRates(coin, start);
      if (prints.length === 0) { noPerp++; continue; }
      const sums: Record<string, { s: number; n: number }> = {};
      for (const p of prints) {
        const d = p.time.toISOString().slice(0, 10);
        (sums[d] ??= { s: 0, n: 0 }).s += p.rate;
        sums[d].n += 1;
      }
      out[coin] = sums;
    } catch {
      noPerp++;
    }
    if (++done % 50 === 0) console.log(`  ${done}/${panel.coins.length}`);
  }

  fs.writeFileSync(cachePath, JSON.stringify(out));
  console.log(
    `funding: ${Object.keys(out).length} coins with perp history ` +
      `(${noPerp} spot-only, excluded from the funding test)`,
  );
  return out;
}

/** Mean daily funding over the FUND_WINDOW days strictly before `di`. */
export function trailingFunding(
  fund: Record<string, { s: number; n: number }> | undefined,
  dates: string[],
  di: number,
): number | null {
  if (!fund) return null;
  const vals: number[] = [];
  for (let k = Math.max(0, di - FUND_WINDOW); k < di; k++) {
    const v = fund[dates[k]];
    if (v !== undefined && v.n > 0) vals.push(v.s / v.n);
  }
  if (vals.length < Math.ceil(FUND_WINDOW / 2)) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Total funding a position accrues from di to di+HOLD (longs pay if >0). */
export function holdFunding(
  fund: Record<string, { s: number; n: number }> | undefined,
  dates: string[],
  di: number,
  hold: number,
): number {
  if (!fund) return 0;
  let total = 0;
  for (let k = di; k < Math.min(di + hold, dates.length); k++) {
    const v = fund[dates[k]];
    if (v !== undefined) total += v.s;
  }
  return total;
}

// ── strategy ────────────────────────────────────────────────────────────

interface Eligible {
  coin: string;
  momentum: number; // formation return
  signal: number; // what we actually rank on; long the top, short the bottom
  dv: number; // trailing median dollar volume
}

/**
 * Coins tradeable at `di`, with their signal. Uses ONLY data strictly
 * before the decision date — closes up to di-SKIP, volume up to di-1.
 */
export function eligibleAt(panel: Panel, di: number, fund?: FundingMap): Eligible[] {
  const dates = panel.dates;
  const out: Eligible[] = [];
  const formEnd = di - SKIP; // last close used by the signal
  const formStart = formEnd - FORMATION;
  if (formStart < 0) return out;

  for (const coin of panel.coins) {
    const s = panel.data[coin];
    const a = s[dates[formStart]];
    const b = s[dates[formEnd]];
    const now = s[dates[di]];
    if (!a || !b || !now || a.close <= 0) continue;

    // Trailing liquidity, strictly before the decision date.
    const vols: number[] = [];
    for (let k = Math.max(0, di - LIQ_WINDOW); k < di; k++) {
      const v = s[dates[k]];
      if (v) vols.push(v.dv);
    }
    if (vols.length < LIQ_WINDOW / 2) continue;
    vols.sort((x, y) => x - y);

    const momentum = b.close / a.close - 1;
    let signal = momentum;
    if (SIGNAL === 'funding') {
      const f = trailingFunding(fund?.[coin], dates, di);
      if (f === null) continue; // no perp history: not tradeable in this test
      signal = -f; // contrarian: crowded longs (high funding) go to the SHORT leg
    }

    out.push({
      coin,
      momentum,
      signal,
      dv: vols[Math.floor(vols.length / 2)],
    });
  }

  // Point-in-time liquidity screen.
  out.sort((x, y) => y.dv - x.dv);
  return out.slice(0, MAX_UNIVERSE);
}

let staleExits = 0;

/**
 * Forward return of an equal-weight basket from di to di+HOLD.
 *
 * If a coin has no print on the exit date (halted or delisted mid-hold) we
 * use its last available close instead of dropping it. Dropping would
 * silently remove exactly the positions most likely to have collapsed,
 * which biases every basket upward — and hits the short leg hardest.
 */
function basketReturn(
  panel: Panel,
  coins: string[],
  di: number,
  fund?: FundingMap,
): number | null {
  const dates = panel.dates;
  const exit = di + HOLD;
  if (exit >= dates.length) return null;
  const rs: number[] = [];
  for (const c of coins) {
    const a = panel.data[c][dates[di]];
    if (!a || a.close <= 0) continue;
    let b = panel.data[c][dates[exit]];
    if (!b) {
      for (let k = exit - 1; k > di; k--) {
        const prev = panel.data[c][dates[k]];
        if (prev) { b = prev; staleExits++; break; }
      }
    }
    if (!b) continue;
    // Long-side return net of funding paid. The short leg is the negation
    // of this same quantity, so every arm stays correct downstream.
    rs.push(b.close / a.close - 1 - holdFunding(fund?.[c], dates, di, HOLD));
  }
  if (rs.length === 0) return null;
  return rs.reduce((x, y) => x + y, 0) / rs.length;
}

interface Period {
  date: string;
  ls: number | null; // long/short book, gross
  flip: number | null; // random-direction control, gross
  longOnly: number | null; // always-long control, gross
  // Cost is MEASURED from basket membership change, not assumed. Assuming
  // full turnover for the always-long control would overcharge it, and
  // that control is a bar the strategy has to clear — so the error would
  // flatter the strategy.
  lsCost: number;
  flipCost: number;
  longOnlyCost: number;
  legSize: number;
  universe: number;
}

/** Fraction of a basket's positions replaced since the previous period. */
export function turnover(prev: string[] | null, next: string[]): number {
  if (prev === null || prev.length === 0) return 1; // initial entry
  const before = new Set(prev);
  const kept = next.filter((c) => before.has(c)).length;
  return next.length === 0 ? 0 : (next.length - kept) / next.length;
}

export function runStrategy(panel: Panel, fund?: FundingMap): Period[] {
  const periods: Period[] = [];
  const RT = ROUND_TRIP_PCT / 100;
  let prevLong: string[] | null = null;
  let prevShort: string[] | null = null;
  let prevFlipL: string[] | null = null;
  let prevFlipS: string[] | null = null;
  let prevUni: string[] | null = null;

  for (let di = FORMATION + SKIP; di + HOLD < panel.dates.length; di += HOLD) {
    const elig = eligibleAt(panel, di, fund);
    if (elig.length < MIN_UNIVERSE) continue;

    const legSize = Math.max(MIN_LEG, Math.floor(elig.length * LEG_PCT));
    if (legSize * 2 > elig.length) continue;

    const ranked = [...elig].sort((a, b) => b.signal - a.signal);
    const longs = ranked.slice(0, legSize).map((e) => e.coin);
    const shorts = ranked.slice(-legSize).map((e) => e.coin);

    const rl = basketReturn(panel, longs, di, fund);
    const rs = basketReturn(panel, shorts, di, fund);

    // Control 1 — same number of positions, sides assigned at random from
    // the same eligible set. Isolates ranking skill from position count.
    const pool = [...elig];
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    const flipL = pool.slice(0, legSize).map((e) => e.coin);
    const flipS = pool.slice(legSize, legSize * 2).map((e) => e.coin);
    const rfl = basketReturn(panel, flipL, di, fund);
    const rfs = basketReturn(panel, flipS, di, fund);

    // Control 2 — always long the whole eligible universe.
    const uni = elig.map((e) => e.coin);
    const rlo = basketReturn(panel, uni, di, fund);

    // Each leg holds half the capital, so its turnover costs half as much.
    const lsCost = RT * (0.5 * turnover(prevLong, longs) + 0.5 * turnover(prevShort, shorts));
    const flipCost = RT * (0.5 * turnover(prevFlipL, flipL) + 0.5 * turnover(prevFlipS, flipS));
    const longOnlyCost = RT * turnover(prevUni, uni);
    prevLong = longs;
    prevShort = shorts;
    prevFlipL = flipL;
    prevFlipS = flipS;
    prevUni = uni;

    periods.push({
      date: panel.dates[di],
      // Equal capital per leg: half long, half short.
      ls: rl !== null && rs !== null ? 0.5 * rl - 0.5 * rs : null,
      flip: rfl !== null && rfs !== null ? 0.5 * rfl - 0.5 * rfs : null,
      longOnly: rlo,
      lsCost,
      flipCost,
      longOnlyCost,
      legSize,
      universe: elig.length,
    });
  }

  return periods;
}

const COST_KEY = {
  ls: 'lsCost',
  flip: 'flipCost',
  longOnly: 'longOnlyCost',
} as const;

function summarise(label: string, rets: number[], costs: number[]) {
  const net = rets.map((r, i) => r - costs[i]);
  const mean = net.reduce((a, b) => a + b, 0) / net.length;
  const sd = Math.sqrt(net.reduce((a, r) => a + (r - mean) ** 2, 0) / net.length);
  const pos = net.filter((r) => r > 0).length;
  return {
    book: label,
    periods: net.length,
    'mean/period': `${(mean * 100).toFixed(3)}%`,
    'positive %': `${((pos / net.length) * 100).toFixed(1)}%`,
    'sd/period': `${(sd * 100).toFixed(2)}%`,
    'sharpe(ann)': (sd === 0 ? 0 : (mean / sd) * Math.sqrt(365 / HOLD)).toFixed(2),
    'turnover cost': `${((costs.reduce((a, b) => a + b, 0) / costs.length) * 100).toFixed(3)}%`,
    'total': `${(net.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%`,
  };
}

// ── self-check ──────────────────────────────────────────────────────────
function selfCheck() {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`self-check FAILED: ${m}`);
  };

  // Synthetic panel: 30 coins, coin i compounds at a constant rate that
  // increases with i. Momentum must therefore long the high-i coins and
  // short the low-i ones, producing a positive long/short return.
  const nCoins = 30;
  const nDates = 200;
  const dates: string[] = [];
  for (let d = 0; d < nDates; d++) {
    dates.push(new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10));
  }
  const data: Panel['data'] = {};
  const coins: string[] = [];
  for (let i = 0; i < nCoins; i++) {
    const coin = `C${String(i).padStart(2, '0')}`;
    coins.push(coin);
    const rate = (i - nCoins / 2) * 0.002; // -3% .. +3% per day
    const s: Record<string, { close: number; dv: number }> = {};
    let px = 100;
    for (const d of dates) {
      px *= 1 + rate;
      s[d] = { close: px, dv: 1_000_000 };
    }
    data[coin] = s;
  }
  const panel: Panel = { coins, dates, data };

  // Contiguity trim: a leading stretch covered by too few coins, plus a
  // calendar hole, must both be discarded — this is the FTT bug.
  {
    const mkP = (ds: string[], per: Record<string, string[]>): Panel => ({
      coins: Object.keys(per),
      dates: ds,
      data: Object.fromEntries(
        Object.entries(per).map(([c, own]) => [
          c,
          Object.fromEntries(own.map((d) => [d, { close: 1, dv: 1 }])),
        ]),
      ),
    });
    // 3 days covered by 1 coin, a gap, then 4 consecutive days covered by 3.
    const ds = ['2022-01-01', '2022-01-02', '2022-01-03', '2022-06-01', '2022-06-02', '2022-06-03', '2022-06-04'];
    const lonely = ['2022-01-01', '2022-01-02', '2022-01-03'];
    const main = ['2022-06-01', '2022-06-02', '2022-06-03', '2022-06-04'];
    const trimmed = trimToContiguous(
      mkP(ds, { LONE: [...lonely, ...main], A: main, B: main }),
      3,
    );
    ok(trimmed.dates.length === 4, `expected 4 contiguous dates, got ${trimmed.dates.length}`);
    ok(trimmed.dates[0] === '2022-06-01', `expected start 2022-06-01, got ${trimmed.dates[0]}`);
  }

  // Turnover: full on first entry, zero when membership is unchanged.
  ok(turnover(null, ['a', 'b', 'c']) === 1, 'initial entry is full turnover');
  ok(turnover(['a', 'b', 'c'], ['a', 'b', 'c']) === 0, 'unchanged basket costs nothing');
  ok(
    Math.abs(turnover(['a', 'b', 'c'], ['a', 'b', 'd']) - 1 / 3) < 1e-9,
    'one of three replaced is 1/3 turnover',
  );

  // Funding: trailing mean over the window strictly before the decision date,
  // and the contrarian sign convention.
  {
    const ds: string[] = [];
    for (let k = 0; k < 9; k++) {
      ds.push(new Date(Date.UTC(2024, 0, 1 + k)).toISOString().slice(0, 10));
    }
    // 7 prints on days 0..6, values .001 .. .007, mean .004
    // 7 days of prints, daily MEAN .001 .. .007 (3 prints each), mean .004
    const f: Record<string, { s: number; n: number }> = {};
    for (let k = 0; k < 7; k++) f[ds[k]] = { s: ((k + 1) / 1000) * 3, n: 3 };
    const tf = trailingFunding(f, ds, 7);
    ok(tf !== null && Math.abs(tf - 0.004) < 1e-12, `trailing funding mean, got ${tf}`);
    // A print ON or AFTER the decision date must be ignored by the SIGNAL.
    const tf2 = trailingFunding(
      { ...f, [ds[7]]: { s: 99, n: 3 }, [ds[8]]: { s: 99, n: 3 } }, ds, 7);
    ok(tf2 !== null && Math.abs(tf2 - 0.004) < 1e-12, 'funding signal must exclude the decision date');
    ok(trailingFunding(undefined, ds, 7) === null, 'no perp history -> null');
    // Too few prints in the window must be rejected, not silently averaged.
    ok(trailingFunding({ [ds[0]]: { s: 0.003, n: 3 } }, ds, 7) === null, 'sparse funding -> null');

    // CASHFLOW is the opposite: it accrues FROM the entry date forward, and
    // sums totals rather than averaging them.
    const hf = holdFunding(f, ds, 0, 3);
    ok(Math.abs(hf - (0.001 + 0.002 + 0.003) * 3) < 1e-12, `hold funding total, got ${hf}`);
    ok(holdFunding(undefined, ds, 0, 3) === 0, 'no funding data -> zero cashflow');
    ok(holdFunding(f, ds, 0, 0) === 0, 'zero-length hold -> zero cashflow');
    // Contrarian: crowded longs (HIGH funding) must sort to the SHORT leg,
    // i.e. their signal must be the LOWEST. Signal = -funding.
    ok(-0.005 < -0.001, 'higher funding must produce a lower signal');
  }

  const elig = eligibleAt(panel, 60);
  ok(elig.length === nCoins, `all coins eligible, got ${elig.length}`);
  const best = [...elig].sort((a, b) => b.momentum - a.momentum)[0];
  ok(best.coin === `C${nCoins - 1}`, `strongest should be C29, got ${best.coin}`);

  const periods = runStrategy(panel);
  ok(periods.length > 5, `expected several periods, got ${periods.length}`);
  const ls = periods.map((p) => p.ls).filter((x): x is number => x !== null);
  const meanLs = ls.reduce((a, b) => a + b, 0) / ls.length;
  ok(meanLs > 0, `long/short must profit on a monotone trend panel, got ${meanLs}`);

  // No look-ahead: the signal at di must not change if every close AFTER
  // di is corrupted.
  const before = eligibleAt(panel, 60).map((e) => e.momentum.toFixed(8)).join(',');
  const corrupt: Panel = { coins, dates, data: JSON.parse(JSON.stringify(data)) };
  for (const c of coins) {
    for (let k = 60; k < nDates; k++) corrupt.data[c][dates[k]].close *= 7.3;
  }
  const after = eligibleAt(corrupt, 60).map((e) => e.momentum.toFixed(8)).join(',');
  ok(before === after, 'signal must not depend on data at or after the decision date');

  console.log(
    'self-check passed (contiguity trim, turnover, funding window + sign, ranking, long/short sign, no look-ahead)',
  );
}

async function main() {
  const fs = require('fs') as typeof import('fs');
  const panel = await buildPanel();
  const fund = await buildFunding(panel); // cashflow applies to BOTH hypotheses
  const periods = runStrategy(panel, fund);

  console.log(
    SIGNAL === 'funding'
      ? `\ncross-sectional FUNDING (contrarian on crowding) · trailing ${FUND_WINDOW}d mean funding · ` +
          `long lowest decile, short highest · hold ${HOLD}d · leg ${LEG_PCT * 100}% (min ${MIN_LEG}) · ` +
          `universe top ${MAX_UNIVERSE} by trailing ${LIQ_WINDOW}d dollar volume`
      : `\ncross-sectional MOMENTUM · formation ${FORMATION}d skip ${SKIP}d · ` +
          `hold ${HOLD}d · leg ${LEG_PCT * 100}% (min ${MIN_LEG}) · ` +
          `universe top ${MAX_UNIVERSE} by trailing ${LIQ_WINDOW}d dollar volume`,
  );
  console.log(
    `cost ${ROUND_TRIP_PCT}% round trip on turnover · funding cashflow INCLUDED ` +
      `(longs pay, shorts receive)`,
  );

  const pick = (k: 'ls' | 'flip' | 'longOnly') => {
    const rows = periods.filter((p) => p[k] !== null);
    return {
      rets: rows.map((p) => p[k] as number),
      costs: rows.map((p) => p[COST_KEY[k]]),
    };
  };

  const ls = pick('ls');
  const flip = pick('flip');
  const lo = pick('longOnly');
  if (ls.rets.length === 0) {
    console.log('\nNo periods produced. Nothing to measure.');
    return;
  }

  const medUniverse = [...periods.map((p) => p.universe)].sort((a, b) => a - b)[
    Math.floor(periods.length / 2)
  ];
  const medLeg = [...periods.map((p) => p.legSize)].sort((a, b) => a - b)[
    Math.floor(periods.length / 2)
  ];
  console.log(
    `\n${periods.length} rebalances · ${panel.dates[0]} → ${panel.dates[panel.dates.length - 1]} · ` +
      `median universe ${medUniverse} coins · median leg ${medLeg} coins/side`,
  );

  if (staleExits > 0) {
    console.log(
      `note: ${staleExits} position-exits had no print on the exit date and used ` +
        `the last available close (halted/delisted mid-hold)`,
    );
  }
  console.table([
    summarise('long/short (strategy)', ls.rets, ls.costs),
    summarise('random direction', flip.rets, flip.costs),
    summarise('always long', lo.rets, lo.costs),
  ]);

  // Breakeven cost: the round-trip % at which the strategy's mean hits 0.
  const grossMean = ls.rets.reduce((a, b) => a + b, 0) / ls.rets.length;
  const meanTurnover =
    ls.costs.reduce((a, b) => a + b, 0) / ls.costs.length / (ROUND_TRIP_PCT / 100);
  console.log(
    `\ngross mean/period ${(grossMean * 100).toFixed(3)}% · mean turnover ` +
      `${(meanTurnover * 100).toFixed(1)}% of notional` +
      `\nBREAKEVEN round-trip cost ${((grossMean / Math.max(meanTurnover, 1e-9)) * 100).toFixed(3)}% ` +
      `— the edge survives any venue cheaper than this (charged at ${ROUND_TRIP_PCT}%)`,
  );

  // One row per rebalance per arm, in the schema bootstrap.ts already
  // reads — so the clustered inference needs no new code.
  const write = (name: string, key: 'ls' | 'flip' | 'longOnly') => {
    const rows = periods
      .filter((p) => p[key] !== null)
      .map((p) =>
        [
          'BOOK', `${p.date}T00:00:00.000Z`, 0, 0, key.toUpperCase(), 0,
          'book', 0, 0, 0, 'PERIOD', p[key], HOLD, p[COST_KEY[key]],
        ].join(','),
      );
    const path = `${OUT_DIR}/${name}`;
    fs.writeFileSync(
      path,
      ['coin,time,index,exitIndex,tier,score,direction,entry,stop,target,outcome,r,barsHeld,costR', ...rows].join('\n'),
    );
    console.log(`wrote ${rows.length} periods → ${path}`);
  };
  const tag = SIGNAL === 'funding' ? 'fund' : 'panel';
  write(`${tag}_ls.csv`, 'ls');
  write(`${tag}_flip.csv`, 'flip');
  write(`${tag}_long.csv`, 'longOnly');
}

if (args.includes('--self-check')) {
  selfCheck();
} else {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
