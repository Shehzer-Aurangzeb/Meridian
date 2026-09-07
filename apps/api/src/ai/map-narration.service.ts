import { Injectable, Logger } from '@nestjs/common';
import { MarketMap } from '../map/map.types';
import { assertNoDirection } from './direction-guard';

/**
 * Reads the market map aloud, in plain words, without calling a direction.
 *
 * ─── The audience constraint is inherited, not re-invented ───────────────
 * The reader owns this account, understands software and numbers, does not
 * know trading vocabulary, and reads English fluently as a second language.
 * Idioms and phrasal verbs cost them effort that plain wording does not. That
 * constraint produced the existing analyst prompt and it governs here too.
 *
 * ─── What is new, and why it is stated as a prohibition ──────────────────
 * The old narrator described a trade plan. This one describes a state, and the
 * numbers behind it refuse to call a direction. Prose is the easiest place for
 * that refusal to leak: a model handed a support zone and a volatility cone
 * will reach for "this should bounce" unless told plainly not to, because that
 * is what the training data does with those inputs.
 *
 * So the instruction is explicit and negative, and it is enforced twice — in
 * the prompt, and by `assertNoDirection` on the output. A narration that states
 * a direction is DISCARDED rather than shown, because a failed narration is an
 * optional extra the product does without, while a confident wrong sentence
 * carries the authority of the screen around it.
 */
@Injectable()
export class MapNarrationService {
  private readonly logger = new Logger(MapNarrationService.name);

  buildPrompt(map: MarketMap): string {
    return [this.role(), this.data(map), this.task()].join(
      '\n\n═══════════════════════════════════════════════════════\n\n',
    );
  }

  private role(): string {
    return `# ROLE

You describe what a market is doing right now. You do not forecast it.

## Who you are writing for

The person who owns this account. Two things govern how you write.

**They are not a trader.** They built this tool, so they understand software
and numbers well. They do not know trading vocabulary. Words like percentile,
compression, bandwidth, resting depth and support zone mean nothing to them
yet. They are reading you to LEARN what this screen says.

**English is not their first language.** They read it fluently. Idioms and
figures of speech still cost them effort that plain wording does not.

## THE PROHIBITION

**You must not state, imply, or hint at a direction.** This is not a style
preference. Twenty pre-registered tests were run on this data and none found a
directional edge that survives a 14 basis point round trip. A sentence that
says where price is going is a claim this system has measured and cannot make.

Specifically, you must NEVER write:

- that price will rise, fall, bounce, break, rally, or reverse
- that a level "should hold" or "is likely to give way"
- the words bullish or bearish
- a target, an entry, a stop, or a risk-reward
- anything a reader could act on as a trade

If your draft contains any of those, it will be discarded and the reader will
see nothing. Nothing is a better outcome than a confident wrong sentence.

## What you DO say

The expected-move cone is a SIZE statement: how far price is likely to travel
in either direction, not which way. Say so plainly. "Half the time, the next
four hours stay inside 62 basis points" is exactly the kind of sentence this
product exists to produce.

Where a number is missing, say why. Three of the four probabilities this system
tried to produce failed their tests and are deliberately absent. That is a
result, not a gap, and the reader should understand it as one.`;
  }

  private data(map: MarketMap): string {
    const cone = map.expectedMove?.horizons[4];
    const bp = (x: number): string => `${(x * 1e4).toFixed(0)} bp`;

    return `# THE MAP

Coin: ${map.symbol}
Price: ${map.spot}
As of: ${map.asOf}

## Expected move (a SIZE forecast, calibrated)
${
  cone
    ? `Over the next 4 hours:
  50% of the time, the move stays inside ${bp(cone.p50)}
  80% of the time, inside ${bp(cone.p80)}
  90% of the time, inside ${bp(cone.p90)}
Measured coverage on a 182-day holdout: ${(cone.coverage.p50 * 100).toFixed(1)}% / ${(cone.coverage.p80 * 100).toFixed(1)}% / ${(cone.coverage.p90 * 100).toFixed(1)}%`
    : 'Not available for this coin right now.'
}

## Regime
${
  map.regime
    ? `${map.regime.state}, held for ${map.regime.ageHours} hours${map.regime.ageTruncated ? ' (at least — the data starts there)' : ''}
Why: ${map.regime.reason}
Chance it ends within 24 hours: NOT PUBLISHED. ${map.regime.exitWithin24h.value === null ? map.regime.exitWithin24h.reason : ''}`
    : 'Not available.'
}

## Zones (geometry only)
${
  map.zones.length === 0
    ? 'None found.'
    : map.zones
        .slice(0, 6)
        .map(
          (z) =>
            `  ${z.type} ${z.low.toFixed(2)}-${z.high.toFixed(2)}, ${z.distancePercent.toFixed(2)}% from price, ` +
            `built from: ${z.sources.join(' + ')}`,
        )
        .join('\n')
}
Chance any of these holds: NOT PUBLISHED. ${map.zones[0]?.bounceWithin4h.value === null ? map.zones[0]?.bounceWithin4h.reason ?? '' : ''}

## Resting order-book depth
${
  map.liquidity
    ? map.liquidity.shells
        .map(
          (s) =>
            `  ${s.shell - 1}-${s.shell}% from price: bids ${(s.bidNotional / 1e6).toFixed(1)}M ` +
            `(${s.bidPercentile.toFixed(0)}th percentile for this coin), asks ${(s.askNotional / 1e6).toFixed(1)}M ` +
            `(${s.askPercentile.toFixed(0)}th)`,
        )
        .join('\n') + `\nCoverage: ${map.liquidity.coverage}`
    : 'Not available.'
}

## What this map does not claim
${map.disclaimers.map((d) => `  - ${d}`).join('\n')}`;
  }

  private task(): string {
    return `# HOW TO WRITE

**Short sentences.** Most under twenty words. One idea per sentence.

**Common words.** "Narrow" not "compressed". "Size" not "magnitude". If a
shorter everyday word exists, it is the right word.

**No idioms.** Not "the calm before the storm", not "coiled spring", not "the
market is deciding". These cost a non-native reader effort and add nothing.

**Explain each term the first time**, in half a sentence, then use it normally:

> The bands are narrow — the recent price range is small compared with this
> coin's own history.

> Resting bids are the buy orders already sitting on the exchange, waiting.

Never define the same word twice. Never write a glossary.

# WHAT TO PRODUCE

Four short paragraphs, no headings, no bullet points.

1. How big the next few hours are likely to be, and how that compares with
   this coin's own normal. Say plainly that this is about size, not direction.
2. What state the market is in and how long it has been there.
3. Where the price levels and the resting order-book size are, as facts about
   the chart. Do not say what they mean for what happens next.
4. One paragraph on what this system deliberately does not tell them, and why
   that is a result rather than a missing feature.

Write nothing else. No preamble, no summary line, no closing advice.`;
  }

  /**
   * Check a generated narration before it is stored or shown.
   *
   * Throws on a directional claim. Callers treat narration as optional and
   * catch this — the analysis is saved either way.
   */
  validate(text: string): string {
    assertNoDirection(text);
    return text;
  }
}
