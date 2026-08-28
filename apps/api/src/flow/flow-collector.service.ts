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
   * Page through one endpoint back to `from`.
   *
   * Walks BACKWARDS, moving `endTime` older each request, because the
   * `/futures/data/` endpoints IGNORE `startTime` — given a limit they return
   * the newest rows and nothing else. Paging forward therefore reads one page
   * and stops, which silently captured 20 days of a 30-day window and lost the
   * rest for good. Walking back from the newest row reaches all of it.
   *
   * Klines honour both bounds, so the same walk works for them too and there
   * is one code path instead of two.
   *
   * Stops when a page is empty, when the window is covered, or when a page
   * fails to move older — that last one is what prevents an endpoint that
   * clamps `endTime` from looping for ever.
   */
  private async fetchWindow(
    symbol: string,
    spec: MetricSpec,
    from: number,
    to: number,
  ): Promise<Row[]> {
    const out = new Map<number, number>();
    let cursor = to;

    for (;;) {
      const res = await axios.get(`${BASE}${spec.path}`, {
        params: {
          symbol,
          [spec.intervalParam]: '1h',
          limit: spec.maxRows,
          endTime: cursor,
        },
        timeout: 15_000,
      });

      const raw = res.data as unknown[];
      if (!Array.isArray(raw) || raw.length === 0) break;

      let oldest = cursor;
      let malformed = 0;
      for (const item of raw) {
        const row = spec.parse(item);
        // A row that will not parse is NOT a row outside the window. Lumping
        // the two together means a changed response shape reads as "the API
        // returned nothing for this window", which is the exact failure this
        // codebase has hit four times.
        if (!row) {
          malformed += 1;
          continue;
        }
        if (row.ts < from) continue;
        out.set(row.ts, row.value);
        if (row.ts < oldest) oldest = row.ts;
      }
      if (malformed === raw.length) {
        throw new Error(
          `${spec.metric} ${symbol}: all ${raw.length} rows from ${spec.path} failed to ` +
            'parse. The response shape changed — this is not an empty window.',
        );
      }

      if (oldest >= cursor) break;
      if (oldest <= from) break;
      cursor = oldest - 1;
      if (raw.length < spec.maxRows) break;
      await this.sleep(120);
    }

    return [...out.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, value]) => ({ ts, value }));
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
