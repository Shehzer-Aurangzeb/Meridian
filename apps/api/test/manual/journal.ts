/**
 * Trade journal — the only component that can answer whether this tool helps.
 *
 *   pnpm journal add ETH long --entry 1895.63 --stop 1870.78 --tp 1912.84
 *   pnpm journal add BTC short --entry 65036 --stop 65598 --tp 64605 --note "0.75 Fib"
 *   pnpm journal                                    # replay everything, report
 *
 * Records the plan YOU ACTUALLY TOOK — the fills you got, not the prices the
 * analyst printed. Those differ, and the difference is exactly what a journal
 * is for. Then it replays real candles against each entry and reports what
 * happened.
 *
 * This measures the USER's decisions over months, not the tool's predictions.
 * It is the honest version of the question the backtests could not answer.
 */
import * as dotenv from 'dotenv';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { Candle } from '../../src/common/types/candle.types';
import { findFirstFill, findFirstOutcome } from '../../src/performance/replay';
import { logRun, readRuns } from '../../src/common/run-log';

const JOURNAL = process.env.MERIDIAN_JOURNAL ?? 'logs/journal.jsonl';

// Outcomes are detected on 1h wicks: the finest series we page cheaply, so a
// stop or target touched intraday is not missed by a coarser candle.
// ponytail: 4000 x 1h ~= 166 days of history. Widen if you hold longer.
const REPLAY_TIMEFRAME = '1h' as const;
const REPLAY_CANDLES = 4000;

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

interface Entry {
  ts: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  tp1: number;
  size?: number;
  note?: string;
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (name: string): number => {
  const raw = flag(name);
  const n = Number(raw);
  if (raw === undefined || !Number.isFinite(n)) {
    throw new Error(`--${name} is required and must be a number`);
  }
  return n;
};

function add(): void {
  const [, symbolArg, directionArg] = argv;
  const symbol = (symbolArg ?? '').toUpperCase();
  const direction = (directionArg ?? '').toLowerCase();

  if (!symbol || (direction !== 'long' && direction !== 'short')) {
    throw new Error('usage: journal add <SYMBOL> <long|short> --entry N --stop N --tp N');
  }

  const entry: Omit<Entry, 'ts'> = {
    symbol,
    direction,
    entry: num('entry'),
    stop: num('stop'),
    tp1: num('tp'),
    ...(flag('size') ? { size: Number(flag('size')) } : {}),
    ...(flag('note') ? { note: flag('note') } : {}),
  };

  // A stop on the wrong side of entry makes every R meaningless, so refuse it
  // here rather than reporting nonsense for months.
  const stopBelow = entry.stop < entry.entry;
  if (direction === 'long' ? !stopBelow : stopBelow) {
    throw new Error(
      `stop ${entry.stop} is on the wrong side of entry ${entry.entry} for a ${direction}`,
    );
  }
  const tpBeyond = direction === 'long' ? entry.tp1 > entry.entry : entry.tp1 < entry.entry;
  if (!tpBeyond) {
    throw new Error(
      `target ${entry.tp1} is not beyond entry ${entry.entry} for a ${direction}`,
    );
  }

  logRun(entry, JOURNAL);
  const risk = Math.abs(entry.entry - entry.stop);
  console.log(
    `logged ${symbol} ${direction} @ ${entry.entry} · stop ${entry.stop} · ` +
      `tp ${entry.tp1} · 1R = ${risk.toFixed(4)} · ` +
      `${(Math.abs(entry.tp1 - entry.entry) / risk).toFixed(2)}R to target`,
  );
}

async function report(): Promise<void> {
  const entries = readRuns(JOURNAL) as unknown as Entry[];
  if (entries.length === 0) {
    console.log(`No entries in ${JOURNAL}. Add one:`);
    console.log('  pnpm journal add ETH long --entry 1895.63 --stop 1870.78 --tp 1912.84');
    return;
  }

  const binance = new BinanceService(cache, new CacheTelemetryService());
  const candlesFor = new Map<string, Candle[]>();

  const rows: Array<Record<string, string | number>> = [];
  const closed: number[] = [];

  for (const e of entries) {
    if (!candlesFor.has(e.symbol)) {
      candlesFor.set(
        e.symbol,
        await binance.getCandlesPaged(e.symbol, REPLAY_TIMEFRAME, REPLAY_CANDLES),
      );
    }
    const all = candlesFor.get(e.symbol) ?? [];
    const since = new Date(e.ts).getTime();
    const after = all.filter((c) => c.time.getTime() >= since);

    const action = e.direction === 'long' ? 'LONG' : 'SHORT';
    const risk = Math.abs(e.entry - e.stop);
    const fill = findFirstFill(after, action, e.entry);

    let status: string;
    let r: number | null = null;

    if (after.length === 0) {
      status = 'NO DATA';
    } else if (!fill) {
      status = 'UNFILLED';
    } else {
      const post = after.filter((c) => c.time.getTime() > fill.time.getTime());
      const outcome = findFirstOutcome(post, action, e.stop, e.tp1);

      if (outcome === 'STOPPED_OUT') {
        status = 'STOPPED';
        r = -1;
      } else if (outcome === 'TARGET_HIT') {
        status = 'TARGET';
        r = Math.abs(e.tp1 - e.entry) / risk;
      } else {
        status = 'OPEN';
        // Mark to market so an open position is visible without being counted.
        const last = post.length > 0 ? post[post.length - 1].close : e.entry;
        const move = e.direction === 'long' ? last - e.entry : e.entry - last;
        r = risk === 0 ? 0 : move / risk;
      }
      if (status !== 'OPEN' && r !== null) closed.push(r);
    }

    rows.push({
      date: e.ts.slice(0, 10),
      symbol: e.symbol,
      dir: e.direction,
      entry: e.entry,
      status,
      R: r === null ? '—' : r.toFixed(2),
      note: e.note ?? '',
    });
  }

  console.log(`\n${entries.length} journalled trade(s) · replayed on ${REPLAY_TIMEFRAME} wicks\n`);
  console.table(rows);

  if (closed.length === 0) {
    console.log('No closed trades yet — nothing to score.');
    return;
  }

  const total = closed.reduce((a, b) => a + b, 0);
  const wins = closed.filter((r) => r > 0).length;
  console.log(
    `closed ${closed.length} · won ${wins} (${((wins / closed.length) * 100).toFixed(0)}%) · ` +
      `total ${total.toFixed(2)}R · expectancy ${(total / closed.length).toFixed(3)}R/trade`,
  );
  // Deliberately no verdict. n is small for months; the number is the record,
  // not a conclusion — the same mistake the 493-trade backtest made.
  console.log(
    closed.length < 30
      ? `\n${closed.length} closed trades is too few to conclude anything. Keep logging.`
      : '\nEnough trades to start reading the expectancy — still check it per month.',
  );
}

async function main(): Promise<void> {
  if (argv[0] === 'add') {
    add();
    return;
  }
  await report();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
