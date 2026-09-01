/**
 * Stage 0 — would a resting limit order actually have filled?
 *
 *   pnpm --filter api maker-fill --fetch --dir ~/meridian-archive/klines1m
 *
 * ─── Why ─────────────────────────────────────────────────────────────────
 * Every phase so far charged a 14 bp round trip, which is TAKER on both sides.
 * Posting a limit order and waiting costs roughly 3.6 bp instead, and Phase D's
 * best holdout row earns 5.82 bp — so the whole question of whether any of this
 * is tradeable turns on whether those limit orders fill.
 *
 * They are not free. Two things make a resting order worse than it looks, and
 * this file measures the first and reports evidence of the second:
 *
 *   1. It may never fill. Price walks away and you hold nothing.
 *   2. When it does fill, it fills BECAUSE someone came and hit it, which is
 *      disproportionately when the market is moving against you. Fills are
 *      adversely selected.
 *
 * ─── What this can and cannot tell you ───────────────────────────────────
 * A 1-minute bar says price traded between its low and high. It does not say
 * where you were in the queue, or whether the touch was one print of three
 * contracts. So every fill rate here is an UPPER BOUND: real filling is worse.
 *
 * That asymmetry is the point. If the number is bad at 1-minute resolution the
 * idea is dead and it cost half a day. If it is good, all that has been
 * established is "not yet ruled out", and the next stage is a live recorder.
 *
 * The 1-hour version of this test would be far more generous still — "price
 * came back within the hour" is nearly always true — which is why this reads
 * the 1-minute archive instead.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fetchAll } from './book-depth-import';
import { unzipSingle } from './flow-import';

const BASE = 'https://data.binance.vision/data/futures/um/monthly/klines';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const DIR = str('dir', '');
const FETCH = args.includes('--fetch');
const CONCURRENCY = num('concurrency', 8);
const COINS = str('coins', 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,LINK,DOT,LTC').split(',');
const FROM = str('from', '2023-01');
const TO = str('to', '2026-08');
const SIGNALS = str('signals', 'test/manual/results/phase-d-book.csv');
/** How long the order rests before it is given up on, in minutes. */
const PATIENCE = num('patience', 15);
/**
 * How far inside the touch to post, in basis points. Zero posts at the decision
 * bar's close, which is a traded price and therefore roughly at the touch. A
 * positive value posts further away: strictly passive, strictly harder to fill.
 */
const IMPROVE_BP = num('improve-bp', 0);

export interface Minute {
  ts: number;
  high: number;
  low: number;
  close: number;
}

/** `YYYY-MM` for every month from `from` to `to` inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function parseKlines(csv: string): Minute[] {
  const lines = csv.trim().split('\n');
  // The archive gained a header row partway through its history. Detecting it
  // by content rather than assuming either way: a silently skipped first data
  // row is a hole, and a parsed header row is a NaN bar.
  const start = /^\d/.test(lines[0]) ? 0 : 1;
  const out: Minute[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    const ts = Number(c[0]);
    const high = Number(c[2]);
    const low = Number(c[3]);
    const close = Number(c[4]);
    if (!Number.isFinite(ts) || !Number.isFinite(high) || !Number.isFinite(low)) continue;
    out.push({ ts, high, low, close });
  }
  return out;
}

/**
 * Would a resting order at `price` have been touched within `patience` minutes?
 *
 * Returns the index of the minute that filled it, or -1. A buy fills when some
 * minute trades down to the price; a sell when some minute trades up to it.
 */
export function fillIndex(
  minutes: Minute[],
  from: number,
  price: number,
  side: 'buy' | 'sell',
  patience: number,
): number {
  const end = Math.min(minutes.length, from + patience);
  for (let i = from; i < end; i += 1) {
    if (side === 'buy' ? minutes[i].low <= price : minutes[i].high >= price) return i;
  }
  return -1;
}

