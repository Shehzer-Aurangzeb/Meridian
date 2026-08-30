import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Saves Binance's futures-flow numbers before they expire.
 *
 * The live endpoints keep about 30 days. This runs daily and stores what it
 * finds, so the series continues forward from where the bulk archive ends.
 *
 * It produces no signal today. The point is that in a year there is a year of
 * data to study, instead of the same 30 days there would be if we started then.
 */

const BASE = 'https://fapi.binance.com';
const DAY_MS = 86_400_000;

/**
 * How much history to ask for. Overlap so a missed run self-heals.
 *
 * Was 30. That was set when every metric came at 1h and a run cost ~80 page
 * requests. Three metrics now come at 5m, which put the same 30 days at ~570
 * requests plus a 120 ms sleep between each — past the Lambda's 120 s timeout,
 * measured in production: the run died at the fifth of ten coins, and the last
 * five got nothing at 5m at all.
 *
 * Three days is ~80 requests again, and still heals two consecutive misses.
 *
 * A longer outage than that is no longer unrecoverable, which is what makes
 * this trade safe: `data.binance.vision` republishes five of these six columns
 * as daily files, so a hole is refilled by re-running `scripts/flow-import.ts`.
 * `premium` is the exception and Binance keeps it for years.
 *
 * Do NOT raise this to buy storage headroom — a wider window re-fetches rows
 * we already hold and stores exactly the same ones. See ROADMAP §8.
 */
export const DEFAULT_BACKFILL_DAYS = 3;

interface Row {
  ts: number;
  value: number;
}

