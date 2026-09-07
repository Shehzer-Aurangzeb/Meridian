import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { ConditionQuery, ConditionResult } from './map.types';

/** Matches below this cannot support a reading, whatever their spread. */
export const MIN_MATCHES = 100;
/** Distinct 30-day blocks the matches must span. */
export const MIN_BLOCKS = 4;
const BLOCK_MS = 30 * 86_400_000;

export interface Analogue {
  time: number;
  /** Forward return over the horizon, signed. */
  forwardReturn: number;
  /** Worst drawdown over the horizon, as a negative fraction. */
  maxAdverse: number;
}

/**
 * Answers a conditional question by FINDING ANALOGUES, never by simulating.
 *
 * "Funding is high, open interest is rising, price is at the top of its band —
 * what usually happens?" is answered with: this state occurred N times, and
 * here is the distribution of what followed. No model, no assumption about the
 * shape of returns, and no claim that the next occurrence will resemble them.
 *
 * ─── The warning field is the point ──────────────────────────────────────
 * The magnitude gate produced a bootstrap interval of [2.62, 2.62] from 17
 * trades that all landed in one 30-day block. Zero width. It looked exactly
 * like certainty and was a single month resampled against itself. So a result
 * here carries a `warning` whenever the matches are too few or too clustered,
 * and the caller cannot render the numbers without also receiving it.
 */
@Injectable()
export class ConditionService {
  private readonly logger = new Logger(ConditionService.name);

  constructor(
    private readonly binance: BinanceService,
    private readonly indicators: IndicatorsService,
  ) {}

  /**
   * Score a set of analogues.
   *
   * Split from the search so the arithmetic is testable without a network
   * call, which is also what lets the contract tests assert the warning
   * behaviour directly.
   */
  summarise(analogues: Analogue[], horizonHours: number, baseRate: number): ConditionResult {
    const blocks = new Set<number>();
    if (analogues.length > 0) {
      const t0 = Math.min(...analogues.map((a) => a.time));
      for (const a of analogues) blocks.add(Math.floor((a.time - t0) / BLOCK_MS));
    }

    const warning = this.warningFor(analogues.length, blocks.size);
    if (analogues.length === 0) {
      return {
        matches: 0,
        blocks: 0,
        firstMatch: null,
        lastMatch: null,
        outcomes: null,
        warning,
      };
    }

    const times = analogues.map((a) => a.time).sort((a, b) => a - b);
    const abs = analogues.map((a) => Math.abs(a.forwardReturn)).sort((a, b) => a - b);
    const q = (xs: number[], p: number): number =>
      xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];

    const adverse = analogues.filter((a) => a.maxAdverse <= -0.05).length / analogues.length;
    const up = analogues.filter((a) => a.forwardReturn > 0).length / analogues.length;

    return {
      matches: analogues.length,
      blocks: blocks.size,
      firstMatch: new Date(times[0]).toISOString(),
      lastMatch: new Date(times[times.length - 1]).toISOString(),
      outcomes: {
        absMove: { p50: q(abs, 0.5), p90: q(abs, 0.9) },
        adverse5pct: { rate: adverse, baseRate },
        // Reported precisely BECAUSE it is a coin flip. Removing it would
        // invite the reader to supply a direction the data does not carry.
        direction: { up, down: 1 - up },
        medianOiChange: null,
      },
      warning,
    };
  }

  private warningFor(matches: number, blocks: number): string | null {
    if (matches < MIN_MATCHES && blocks < MIN_BLOCKS) {
      return (
        `Only ${matches} matches, spanning ${blocks} distinct 30-day blocks. ` +
        `Below both thresholds (${MIN_MATCHES} matches, ${MIN_BLOCKS} blocks) — read this as anecdote, not evidence.`
      );
    }
    if (matches < MIN_MATCHES) {
      return `Only ${matches} matches, below the ${MIN_MATCHES} needed to read the distribution.`;
    }
    if (blocks < MIN_BLOCKS) {
      return (
        `${matches} matches but they span only ${blocks} distinct 30-day blocks. ` +
        'Clustered in time, so this describes a few weeks of market rather than a general pattern.'
      );
    }
    return null;
  }

  /**
   * Find analogues on live candle history.
   *
   * Deliberately narrow: only conditions computable from candles are supported
   * here. Funding and open-interest conditions need series the flow collector
   * was writing before it was switched off, and answering them from a 30-day
   * live window would silently make a multi-year question into a monthly one.
   */
  async find(symbol: string, query: ConditionQuery): Promise<ConditionResult> {
    const coin = symbol.toUpperCase();
    const horizon = query.horizonHours ?? 24;
    const candles = await this.binance.getCandlesPaged(coin, '1h', 8000);
    const closes = candles.map((c) => c.close);

    const analogues: Analogue[] = [];
    let baseHits = 0;
    let baseTotal = 0;

    for (let i = 250; i + horizon < candles.length; i += 1) {
      const price = closes[i];
      if (!(price > 0)) continue;

      let worst = 0;
      for (let k = 1; k <= horizon; k += 1) {
        const p = closes[i + k];
        if (p > 0) worst = Math.min(worst, p / price - 1);
      }
      const forward = closes[i + horizon] / price - 1;
      baseTotal += 1;
      if (worst <= -0.05) baseHits += 1;

      if (query.percentBMin !== undefined || query.percentBMax !== undefined) {
        const context = this.indicators.buildContext(coin, '1h', candles.slice(i - 249, i + 1));
        const { upper, lower } = context.bollingerBands;
        if (upper === lower) continue;
        const percentB = (price - lower) / (upper - lower);
        if (query.percentBMin !== undefined && percentB < query.percentBMin) continue;
        if (query.percentBMax !== undefined && percentB > query.percentBMax) continue;
      }

      analogues.push({
        time: candles[i].time.getTime(),
        forwardReturn: forward,
        maxAdverse: worst,
      });
    }

    return this.summarise(analogues, horizon, baseTotal === 0 ? 0 : baseHits / baseTotal);
  }
}
