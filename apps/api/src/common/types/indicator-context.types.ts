import { Candle } from './candle.types';
import {
  ADXResult,
  BollingerBandsResult,
  QQEResult,
} from '../../indicators/interfaces/indicator.types';

/**
 * IndicatorContext
 *
 * A single, immutable bundle of market data + pre-computed indicator
 * baselines for a given symbol/timeframe. Built ONCE at the start of an
 * analysis pipeline and shared across every downstream service
 * (regime classifier, squeeze breakout, checklist, etc.).
 *
 * This pattern eliminates:
 *   - Duplicate Binance candle fetches per request.
 *   - Redundant RSI/BB/ADX/QQE recomputation across services.
 *
 * Services that previously did their own I/O + math should now expose a
 * `*FromContext(context: IndicatorContext)` variant. Their original
 * `(symbol, timeframe)` signatures should delegate to the context-based
 * implementation so they remain usable in isolation.
 *
 * Mathematically equivalent to the legacy per-service pipelines —
 * we only de-duplicate work, never alter inputs or calculations.
 */
export interface IndicatorContext {
  /** Symbol the context was built for (uppercase). */
  readonly symbol: string;

  /** Candle timeframe (e.g. '1h'). */
  readonly timeframe: string;

  /** Raw candle series fetched from BinanceService. */
  readonly candles: ReadonlyArray<Candle>;

  /** Pre-extracted OHLCV series for fast iteration. */
  readonly closes: ReadonlyArray<number>;
  readonly highs: ReadonlyArray<number>;
  readonly lows: ReadonlyArray<number>;
  readonly volumes: ReadonlyArray<number>;

  /** Current RSI(14). */
  readonly rsi: number;

  /**
   * Trailing RSI(14) values used as the relative-momentum baseline for the
   * checklist Z-score calculation. Length is up to 100; the checklist falls
   * back to strict RSI thresholds when fewer than 100 are available.
   */
  readonly rsiHistory: ReadonlyArray<number>;

  /** Full ADX(14) result: adx, +DI, -DI. */
  readonly adx: ADXResult;

  /** Current ATR(14). */
  readonly atr: number;

  /** Current Bollinger Bands (20, 2). */
  readonly bollingerBands: BollingerBandsResult;

  /** Current band width as percentage of middle band. */
  readonly bandWidth: number;

  /**
   * Historical bandwidth distribution over the supplied closes.
   * Used by the regime classifier for percentile-rank compression detection.
   */
  readonly bandWidthSeries: ReadonlyArray<number>;

  /** Current QQE state (color, value, trend, previous color). */
  readonly qqe: QQEResult;
}
