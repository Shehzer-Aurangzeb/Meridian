import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Saves Binance's futures-flow numbers before they expire.
 *
 * Three of the four sources below only keep about 30 days of history. Once a
 * day falls off the end it is gone for good — there is no archive to buy and
 * no way to reconstruct it. So this runs daily and stores what it finds.
 *
 * It produces no signal today. The point is that in a year there is a year of
 * data to study, instead of the same 30 days there would be if we started then.
 */

const BASE = 'https://fapi.binance.com';
const DAY_MS = 86_400_000;

/** How much history to ask for. More than a day, so a missed run self-heals. */
export const DEFAULT_BACKFILL_DAYS = 30;

interface Row {
  ts: number;
  value: number;
}

interface MetricSpec {
  metric: string;
  path: string;
  /** These endpoints spell the same idea two different ways. */
  intervalParam: 'period' | 'interval';
  /** Most rows an endpoint will return at once, measured by flow-probe.ts. */
  maxRows: number;
  /** Binance keeps this one for years, so a missed day is not a lost day. */
  longHistory?: boolean;
  parse: (raw: unknown) => Row | null;
}

const num = (x: unknown): number => Number(x);

/**
 * Binance wants the full pair; the rest of the project says just the coin.
 * Accepts either, so a caller that already has the pair is not punished.
 */
export const toPair = (symbol: string): string => {
  const s = symbol.toUpperCase();
  return s.endsWith('USDT') ? s : `${s}USDT`;
};

/** The `/futures/data/` family: objects with a `timestamp` and named fields. */
const fromField =
  (field: string) =>
  (raw: unknown): Row | null => {
    const r = raw as Record<string, unknown>;
    const ts = num(r.timestamp);
    const value = num(r[field]);
    return Number.isFinite(ts) && Number.isFinite(value) ? { ts, value } : null;
  };

export const METRICS: MetricSpec[] = [
  {
    metric: 'openInterest',
    path: '/futures/data/openInterestHist',
    intervalParam: 'period',
    maxRows: 500,
    parse: fromField('sumOpenInterest'),
  },
  {
    metric: 'longShortRatio',
    path: '/futures/data/globalLongShortAccountRatio',
    intervalParam: 'period',
    maxRows: 500,
    parse: fromField('longShortRatio'),
  },
  {
    metric: 'takerBuySellRatio',
    path: '/futures/data/takerlongshortRatio',
    intervalParam: 'period',
    maxRows: 500,
    parse: fromField('buySellRatio'),
  },
  {
    // A kline, so it arrives as an array: [openTime, open, high, low, close, …].
    // Binance keeps these back to at least 2023, so this one is insurance
    // rather than a race — it can be backfilled to any depth later.
    metric: 'premium',
    path: '/fapi/v1/premiumIndexKlines',
    intervalParam: 'interval',
    maxRows: 1500,
    longHistory: true,
    parse: (raw: unknown): Row | null => {
      const k = raw as unknown[];
      if (!Array.isArray(k) || k.length < 5) return null;
      const ts = num(k[0]);
      const value = num(k[4]); // close
      return Number.isFinite(ts) && Number.isFinite(value) ? { ts, value } : null;
    },
  },
];

export interface CollectResult {
  saved: number;
  /** Rows fetched that were already stored. Expected, and worth seeing. */
  duplicates: number;
  failed: Record<string, string>;
}

@Injectable()
export class FlowCollectorService {
  private readonly logger = new Logger(FlowCollectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch every metric for every symbol over the last `days`, and store what
   * is new.
   *
   * One symbol or one endpoint failing must not stop the rest: a thrown error
   * makes AWS retry the whole batch, re-fetching everything that worked.
   */
  async collect(
    symbols: string[],
    days: number = DEFAULT_BACKFILL_DAYS,
    now: number = Date.now(),
  ): Promise<CollectResult> {
    const failed: Record<string, string> = {};
    let saved = 0;
    let fetched = 0;

    for (const symbol of symbols) {
      for (const spec of METRICS) {
        const key = `${symbol}:${spec.metric}`;
        try {
          const rows = await this.fetchWindow(toPair(symbol), spec, now - days * DAY_MS, now);
          fetched += rows.length;
          saved += await this.store(symbol.toUpperCase().replace(/USDT$/, ''), spec.metric, rows);
        } catch (err) {
          failed[key] = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const result = { saved, duplicates: fetched - saved, failed };
    this.logger.log(JSON.stringify(result));
    return result;
  }

  /**
   * Page through one endpoint from `from` to `to`.
   *
   * Each request starts where the last one ended. The loop stops when a page
   * comes back empty, short, or without moving forward — that last check is
   * what stops an endpoint that ignores `startTime` from looping for ever.
   */
  private async fetchWindow(
    symbol: string,
    spec: MetricSpec,
    from: number,
    to: number,
  ): Promise<Row[]> {
    const out = new Map<number, number>();
    let cursor = from;

    for (;;) {
      const res = await axios.get(`${BASE}${spec.path}`, {
        params: {
          symbol,
          [spec.intervalParam]: '1h',
          limit: spec.maxRows,
          startTime: cursor,
          endTime: to,
        },
        timeout: 15_000,
      });

      const raw = res.data as unknown[];
      if (!Array.isArray(raw) || raw.length === 0) break;

      let newest = cursor;
      for (const item of raw) {
        const row = spec.parse(item);
        if (!row) continue;
        out.set(row.ts, row.value);
        if (row.ts > newest) newest = row.ts;
      }

      if (newest <= cursor) break;
      cursor = newest + 1;
      if (raw.length < spec.maxRows) break;
      await this.sleep(120);
    }

    return [...out.entries()].map(([ts, value]) => ({ ts, value }));
  }

  /**
   * Insert whatever is not already there.
   *
   * `skipDuplicates` against the (symbol, metric, ts) key does the whole job:
   * a value never changes once Binance has published it, so a row we already
   * hold needs no update. That is what makes overlapping windows free.
   */
  private async store(symbol: string, metric: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.flowSample.createMany({
      data: rows.map((r) => ({ symbol, metric, ts: new Date(r.ts), value: r.value })),
      skipDuplicates: true,
    });
    return count;
  }

  // ponytail: fixed politeness delay. Swap for the response's rate-limit
  // headers if a bigger coin list ever starts getting throttled.
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
