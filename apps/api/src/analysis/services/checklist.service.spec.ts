import { ChecklistService } from './checklist.service';
import { EntryChecklistParams } from '../interfaces/checklist.types';

/**
 * Condition 5 only. It counts how many times a level has been tested, and it
 * was reading a different number that happens to look like a count.
 */
describe('ChecklistService — the S/R condition counts tests', () => {
  const service = new ChecklistService();

  // Everything except `nearestLevel` is held still and deliberately chosen so
  // the other four conditions cannot decide the result.
  const base: Omit<EntryChecklistParams, 'nearestLevel'> = {
    tradeType: 'long',
    rsi: 35,
    qqeColor: 'green',
    currentPrice: 100,
    bollingerBands: { upper: 110, middle: 100, lower: 90 },
    bandWidth: 20,
    marketStructure: 'HH/HL',
  };

  const at = (touchCount: number) =>
    service.evaluateChecklist({
      ...base,
      // 1% away: inside the 2% full-credit band, so proximity is never the
      // reason this passes or fails.
      nearestLevel: { price: 99, type: 'support', touchCount },
    }).supportResistance;

  it('passes a level tested three times', () => {
    const c = at(3);
    expect(c.passed).toBe(true);
    expect(c.reason).toContain('3 tests');
  });

  it('fails a level tested twice with no volume confirmation', () => {
    // THE REGRESSION. This used to receive `strength`, a 1-5 score: two touches
    // on a level that HELD scored round(2 + 0.5) = 3, which cleared a threshold
    // named STRONG_MIN_TESTS: 3 and took full credit. A level touched twice was
    // reported to the user as "3 tests".
    //
    // Partial credit needs exactly two touches AND above-average volume on the
    // second, and no volume is supplied here, so two touches must not pass.
    const c = at(2);
    expect(c.passed).toBe(false);
    expect(c.value).toContain('2 tests');
  });

  it('fails a level tested once', () => {
    expect(at(1).passed).toBe(false);
  });

  it('reports the count it was given, never a score', () => {
    // Five touches is 5, not clamped to the 1-5 strength ceiling by accident.
    expect(at(7).value).toContain('7 tests');
  });
});