interface MetricSpec {
  metric: string;
  path: string;
  /**
   * These endpoints spell the same idea two different ways, and `fundingRate`
   * has no bucket at all — it publishes on its own 8-hour settlement clock.
   * Undefined means "send no interval parameter".
   */
  intervalParam?: 'period' | 'interval';
  /**
   * The bucket width to ask for. Was hard-coded to 1h for every metric.
   *
   * It has to be per-metric because the endpoints are not all the same KIND of
   * number. Open interest and the long/short ratios are SNAPSHOTS: measured
   * 27 Aug against the live API, `1h[T]` equals `5m[T]` to the bit, so the
   * width only changes how often you sample. `takerlongshortRatio` is a FLOW
   * AGGREGATE over the bucket, and the two widths disagree by up to 37%.
   */
  period?: '1h' | '5m';
  /** Most rows an endpoint will return at once, measured by flow-probe.ts. */
  maxRows: number;
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

// `openInterestValue` is in the archive and is deliberately NOT collected. It is
// open interest times price, and the price is already in the candles every
// consumer holds. Fetching it would double the openInterestHist page count to
// re-derive a product.
export const METRICS: MetricSpec[] = [
  // ── the two snapshots, at 5m ────────────────────────────────────────────
  //
  // 5m, not 1h, so these continue the archive at ITS density. The archive ends
  // 2026-08-28; collecting hourly from there would drop both series to a
  // twelfth of their resolution exactly at the join, which is a seam in the
  // sampling rate sitting where a seam is least welcome.
  //
  // There is no convention risk in the change and no second series to keep:
  // these are SNAPSHOTS, and `1h[T]` is bit-identical to `5m[T]` (verified
  // against the live API, 27 Aug). The hourly series is therefore a strict
  // subset of the 5-minute one — every hourly row is the 5m row on the hour —
  // so fetching 1h as well would cost a second call chain per symbol to
  // re-collect rows we already have. Dropped. Contrast the taker pair below,
  // which are two genuinely different numbers and are both kept.
  {
    metric: 'openInterest',
    path: '/futures/data/openInterestHist',
    intervalParam: 'period',
    period: '5m',
    maxRows: 500,
    parse: fromField('sumOpenInterest'),
  },
  {
    metric: 'longShortRatio',
    path: '/futures/data/globalLongShortAccountRatio',
    intervalParam: 'period',
    period: '5m',
    maxRows: 500,
    parse: fromField('longShortRatio'),
  },
  // ── the two top-trader ratios ───────────────────────────────────────────
  //
  // In the archive since 2021-12-01 and NOT collected until now, so both series
  // stopped dead at the archive's end (2026-08-28). A feature built on either
  // could be measured on history and then never run live, which is the one
  // failure a research dataset must not have.
  //
  // They are the most interesting inputs in the archive: what accounts with the
  // largest positions are actually doing, rather than what price did. `Account`
  // counts traders, `Position` weights by size — a small number of large
  // accounts moves the second and not the first, which is why both are kept.
  {
    metric: 'topTraderAccountRatio',
    path: '/futures/data/topLongShortAccountRatio',
    intervalParam: 'period',
    period: '5m',
    maxRows: 500,
    parse: fromField('longShortRatio'),
  },
  {
    metric: 'topTraderPositionRatio',
    path: '/futures/data/topLongShortPositionRatio',
    intervalParam: 'period',
    period: '5m',
    maxRows: 500,
    parse: fromField('longShortRatio'),
  },
  // ── the taker ratio, twice, because it is TWO DIFFERENT NUMBERS ─────────
  //
  // Binance's 1h taker ratio is not the average of its twelve 5m ratios.
  // Measured 27 Aug over 41 hours of BTCUSDT: mean-of-ratios is 13.9% off at
  // the median and 67.3% at worst. Only sum(buyVol)/sum(sellVol) reconstructs
  // it (0.059% median) and the bulk archive does not publish the volumes.
  //
  // So neither series can be derived from the other and merging them under one
  // name would put a silent discontinuity at the archive/collector boundary —
  // a seam that manufactures a signal. Both are collected, both are named for
  // the window they aggregate over, and nothing downstream has to infer which.
  {
    // The one the archive gives us back to 2021-12-01. Continues unbroken from
    // where the archive ends, which is why the collector now asks for it.
    metric: 'takerBuySellRatio5m',
    path: '/futures/data/takerlongshortRatio',
    intervalParam: 'period',
    period: '5m',
    maxRows: 500,
    parse: fromField('buySellRatio'),
  },
  {
    // Binance's own hourly statistic. Not reconstructable from the 5m rows, so
    // it is kept rather than dropped — the two weeks already collected under
    // the old name `takerBuySellRatio` are these.
    metric: 'takerBuySellRatio1h',
    path: '/futures/data/takerlongshortRatio',
    intervalParam: 'period',
    period: '1h',
    maxRows: 500,
    parse: fromField('buySellRatio'),
  },
  {
    // The funding rate itself, which is not the premium index. Premium is the
    // continuous mark-vs-index gap; funding is the settled cashflow every 8
    // hours, and it is what `FUNDING_AB.md` tested by fetching live and storing
    // nothing. A panel needs it as a column, not as an API call.
    //
    // No `period` — it publishes on its own settlement clock, so `intervalParam`
    // is omitted and the walk pages on `endTime` alone. `fundingTime`, not
    // `timestamp`, hence its own parse.
    metric: 'fundingRate',
    path: '/fapi/v1/fundingRate',
    maxRows: 1000,
    parse: (raw: unknown): Row | null => {
      const r = raw as Record<string, unknown>;
      const ts = num(r.fundingTime);
      const value = num(r.fundingRate);
      return Number.isFinite(ts) && Number.isFinite(value) ? { ts, value } : null;
    },
  },
  {
    // A kline, so it arrives as an array: [openTime, open, high, low, close, …].
    // Binance keeps these back to at least 2023, so this one is insurance
    // rather than a race — it can be backfilled to any depth later.
    metric: 'premium',
    path: '/fapi/v1/premiumIndexKlines',
    intervalParam: 'interval',
    period: '1h',
    maxRows: 1500,
    parse: (raw: unknown): Row | null => {
      const k = raw as unknown[];
      if (!Array.isArray(k) || k.length < 5) return null;
      const ts = num(k[0]);
      const value = num(k[4]); // close
      return Number.isFinite(ts) && Number.isFinite(value) ? { ts, value } : null;
    },
  },
];

/**
 * How a row in Binance's bulk archive maps onto a `FlowSample` row.
 *
 * `https://data.binance.vision/data/futures/um/daily/metrics/<PAIR>/` publishes
 * these six columns at 5-minute resolution from 2021-12-01 (BTC 2020-09-01).
 * This table is the ONLY place the archive-to-live convention is written down.
 * The importer reads it; nothing downstream needs to know the archive exists.
 *
 * ─── shiftBars, and why it is not zero ──────────────────────────────────
 * The archive stamps a SNAPSHOT with the START of the window it opens. The
 * live API stamps the same value with the moment it PUBLISHES it, one bar
 * later. So `archive[T] === live[T + 5min]` for the five snapshot columns, and
 * reading an archive row as known-at-its-own-timestamp is a five-minute
 * LOOK-AHEAD that throws nothing and shows up as a signal.
 *
 * `sum_taker_long_short_vol_ratio` is a flow measured OVER the window and is
 * already stamped at the end in both, so it alone shifts by zero.
 *
 * Measured 28 Aug 2026 over the whole ~29-day live retention overlap: ten
 * coins, 8,285 rows each, 82,850 comparisons PER COLUMN, every shift of -1/0/+1
 * scored. The winning shift below is unanimous — no coin and no day disagrees.
 * Relative difference at that shift:
 *
 *   sum_open_interest                 median 0.0e+0  max 0.0e+0   (bit-exact)
 *   sum_open_interest_value           median 0.0e+0  max 0.0e+0   (bit-exact)
 *   count_long_short_ratio            median 1.1e-4  max 2.8e-4
 *   count_toptrader_long_short_ratio  median 1.2e-4  max 3.2e-4
 *   sum_toptrader_long_short_ratio    median 1.4e-5  max 5.6e-5
 *   sum_taker_long_short_vol_ratio    median 1.2e-4  max 7.6e-3
 *
 * The non-zero residuals are the live API serving 4 decimal places against the
 * archive's 8. Open interest, which live serves in full, matches to the bit.
 */
export const ARCHIVE_BAR_MS = 300_000;

export const ARCHIVE_METRICS: Array<{
  /** Column in the archive CSV. */
  column: string;
  /** `FlowSample.metric` it becomes. */
  metric: string;
  /** Bars to add to the archive timestamp to reach the live convention. */
  shiftBars: 0 | 1;
}> = [
  { column: 'sum_open_interest', metric: 'openInterest', shiftBars: 1 },
  { column: 'sum_open_interest_value', metric: 'openInterestValue', shiftBars: 1 },
  { column: 'count_long_short_ratio', metric: 'longShortRatio', shiftBars: 1 },
  { column: 'count_toptrader_long_short_ratio', metric: 'topTraderAccountRatio', shiftBars: 1 },
  { column: 'sum_toptrader_long_short_ratio', metric: 'topTraderPositionRatio', shiftBars: 1 },
  // The only zero. See above.
  { column: 'sum_taker_long_short_vol_ratio', metric: 'takerBuySellRatio5m', shiftBars: 0 },
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
    /**
     * Which metrics to fetch. Undefined means all of them, which is what the
     * schedule wants.
     *
     * A one-off backfill does not: three of these are in the bulk archive at
     * 5-minute resolution, so re-fetching them over a multi-year window would
     * be hundreds of pages per coin to re-store rows already held.
     */
    only?: string[],
  ): Promise<CollectResult> {
    const failed: Record<string, string> = {};
    let saved = 0;
    let fetched = 0;
    const specs = only ? METRICS.filter((m) => only.includes(m.metric)) : METRICS;
    if (specs.length === 0) {
      throw new Error(`collect: no metric matches ${only?.join(',')}`);
    }

    for (const symbol of symbols) {
      for (const spec of specs) {
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
          // Omitted entirely for an endpoint with no bucket. Sending
          // `undefined: undefined` would put a literal "undefined" key on the
          // query string.
          ...(spec.intervalParam ? { [spec.intervalParam]: spec.period } : {}),
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
