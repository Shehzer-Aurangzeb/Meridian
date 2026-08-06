import { Candle } from '../common/types/candle.types';
import { findFirstFill, findFirstOutcome } from './replay';

const bar = (low: number, high: number): Candle => ({
  time: new Date(Date.UTC(2026, 0, 1)),
  open: (low + high) / 2,
  high,
  low,
  close: (low + high) / 2,
  volume: 1,
});

describe('replay', () => {
  describe('findFirstFill', () => {
    it('fills a long on a wick down to entry, not on the close', () => {
      // A resting limit order fills on a touch. Requiring the close would
      // silently drop every trade that filled intraday and reversed.
      expect(findFirstFill([bar(99, 105)], 'LONG', 100)).not.toBeNull();
      expect(findFirstFill([bar(101, 105)], 'LONG', 100)).toBeNull();
    });

    it('fills a short on a wick up to entry', () => {
      expect(findFirstFill([bar(95, 101)], 'SHORT', 100)).not.toBeNull();
      expect(findFirstFill([bar(95, 99)], 'SHORT', 100)).toBeNull();
    });

    it('returns the FIRST touch, not the deepest', () => {
      const first = bar(99, 105);
      const deeper = bar(90, 105);
      expect(findFirstFill([first, deeper], 'LONG', 100)).toBe(first);
    });
  });

  describe('findFirstOutcome', () => {
    it('counts a straddling candle as a stop, never a target', () => {
      // OHLC carries no intra-candle ordering. Assuming the target filled
      // first would flatter every result in the journal.
      expect(findFirstOutcome([bar(89, 111)], 'LONG', 90, 110)).toBe('STOPPED_OUT');
      expect(findFirstOutcome([bar(89, 111)], 'SHORT', 110, 90)).toBe('STOPPED_OUT');
    });

    it('resolves whichever level is touched first in time', () => {
      expect(findFirstOutcome([bar(95, 111), bar(89, 100)], 'LONG', 90, 110)).toBe('TARGET_HIT');
      expect(findFirstOutcome([bar(89, 100), bar(95, 111)], 'LONG', 90, 110)).toBe('STOPPED_OUT');
    });

    it('mirrors the sides for a short', () => {
      expect(findFirstOutcome([bar(89, 100)], 'SHORT', 110, 90)).toBe('TARGET_HIT');
      expect(findFirstOutcome([bar(100, 111)], 'SHORT', 110, 90)).toBe('STOPPED_OUT');
    });

    it('stays OPEN when neither level is reached', () => {
      expect(findFirstOutcome([bar(95, 105)], 'LONG', 90, 110)).toBe('OPEN');
      expect(findFirstOutcome([], 'LONG', 90, 110)).toBe('OPEN');
    });
  });
});
