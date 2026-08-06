import { BinanceService } from '../../market-data/market-data.service';
import { Candle } from '../../common/types/candle.types';
import { SupportResistanceService } from './support-resistance.service';
import {
  FIB_ANCHOR_TIMEFRAME,
  LEVEL_TIMEFRAMES,
  LevelMapService,
} from './level-map.service';

/**
 * A triangle wave whose swing prices depend on the timeframe, so each
 * timeframe contributes its own distinct levels and cross-timeframe
 * confluence can be told apart from one detector firing twice.
 */
function candlesFor(timeframe: string): Candle[] {
  const base = timeframe === '12h' ? 30_000 : timeframe === '4h' ? 30_050 : 30_100;
  const out: Candle[] = [];
  for (let i = 0; i < 150; i++) {
    const phase = i % 20;
    const close = phase < 10 ? base + phase * 150 : base + 1_500 - (phase - 10) * 150;
    out.push({
      time: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
      open: close,
      high: close + 40,
      low: close - 40,
      close,
      volume: 1_000 + i,
    });
  }
  return out;
}

describe('LevelMapService', () => {
  const fetched: string[] = [];
  const binance = {
    getCandles: (_symbol: string, interval: string) => {
      fetched.push(interval);
      return Promise.resolve(candlesFor(interval));
    },
  } as unknown as BinanceService;

  const service = new LevelMapService(binance, new SupportResistanceService());

  beforeEach(() => (fetched.length = 0));

  it('gathers every configured timeframe', async () => {
    const map = await service.build('BTC');
    expect(fetched.sort()).toEqual([...LEVEL_TIMEFRAMES].sort());
    expect(map.perTimeframe).toHaveLength(LEVEL_TIMEFRAMES.length);
  });

  it('anchors Fibonacci to the declared timeframe and surfaces it', async () => {
    const map = await service.build('BTC');
    // The anchor is a choice inside the playbook's latitude ("Weekly
    // acceptable too"), so it must never be implicit.
    expect(map.anchor?.timeframe).toBe(FIB_ANCHOR_TIMEFRAME);
    expect(map.fib).toHaveLength(5);
    expect(map.fib.map((f) => f.ratio)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('takes spot from the lowest timeframe, not the highest', async () => {
    const map = await service.build('BTC');
    const lowest = LEVEL_TIMEFRAMES[LEVEL_TIMEFRAMES.length - 1];
    const expected = candlesFor(lowest).slice(-1)[0].close;
    expect(map.spot).toBe(expected);
  });

  it('labels marks by timeframe so confluence is cross-timeframe', async () => {
    const map = await service.build('BTC');
    const sources = new Set(map.marks.map((m) => m.source));

    // At least two different timeframes must be represented, otherwise
    // "confluence" is one detector agreeing with itself.
    const tfsPresent = LEVEL_TIMEFRAMES.filter((tf) =>
      [...sources].some((s) => s.startsWith(`${tf} `)),
    );
    expect(tfsPresent.length).toBeGreaterThanOrEqual(2);

    // Source identity must not include the touch count — that would let two
    // adjacent same-timeframe levels clear minSources on their own.
    expect([...sources].some((s) => /x\d/.test(s))).toBe(false);
  });

  it('carries touch counts for display even though they are not identity', async () => {
    const map = await service.build('BTC');
    const withTouches = map.marks.filter((m) => m.touchCount !== undefined);
    expect(withTouches.length).toBeGreaterThan(0);
    expect(withTouches.every((m) => (m.touchCount ?? 0) >= 2)).toBe(true);
  });

  it('refuses to build a map with no candles rather than reporting a zero spot', async () => {
    const empty = new LevelMapService(
      { getCandles: () => Promise.resolve([]) } as unknown as BinanceService,
      new SupportResistanceService(),
    );
    await expect(empty.build('BTC')).rejects.toThrow(/cannot build a level map/);
  });
});
