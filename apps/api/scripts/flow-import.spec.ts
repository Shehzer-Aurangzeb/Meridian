import { transform, coinOf } from './flow-import';
import { ARCHIVE_METRICS, ARCHIVE_BAR_MS } from '../src/flow/flow-collector.service';

const HEAD =
  'create_time,symbol,sum_open_interest,sum_open_interest_value,' +
  'count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,' +
  'count_long_short_ratio,sum_taker_long_short_vol_ratio';
/** One row: OI, OIvalue, topAcct, topPos, globalAcct, taker. */
const row = (t: string, oi: number) =>
  `${t},BTCUSDT,${oi},${oi * 100},1.1,1.2,1.3,1.4`;
const at = (s: Sample[], metric: string) => s.filter((x) => x.metric === metric);
type Sample = ReturnType<typeof transform>[number];
const iso = (ms: number) => new Date(ms).toISOString();

describe('flow-import transform — the four archive traps', () => {
  it('SORTS: file order is not chronological in 1,044 real files', () => {
    const s = transform('BTC', [HEAD,
      row('2026-08-20 01:45:00', 2),
      row('2026-08-20 00:35:00', 1),
      row('2026-08-20 03:30:00', 3),
    ].join('\n'));
    const oi = at(s, 'openInterest');
    expect(oi.map((x) => x.value)).toEqual([1, 2, 3]);
    expect(oi.map((x) => x.ts)).toEqual([...oi.map((x) => x.ts)].sort((a, b) => a - b));
  });

  it('FLOORS a timestamp that is seconds late onto its 5-minute bucket', () => {
    // Real: BNBUSDT-metrics-2024-04-03 stamps 02:00:01 and 02:45:03.
    const s = transform('BNB', [HEAD, row('2024-04-03 02:00:01', 7)].join('\n'));
    // openInterest shifts +1 bar, so the bucket is 02:00 and the row lands 02:05.
    expect(iso(at(s, 'openInterest')[0].ts)).toBe('2024-04-03T02:05:00.000Z');
    // taker does not shift, so it stays on the floored bucket itself.
    expect(iso(at(s, 'takerBuySellRatio5m')[0].ts)).toBe('2024-04-03T02:00:00.000Z');
  });

  it('DEDUPES a repeated timestamp — 263 files repeat every row', () => {
    const s = transform('BTC', [HEAD,
      row('2020-09-01 00:00:00', 5),
      row('2020-09-01 00:00:00', 5),
      row('2020-09-01 00:05:00', 6),
    ].join('\n'));
    expect(at(s, 'openInterest')).toHaveLength(2);
    expect(s).toHaveLength(2 * ARCHIVE_METRICS.length);
  });

  it('SHIFTS snapshots forward one bar and leaves the taker flow alone', () => {
    const s = transform('BTC', [HEAD, row('2026-08-20 00:00:00', 9)].join('\n'));
    const bucket = Date.parse('2026-08-20T00:00:00Z');
    for (const m of ARCHIVE_METRICS) {
      const got = at(s, m.metric)[0];
      expect(got.ts).toBe(bucket + m.shiftBars * ARCHIVE_BAR_MS);
    }
    // The rule itself, so a silent flip to all-zero or all-one fails here.
    expect(at(s, 'takerBuySellRatio5m')[0].ts).toBe(bucket);
    expect(at(s, 'openInterest')[0].ts).toBe(bucket + ARCHIVE_BAR_MS);
    expect(at(s, 'openInterest')[0].ts - at(s, 'takerBuySellRatio5m')[0].ts).toBe(300_000);
  });

  it('throws on a wrong-shaped file instead of importing nothing', () => {
    expect(() => transform('BTC', 'a,b,c\n1,2,3')).toThrow(/create_time/);
    expect(() => transform('BTC', ['create_time,symbol', '2026-08-20 00:00:00,BTCUSDT'].join('\n')))
      .toThrow(/sum_open_interest/);
    expect(() => transform('BTC', [HEAD, row('not-a-date', 1)].join('\n')))
      .toThrow(/unparseable create_time/);
  });

  it('drops a row that belongs to another day, so each bucket has one owner', () => {
    // Real: BNBUSDT-metrics-2024-04-03 carries a 2024-04-04 00:00 row, and the
    // 04-04 file carries the same bucket with a DIFFERENT open interest
    // (449697.58 vs 449671.69). Without the filename date, which one survives
    // is decided by insertion order.
    const csv = [HEAD,
      row('2024-04-03 23:55:00', 1),
      row('2024-04-04 00:00:00', 2),
    ].join('\n');
    expect(transform('BNB', csv)).toHaveLength(2 * ARCHIVE_METRICS.length);
    const owned = transform('BNB', csv, '2024-04-03');
    expect(owned).toHaveLength(1 * ARCHIVE_METRICS.length);
    // The kept row is 23:55, and openInterest shifts +1 into the next day —
    // that is the shift doing its job, NOT a stray row sneaking back in.
    expect(iso(at(owned, 'openInterest')[0].ts)).toBe('2024-04-04T00:00:00.000Z');
    expect(at(owned, 'openInterest')[0].value).toBe(1);
  });

  it('maps the archive filename to the collector`s coin key', () => {
    expect(coinOf('BTCUSDT-metrics-2026-08-20.zip')).toBe('BTC');
    expect(coinOf('/x/y/AVAXUSDT-metrics-2021-12-01.zip')).toBe('AVAX');
  });
});