/** First minute at or after `ts`, by binary search. */
export function indexAt(minutes: Minute[], ts: number): number {
  let lo = 0;
  let hi = minutes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (minutes[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Signal {
  ts: number;
  coin: string;
  side: 'buy' | 'sell';
  horizon: number;
}

function loadSignals(file: string): Signal[] {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  const iTs = head.indexOf('ts');
  const iCoin = head.indexOf('coin');
  const iSide = head.indexOf('side');
  const iH = head.indexOf('horizon');
  if (iTs < 0 || iCoin < 0 || iSide < 0 || iH < 0) {
    throw new Error(`${file}: need columns ts,coin,side,horizon — got "${lines[0]}"`);
  }
  return lines.slice(1).filter(Boolean).map((l) => {
    const c = l.split(',');
    return {
      ts: Date.parse(c[iTs]),
      coin: c[iCoin],
      side: c[iSide] === 'buy' ? 'buy' : 'sell',
      horizon: Number(c[iH]),
    };
  });
}

function loadMinutes(dir: string, coin: string, months: string[]): Minute[] {
  const out: Minute[] = [];
  for (const month of months) {
    const f = path.join(dir, `${coin.toUpperCase()}USDT-1m-${month}.zip`);
    if (!fs.existsSync(f)) continue;
    out.push(...parseKlines(unzipSingle(f)));
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

interface Outcome {
  coin: string;
  ts: number;
  side: 'buy' | 'sell';
  entryFilled: boolean;
  entryWaitMin: number;
  exitFilled: boolean;
  /** Return in basis points, signed for the side, before any fee. */
  grossBp: number;
}

export function simulate(minutes: Minute[], sig: Signal, patience: number, improveBp: number): Outcome | null {
  const i0 = indexAt(minutes, sig.ts);
  if (i0 >= minutes.length) return null;
  const ref = minutes[i0 === 0 ? 0 : i0 - 1].close;
  if (!Number.isFinite(ref) || ref <= 0) return null;

  const edge = improveBp / 1e4;
  const entryPrice = sig.side === 'buy' ? ref * (1 - edge) : ref * (1 + edge);
  const fi = fillIndex(minutes, i0, entryPrice, sig.side, patience);
  if (fi < 0) {
    return { coin: sig.coin, ts: sig.ts, side: sig.side, entryFilled: false, entryWaitMin: NaN, exitFilled: false, grossBp: NaN };
  }

  // Exit at the horizon, also as a resting order. If it does not fill inside
  // the same patience window we cross the spread and take the last price --
  // which is what a real book does rather than holding forever.
  const xi = indexAt(minutes, sig.ts + sig.horizon * 3_600_000);
  if (xi >= minutes.length) return null;
  const exitRef = minutes[xi === 0 ? 0 : xi - 1].close;
  const exitSide = sig.side === 'buy' ? 'sell' : 'buy';
  const exitPrice = exitSide === 'buy' ? exitRef * (1 - edge) : exitRef * (1 + edge);
  const xf = fillIndex(minutes, xi, exitPrice, exitSide, patience);
  const exitFilled = xf >= 0;
  const got = exitFilled ? exitPrice : minutes[Math.min(minutes.length - 1, xi + patience)].close;

  const raw = (got - entryPrice) / entryPrice;
  return {
    coin: sig.coin,
    ts: sig.ts,
    side: sig.side,
    entryFilled: true,
    entryWaitMin: fi - i0,
    exitFilled,
    grossBp: (sig.side === 'buy' ? raw : -raw) * 1e4,
  };
}

async function main(): Promise<void> {
  if (!DIR) throw new Error('--dir <dir> is required');
  fs.mkdirSync(DIR, { recursive: true });
  const months = monthsBetween(FROM, TO);

  if (FETCH) {
    const jobs = COINS.flatMap((c) =>
      months.map((m) => {
        const pair = `${c.toUpperCase()}USDT`;
        const name = `${pair}-1m-${m}.zip`;
        return { url: `${BASE}/${pair}/1m/${name}`, dest: path.join(DIR, name) };
      }),
    ).filter((j) => !fs.existsSync(j.dest));
    console.log(`\nMAKER FILL — fetching ${jobs.length} monthly files with ${CONCURRENCY} workers\n`);
    await fetchAll(jobs, CONCURRENCY);
  }

  const signals = loadSignals(SIGNALS);
  console.log(`\nMAKER FILL — ${signals.length.toLocaleString()} signals`);
  console.log(`patience   ${PATIENCE} minutes`);
  console.log(`posting    ${IMPROVE_BP} bp inside the reference price\n`);

  const byCoin = new Map<string, Signal[]>();
  for (const s of signals) {
    const cell = byCoin.get(s.coin);
    if (cell) cell.push(s);
    else byCoin.set(s.coin, [s]);
  }

  const all: Outcome[] = [];
  for (const [coin, sigs] of byCoin) {
    const minutes = loadMinutes(DIR, coin, months);
    if (minutes.length === 0) throw new Error(`${coin}: no 1m data in ${DIR} — run with --fetch`);
    for (const s of sigs) {
      const o = simulate(minutes, s, PATIENCE, IMPROVE_BP);
      if (o) all.push(o);
    }
    const filled = all.filter((o) => o.coin === coin && o.entryFilled).length;
    const n = all.filter((o) => o.coin === coin).length;
    console.log(`  ${coin.padEnd(5)} ${minutes.length.toLocaleString().padStart(9)} minutes  ${n} signals  ${((filled / n) * 100).toFixed(1)}% filled`);
  }

  const filled = all.filter((o) => o.entryFilled);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\nentry fill rate   ${((filled.length / all.length) * 100).toFixed(1)}%  (${filled.length.toLocaleString()} of ${all.length.toLocaleString()})`);
  console.log(`exit fill rate    ${((filled.filter((o) => o.exitFilled).length / filled.length) * 100).toFixed(1)}%`);
  console.log(`median wait       ${filled.map((o) => o.entryWaitMin).sort((a, b) => a - b)[Math.floor(filled.length / 2)]} min`);
  console.log(`\ngross on FILLED   ${mean(filled.map((o) => o.grossBp)).toFixed(2)} bp`);
  for (const fee of [3.6, 8.1, 14]) {
    console.log(`  net at ${String(fee).padStart(4)} bp  ${(mean(filled.map((o) => o.grossBp)) - fee).toFixed(2)} bp`);
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
