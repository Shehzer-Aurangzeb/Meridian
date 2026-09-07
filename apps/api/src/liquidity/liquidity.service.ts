import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildProfile, DepthProfile, MAX_SHELL_PERCENT, shellForDistance } from './depth.math';
import { buildShelfMap, ShelfBucket, ShelfSnapshot } from './shelf-map.math';

/**
 * Where resting size sits. A measurement, never a forecast.
 *
 * Bar 3a asked whether a thick bid shelf makes a support zone hold and found a
 * gap of -0.75 points against a bar of +8 (interval [-7.93, 5.51]). So nothing
 * here feeds a probability. It is published because where the book is thin is a
 * true and useful thing to look at, and for no other reason.
 */
@Injectable()
export class LiquidityService {
  private readonly logger = new Logger(LiquidityService.name);

  /** Trailing window each shell's percentile is measured against, in hours. */
  private static readonly LOOKBACK_HOURS = 90 * 24;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reject a distance the archive cannot speak to.
   *
   * An error, not a clamp and not an extrapolation. Binance publishes depth to
   * +-5% of mid and nothing beyond it; answering a 10% question with the 5%
   * figure would be inventing data, and answering it with "thin" would be
   * worse — the book there is unknown, not empty.
   */
  assertWithinRange(distancePercent: number): void {
    if (shellForDistance(distancePercent) === null) {
      throw new BadRequestException(
        `Depth is published only to +-${MAX_SHELL_PERCENT}% of mid; ` +
          `${distancePercent}% is outside the data. This is not extrapolated.`,
      );
    }
  }

  /** The current depth profile, each shell scored against its own history. */
  async profile(symbol: string): Promise<DepthProfile | null> {
    const coin = symbol.toUpperCase();
    const latest = await this.prisma.bookProfile.findFirst({
      where: { symbol: coin },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
    if (!latest) return null;

    const current = await this.prisma.bookProfile.findMany({
      where: { symbol: coin, ts: latest.ts },
      select: { shell: true, bidNotional: true, askNotional: true },
    });

    const since = new Date(latest.ts.getTime() - LiquidityService.LOOKBACK_HOURS * 3_600_000);
    const rows = await this.prisma.bookProfile.findMany({
      where: { symbol: coin, ts: { gte: since, lt: latest.ts } },
      select: { shell: true, bidNotional: true, askNotional: true },
    });

    const history = new Map<number, { bid: number[]; ask: number[] }>();
    for (const r of rows) {
      const cell = history.get(r.shell) ?? { bid: [], ask: [] };
      cell.bid.push(r.bidNotional);
      cell.ask.push(r.askNotional);
      history.set(r.shell, cell);
    }

    return buildProfile(coin, latest.ts, current, history);
  }

  /**
   * Where size has historically rested, in absolute prices.
   *
   * `days` is bounded because the archive stops on 2026-08-30 and because a
   * shelf map over a year of a moving market smears into a flat line that says
   * nothing.
   */
  async shelfMap(symbol: string, days = 30): Promise<ShelfBucket[]> {
    const coin = symbol.toUpperCase();
    const latest = await this.prisma.bookProfile.findFirst({
      where: { symbol: coin },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
    if (!latest) return [];

    const since = new Date(latest.ts.getTime() - days * 86_400_000);
    const rows = await this.prisma.bookProfile.findMany({
      where: { symbol: coin, ts: { gte: since } },
      select: { ts: true, shell: true, bidNotional: true, askNotional: true },
      orderBy: { ts: 'asc' },
    });

    // The archive stores shells as percentages of mid but not the mid itself,
    // so it is reconstructed from the candle close at each bucket. Without a
    // mid, a shell has no absolute price and the snapshot is skipped rather
    // than anchored to a guess.
    const byTs = new Map<number, ShelfSnapshot>();
    for (const r of rows) {
      const key = r.ts.getTime();
      const snap = byTs.get(key) ?? {
        mid: 0,
        bidByShell: new Array(MAX_SHELL_PERCENT).fill(0),
        askByShell: new Array(MAX_SHELL_PERCENT).fill(0),
      };
      if (r.shell >= 1 && r.shell <= MAX_SHELL_PERCENT) {
        snap.bidByShell[r.shell - 1] = r.bidNotional;
        snap.askByShell[r.shell - 1] = r.askNotional;
      }
      byTs.set(key, snap);
    }
    return buildShelfMap([...byTs.values()].filter((s) => s.mid > 0));
  }

  /**
   * The same map, anchored to mids the caller supplies.
   *
   * Split from `shelfMap` because the mid comes from the candle series, which
   * this service does not own. Handing it in keeps the price source single and
   * visible rather than fetched twice and silently disagreeing.
   */
  async shelfMapWithMids(
    symbol: string,
    mids: Map<number, number>,
    days = 30,
  ): Promise<ShelfBucket[]> {
    const coin = symbol.toUpperCase();
    const latest = await this.prisma.bookProfile.findFirst({
      where: { symbol: coin },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
    if (!latest) return [];

    const since = new Date(latest.ts.getTime() - days * 86_400_000);
    const rows = await this.prisma.bookProfile.findMany({
      where: { symbol: coin, ts: { gte: since } },
      select: { ts: true, shell: true, bidNotional: true, askNotional: true },
      orderBy: { ts: 'asc' },
    });

    const byTs = new Map<number, ShelfSnapshot>();
    for (const r of rows) {
      const key = r.ts.getTime();
      const hour = Math.floor(key / 3_600_000) * 3_600_000;
      const mid = mids.get(hour);
      if (mid === undefined || !(mid > 0)) continue;
      const snap = byTs.get(key) ?? {
        mid,
        bidByShell: new Array(MAX_SHELL_PERCENT).fill(0),
        askByShell: new Array(MAX_SHELL_PERCENT).fill(0),
      };
      if (r.shell >= 1 && r.shell <= MAX_SHELL_PERCENT) {
        snap.bidByShell[r.shell - 1] = r.bidNotional;
        snap.askByShell[r.shell - 1] = r.askNotional;
      }
      byTs.set(key, snap);
    }
    return buildShelfMap([...byTs.values()]);
  }
}
