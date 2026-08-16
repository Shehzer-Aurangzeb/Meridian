import { Candle } from './candle.types';
import {
  ADXResult,
  BollingerBandsResult,
  QQEResult,
} from '../../indicators/interfaces/indicator.types';

/**
 * One bundle of price data and every measurement taken from it, built once at
 * the start of an analysis and passed to everything that needs it. Nothing
 * downstream fetches or recalculates, so no two parts can disagree.
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
