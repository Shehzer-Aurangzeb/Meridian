import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { LevelMap } from '../analysis/services/level-map.service';
import { TradePlan } from '../analysis/services/trade-plan.service';
import { EntryChecklistResult } from '../analysis/interfaces/checklist.types';
import { MarketRegimeResult } from '../market-regime/interfaces/market-regime.types';
import { PLAYBOOK_RULES } from './playbook-rules';

export interface NarrationInput {
  map: LevelMap;
  plans: TradePlan[];
  regime: MarketRegimeResult;
  /**
   * One checklist per plan direction. Singular before: the prompt then
   * announced "read for long" over an analysis carrying a short plan too.
   */
  checklists: Partial<Record<'long' | 'short', EntryChecklistResult>> | null;
  regimeTimeframe: string;
}

export interface Narration {
  text: string;
  /** Prices Claude cited that trace to a computed number. */
  citedPrices: number[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class PriceProvenanceError extends Error {
  constructor(
    readonly invented: number[],
    readonly allowed: number[],
  ) {
    super(
      `Narration cited ${invented.length} price(s) with no computed source: ` +
        `${invented.map((p) => `$${p}`).join(', ')}. ` +
        `Claude may interpret the numbers it is given; it may not produce new ones.`,
    );
    this.name = 'PriceProvenanceError';
  }
}

/**
 * Asks Claude to EXPLAIN the analysis, never to produce it. Every price and
 * every number already exists before this runs and cannot be changed by it.
 *
 * That split is enforced rather than requested: every price in the reply is
 * checked against the computed ones, and the whole explanation is thrown away
 * if any of them cannot be traced. Rounding is fine; inventing a level is not,
 * and a warning in a log would never be read.
 */
@Injectable()
export class AnalystNarrationService {
  private readonly logger = new Logger(AnalystNarrationService.name);
  private readonly model = 'claude-opus-5';
  private client?: Anthropic;

  /**
   * Set up on first use, not at startup. A missing API key must fail only the
   * explanation, not take down the whole app for the pages that never use it.
   */
  private anthropic(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set — narration is unavailable. Every ' +
            'other part of the analysis runs without it.',
        );
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async narrate(input: NarrationInput): Promise<Narration> {
    const allowed = this.allowedPrices(input);
    const prompt = this.buildPrompt(input);

    // These settings exist to stay under a hard 30-second limit imposed by
    // the hosting, which cannot be raised. At the defaults this took about 45
    // seconds and the request was cut off before the answer came back. Less
    // thinking is safe here: the task is to read numbers aloud, not solve
    // anything.
    //
    // TODO: if this creeps back over the limit, reduce the effort one more
    // step. Do not turn thinking off entirely — that makes the model misbehave
    // in other ways.
    const response = await this.anthropic().messages.create({
      model: this.model,
      output_config: { effort: 'medium' },
      max_tokens: 8000,
      // No `temperature`: it is rejected outright (400) on this model family.
      // Wording stability comes from the prompt, not a sampling knob.
      //
      // ponytail: no server-side `fallbacks` — @anthropic-ai/sdk 0.95.2 types
      // it, but a declined narration is already reported as the optional extra
      // it is. Add `fallbacks: 'default'` if that ever needs to retry silently.
      messages: [{ role: 'user', content: prompt }],
    });

    // Check the stop reason BEFORE reading content: on a refusal `content` is
    // empty (pre-output) or a partial to discard (mid-stream), so indexing it
    // blind is how this breaks in production.
    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Claude declined to narrate this analysis` +
          `${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}. ` +
          `The computed numbers above are unaffected.`,
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const citedPrices = this.assertProvenance(text, allowed);

    return {
      text,
      citedPrices,
      model: this.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  //  Provenance
  // ════════════════════════════════════════════════════════════════════

  /**
   * The only prices the explanation is allowed to mention. Anything worked out
   * from them — a midpoint, an average — is not allowed. If a number is worth
   * saying, the code should have calculated it.
   */
  allowedPrices(input: NarrationInput): number[] {
    const prices: number[] = [input.map.spot, input.map.atr];

    if (input.map.anchor) {
      prices.push(input.map.anchor.low, input.map.anchor.high);
    }
    for (const f of input.map.fib) prices.push(f.price);
    for (const m of input.map.marks) prices.push(m.price);
    for (const z of input.map.zones) prices.push(z.low, z.high, z.center);

    for (const plan of input.plans) {
      prices.push(plan.stop, plan.averageEntry, plan.riskPerUnit);
      for (const e of plan.entries) prices.push(e.price);
      for (const t of plan.targets) prices.push(t.price);
    }

    const { bollingerBands, atr } = input.regime.metrics;
    prices.push(bollingerBands.upper, bollingerBands.middle, bollingerBands.lower, atr);

    return [...new Set(prices.filter((p) => Number.isFinite(p)))];
  }

  /**
   * Throws the explanation away if it quotes a price nothing computed.
   *
   * Only figures written with a dollar sign are checked — percentages and
   * ratios are the model's own arithmetic and are allowed. Rounding passes:
   * "$73" matches a computed 73.48, "$74" does not.
   */
  assertProvenance(text: string, allowed: number[]): number[] {
    const cited: number[] = [];
    const invented: number[] = [];

    for (const match of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
      const raw = match[1].replace(/,/g, '');
      const claimed = Number(raw);
      if (!Number.isFinite(claimed)) continue;

      const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
      const traced = allowed.some(
        (p) => p.toFixed(decimals) === claimed.toFixed(decimals),
      );

      (traced ? cited : invented).push(claimed);
    }

    if (invented.length > 0) {
      throw new PriceProvenanceError([...new Set(invented)], allowed);
    }

    return [...new Set(cited)];
  }

  // ════════════════════════════════════════════════════════════════════
  //  Prompt
  // ════════════════════════════════════════════════════════════════════

  buildPrompt(input: NarrationInput): string {
    return [
      this.role(),
      PLAYBOOK_RULES,
      this.data(input),
      this.task(),
    ].join('\n\n═══════════════════════════════════════════════════════\n\n');
  }

  private role(): string {
    return `# ROLE

You are a systematic trading analyst. You apply ONE specific trader's method
(below) mechanically and identically to every asset, and you explain what the
computed structure means.

## Who you are writing for

The person who owns this account. They decide whether to trade. Two things
about them govern how you write:

**They are not a trader.** They built this tool, so they understand software
and numbers well. They do not know trading vocabulary. Words like confluence,
R multiple, ADX, bandwidth percentile, swing high, S/R flip and blended R mean
nothing to them yet. They are reading your explanation to LEARN what this
screen is telling them.

**English is not their first language.** They read it fluently. Idioms,
phrasal verbs and figures of speech still cost them effort that plain wording
does not.

So your job is two jobs at once: say what the analysis means, and teach the
words it is made of, without ever sounding like a textbook or talking down.

## What you do NOT do

**You do not predict direction.** Five hypothesis families were measured on
this data against random controls; none produced an edge. Any sentence of the
form "this will bounce" or "expect a move to X" is outside what the numbers
support. Describe what IS, and what would have to happen next for each side to
be right or wrong.

**You do not produce numbers.** Entry, stop and targets are already computed
and are final. You cannot move them, average them, or suggest better ones. If
you think a level matters that is not in the data, say so in words — do not
invent a price for it.

## Hard rules on prices — a violation discards your entire response

1. Write every price with a dollar sign: \`$1,932.49\`.
2. Every \`$\` figure must appear in the DATA below. Rounding is fine
   (\`$1,932\` for 1,932.49). Deriving is not — no midpoints, no "around
   $1,940", no levels you reasoned your way to.
3. Percentages, R multiples, touch counts and source counts are yours to
   compute and discuss freely. They are not prices; do not prefix them with $.
4. If you want to describe a price you were not given, use words: "just above
   the upper zone", "between the two supports".

This is checked mechanically. There is no partial credit.`;
  }

  private data(input: NarrationInput): string {
    const { map, plans, regime, checklists, regimeTimeframe } = input;
    const f = (n: number) => `$${n.toFixed(n < 10 ? 4 : 2)}`;
    const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

    const lines: string[] = [`# DATA — ${map.symbol}/USDT`, ''];

    lines.push(`Spot: ${f(map.spot)}`);
    lines.push(
      `Timeframes (fixed by the method, not chosen per run): ` +
        `levels ${map.perTimeframe.map((t) => t.timeframe).join('/')}, ` +
        `Fibonacci anchor ${map.anchor?.timeframe ?? 'n/a'}, ` +
        `ATR ${map.atrTimeframe}, regime ${regimeTimeframe}`,
    );
    lines.push(`ATR (${map.atrTimeframe}): ${f(map.atr)}`);
    lines.push('');

    lines.push(`## Regime (${regimeTimeframe})`);
    lines.push(`${regime.regime}`);
    lines.push(`- ADX ${regime.metrics.adx.toFixed(1)} (+DI ${regime.metrics.pdi.toFixed(1)} / -DI ${regime.metrics.mdi.toFixed(1)})`);
    lines.push(
      `- Bollinger bandwidth ${regime.metrics.bandWidth.toFixed(2)}%` +
        (regime.metrics.bandWidthPercentile !== null
          ? ` — ${regime.metrics.bandWidthPercentile.toFixed(0)}th percentile of its own history`
          : ' — insufficient history for a percentile'),
    );
    lines.push(
      `- Bands: lower ${f(regime.metrics.bollingerBands.lower)}, ` +
        `middle ${f(regime.metrics.bollingerBands.middle)}, ` +
        `upper ${f(regime.metrics.bollingerBands.upper)}`,
    );
    lines.push('');

    if (map.anchor) {
      lines.push(
        `## Fibonacci (${map.anchor.timeframe} swing ${f(map.anchor.low)} → ${f(map.anchor.high)})`,
      );
      lines.push(
        map.fib.map((l) => `${l.ratio}: ${f(l.price)} (${l.type})`).join(' · '),
      );
      lines.push('');
    }

    lines.push(`## Confluence zones (${map.zones.length}) — nearest first`);
    if (map.zones.length === 0) {
      lines.push('None. No two independent sources agree within 0.5%.');
    } else {
      for (const z of map.zones) {
        lines.push(
          `- ${f(z.low)} – ${f(z.high)} (centre ${f(z.center)}) · ${z.type} · ` +
            `${pct(z.distancePercent)} from spot · span ${z.spanPercent.toFixed(2)}% · ` +
            `${z.sources.length} sources: ${z.sources.join(', ')}`,
        );
      }
    }
    lines.push('');

    for (const [direction, checklist] of Object.entries(checklists ?? {})) {
      if (!checklist) continue;
      lines.push(`## The five conditions (${regimeTimeframe}, read for the ${direction})`);
      lines.push(`${checklist.conditionsMet} of 5 met.`);
      for (const c of checklist.conditions) {
        lines.push(`- ${c.name}: ${c.passed ? 'MET' : 'not met'} — ${c.value ?? ''} · ${c.reason}`);
      }
      lines.push('');
    }

    lines.push('## Plans — computed, final, not yours to change');
    if (plans.length === 0) {
      lines.push('No zone sits clear of spot on either side, so there is nothing to plan against.');
    }
    for (const p of plans) {
      lines.push('');
      lines.push(
        `### ${p.direction.toUpperCase()} — ${p.state} (${pct(p.distanceToZonePercent)} to the zone's near edge)`,
      );
      lines.push(`Zone ${f(p.zone.low)} – ${f(p.zone.high)}: ${p.zone.sources.join(', ')}`);
      lines.push(
        `Entries: ` +
          p.entries.map((e) => `${e.weightPercent}% at ${f(e.price)}`).join(', '),
      );
      lines.push(
        `Average entry ${f(p.averageEntry)} · stop ${f(p.stop)} ` +
          `(zone ${p.direction === 'long' ? 'low minus' : 'high plus'} 1×ATR) · ` +
          `risk ${p.riskPercent.toFixed(2)}% of entry · 1R = ${f(p.riskPerUnit)}`,
      );
      if (p.targets.length === 0) {
        lines.push('Targets: none — no further zone in that direction.');
      } else {
        lines.push(
          `Targets: ` +
            p.targets
              .map(
                (t, i) =>
                  `TP${i + 1} ${f(t.price)} (${t.weightPercent}%, ${t.rMultiple.toFixed(2)}R, at: ${t.source})`,
              )
              .join(' · '),
        );
        lines.push(`Blended R across the ladder: ${p.blendedR.toFixed(2)}R`);
      }
      lines.push(`Trigger: ${p.comeBackWhen}`);
    }

    return lines.join('\n');
  }

  private task(): string {
    return `# HOW TO WRITE

**Short sentences.** Most under twenty words. One idea per sentence.

**Common words.** "Agree" not "converge". "Break" not "give way". "Move" not
"excursion". If a shorter everyday word exists, it is the right word.

**No idioms, no figures of speech.** Not "dead cat bounce", not "knife
catching", not "the bulls are in control". These cost a non-native reader real
effort and add nothing.

**Explain every trading word the first time you use it**, in half a sentence,
then use it normally afterwards. Like this:

> Price is close to a support zone — a price area where buyers have stepped in
> before, so falls often slow down there.

> The stop is $8.23. A stop is the price where you accept the idea was wrong
> and close the trade.

Never define the same word twice. Never write a glossary section. Never define
a word you did not need.

**Do not talk down.** Explaining a word once is a courtesy. Repeating that
trading is risky in every paragraph is not. Write to an intelligent adult who
happens to be new to this subject.

# WHAT TO WRITE

Plain prose under short, plain headings. No JSON, no tables, no bullet list
that just repeats the numbers back. They have the numbers on screen already.

Open with **two or three sentences, in the simplest words you can manage,
saying what this analysis amounts to.** If someone read only that opening,
they should know whether anything is worth their attention right now. Then:

**1. Where the price is, and which prices matter.** What levels did the tool
find near the current price, and why does it treat them as important? The
honest reason is that several independent methods pointed at the same price —
explain what those methods are in a few words each. A wide zone and a tight
zone are not equally useful; say which this is.

**2. What kind of market this is right now.** Explain the regime in plain
words — is the price mostly drifting sideways, moving in one clear direction,
or unusually quiet and coiled? Say what that implies for the levels. If the
regime and the levels disagree, say so plainly instead of averaging them.

**3. What the plan would actually mean in practice.** For each side: what
would have to happen for it to start, at what price, where the exit-if-wrong
sits, and how much you would gain compared with what you risk. Explain that
comparison as a ratio in plain words. If the reward does not justify the risk,
say so directly — a clear "this one is not worth taking, because X" is more
useful than a balanced summary.

**4. What to watch next.** The specific thing that would change this reading.
Use the trigger prices already given.

**5. The weakest part of this reading.** Not a general disclaimer. The
specific thing most likely to make THIS analysis wrong — too few sources
agreeing, a level that is old, timeframes that disagree, a zone too wide to
enter cleanly.

Length: 450–650 words. Longer than a summary because you are teaching as you
go, but every sentence must earn its place. If the honest answer is "neither
side is worth taking, and here is why", write that — a confident no is worth
more than a hedged maybe.`;
  }
}
