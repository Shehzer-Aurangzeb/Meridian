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
