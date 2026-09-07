import { findDirectionalLanguage, statesDirection, assertNoDirection } from './direction-guard';

describe('direction guard — catches the claims the map does not make', () => {
  const caught = (text: string): string[] =>
    findDirectionalLanguage(text).map((f) => f.category);

  it('catches forecast verbs', () => {
    expect(statesDirection('Price will rise from here.')).toBe(true);
    expect(statesDirection('It should bounce off this level.')).toBe(true);
    expect(statesDirection('Expect a move to 62,000.')).toBe(true);
    expect(caught('The setup is bullish.')).toContain('forecast');
  });

  it('catches trade instructions', () => {
    expect(statesDirection('Buy here.')).toBe(true);
    expect(statesDirection('You could go long.')).toBe(true);
    expect(statesDirection('Take profit at the upper band.')).toBe(true);
    expect(statesDirection('Set a stop below the zone.')).toBe(true);
  });

  it('catches price objectives', () => {
    expect(statesDirection('Target of $61,200.')).toBe(true);
    expect(statesDirection('The entry zone is nearby.')).toBe(true);
    expect(statesDirection('Stop-loss sits under support.')).toBe(true);
    expect(statesDirection('The risk-reward is favourable.')).toBe(true);
  });
});

describe('direction guard — does NOT fire on correct writing', () => {
  // THE FAILURE MODE THAT MATTERS. A guard that flags good prose gets
  // switched off by whoever maintains it, and then it protects nothing.
  const clean = [
    'Over the long term, this coin has been quieter than its neighbours.',
    'As long as the band stays narrow, the market is in compression.',
    'The move was short-lived and price returned to the middle of the range.',
    'In the short run, the book is thinner than usual.',
    'This is a shorter horizon than the one above.',
    'Fifty percent of the time, the next four hours stay inside 62 basis points.',
    'The zone is a price area where buyers have stepped in before.',
    'Resting bid size two percent below is in the twelfth percentile for this coin.',
    'The market has been trending for 71 hours.',
    'Compression means the bands are narrow compared with this coin own history.',
    'Historically, price reached this zone within three hours.',
    'The system does not forecast direction.',
  ];

  it.each(clean)('stays quiet on: %s', (text) => {
    expect(findDirectionalLanguage(text)).toEqual([]);
  });
});

describe('assertNoDirection', () => {
  it('passes clean narration through', () => {
    expect(() => assertNoDirection('The market is in compression. It has held for 71 hours.')).not.toThrow();
  });

  it('throws, naming what it found, so the failure is diagnosable', () => {
    expect(() => assertNoDirection('Price will rally. Take profit at 62,000.')).toThrow(/will rally/);
    expect(() => assertNoDirection('Price will rally.')).toThrow(/does not forecast direction/);
  });

  it('finds every occurrence, not just the first', () => {
    // A shared /g/ regex keeps lastIndex between calls and silently skips
    // every second match; this is the test that catches that.
    const found = findDirectionalLanguage('It is bullish. Truly bullish. Very bullish.');
    expect(found.length).toBe(3);
  });

  it('is idempotent across repeated calls', () => {
    const text = 'The setup is bullish.';
    expect(findDirectionalLanguage(text).length).toBe(1);
    expect(findDirectionalLanguage(text).length).toBe(1);
    expect(findDirectionalLanguage(text).length).toBe(1);
  });
});
