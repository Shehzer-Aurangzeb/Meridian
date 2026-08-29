import { NotFoundException } from '@nestjs/common';
import axios from 'axios';
import type { Cache } from 'cache-manager';
import { BinanceService } from './market-data.service';
import { CacheTelemetryService } from './cache-telemetry.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const cache = {
  get: () => Promise.resolve(undefined),
  set: () => Promise.resolve(undefined),
  del: () => Promise.resolve(undefined),
} as unknown as Cache;

/** An axios error shaped the way Binance actually returns one. */
const binanceRejection = (status: number, body: unknown) => {
  const err = Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data: body },
  });
  (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
  return err;
};

describe('BinanceService — error classification', () => {
  let service: BinanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BinanceService(cache, new CacheTelemetryService());
  });

  it('maps an unlisted symbol to 404, not 500 — a typo is not an outage', async () => {
    mockedAxios.get.mockRejectedValue(
      binanceRejection(400, { code: -1121, msg: 'Invalid symbol.' }),
    );

    await expect(service.getCurrentPrice('NOTACOIN')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getCandles('NOTACOIN', '1h', 10)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps a genuine Binance failure a 500 — that one IS ours', async () => {
    // 418 is Binance's ban response: a real problem, not a bad symbol. It is
    // also not retried, so it surfaces immediately.
    mockedAxios.get.mockRejectedValue(
      binanceRejection(418, { code: -1003, msg: 'Way too much request weight' }),
    );

    const err = await service.getCurrentPrice('BTC').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toContain('Way too much request weight');
  });
});


describe('BinanceService.getCandlesFrom — paging to the live edge', () => {
  let service: BinanceService;
  const HOUR = 3_600_000;
  const START = 1_700_000_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BinanceService(cache, new CacheTelemetryService());
  });

  /** `count` hourly klines from `from`, in Binance's array shape. */
  const klines = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => [
      from + i * HOUR, '1', '2', '0', '1.5', '10', 0, '0', 0, '0', '0', '0',
    ]);

  it('stops on a SHORT page instead of asking again for nothing', async () => {
    // The window runs past the live edge, which is every analysis newer than
    // ~4 days — exactly the set the scoring job re-reads. The old loop only
    // stopped on an EMPTY page, so each of those cost a second request and a
    // 120ms sleep to be told what the short page already said.
    mockedAxios.get.mockImplementation(async (_url, config?: unknown) => {
      const { startTime } = (config as { params: { startTime: number } }).params;
      return { data: startTime === START ? klines(START, 30) : [] };
    });

    const candles = await service.getCandlesFrom('BTC', '1h', START, 98);

    expect(candles).toHaveLength(30);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('keeps paging while pages come back FULL', async () => {
    // The other half of the rule. Binance caps a klines response at 1000, so
    // only a window deeper than that needs a second request — and a full page
    // is the one thing that means "there may be more".
    let call = 0;
    mockedAxios.get.mockImplementation(async () => {
      call += 1;
      return { data: call === 1 ? klines(START, 1000) : klines(START + 1000 * HOUR, 500) };
    });

    const candles = await service.getCandlesFrom('BTC', '1h', START, 1500);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(1500);
    expect(candles[0].time.getTime()).toBe(START);
    expect(candles[1499].time.getTime()).toBe(START + 1499 * HOUR);
  });

  it('a window inside the cap is ONE request, never two', async () => {
    // klines returns everything it has from startTime up to the limit, so for
    // any window of 1000 bars or fewer a second request cannot add anything.
    mockedAxios.get.mockResolvedValue({ data: klines(START, 98) });

    const candles = await service.getCandlesFrom('BTC', '1h', START, 98);

    expect(candles).toHaveLength(98);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
