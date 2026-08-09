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
  checklist: EntryChecklistResult | null;
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
 * AnalystNarrationService
 *
 * Claude's only job here is INTERPRETATION. Every number — spot, zones,
 * entries, stop, targets, R multiples — is computed in TypeScript before this
 * runs and is immutable by the time the model sees it.
 *
 * The division is enforced, not requested. `assertProvenance` extracts every
 * `$`-prefixed figure from the response and rejects the whole narration if any
 * of them fails to trace to a computed value. A model that quietly rounds is
 * fine; a model that invents a support level at a price nothing computed is
 * not, and a warning in a log would be read by nobody.
 *
 * Superseded: `ClaudePromptService` / `ClaudeService.analyzeWithChecklist`
 * asked Claude to PRODUCE entry, stop and targets. That contract is the thing
 * this replaces — it is exactly the freedom that has to be removed.
 */
@Injectable()
export class AnalystNarrationService {
  private readonly logger = new Logger(AnalystNarrationService.name);
  private readonly model = 'claude-opus-5';
  private client?: Anthropic;

  /**
   * Built on first use, not in the constructor.
   *
   * Nest instantiates every provider at boot, so throwing here for a missing
   * key took down the WHOLE APPLICATION — including routes that never
   * narrate. On Lambda that means a cold start that dies instead of serving,
   * for a key the served routes do not need. Found by lambda.spec.ts.
   *
   * Still fails closed, just at the right moment: narration without a key is
   * impossible and says so, while everything else runs.
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

    const response = await this.anthropic().messages.create({
      model: this.model,
      // Thinking is ON by default on this model, and max_tokens caps thinking
      // PLUS response text together — a tight budget truncates mid-sentence.
      max_tokens: 16000,
      // No `temperature`: it is rejected outright (400) on this model family.
      // Wording stability comes from the prompt, not a sampling knob.
      //
      // ponytail: no server-side `fallbacks` — @anthropic-ai/sdk 0.95.2 has no
      // support for it, so the field would not be sent correctly. The refusal
      // below is handled explicitly instead. Add `fallbacks: 'default'` (beta
      // `server-side-fallback-2026-07-01`) after upgrading the SDK if a
      // declined narration should silently retry on another model.
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
   * Every price the narration is permitted to mention.
   *
   * Anything derived from these — a midpoint, an average, a level "just
   * below" — is NOT permitted. If a number is worth saying, it should have
   * been computed.
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
   * Reject the narration if it cites a price nothing computed.
   *
   * Only `$`-prefixed figures are checked, which is why the prompt requires
   * prices to be written that way: percentages, R multiples and touch counts
   * are legitimately Claude's own arithmetic over given values, and treating
   * every number as a price claim would make the check unusable.
   *
   * Rounding is allowed by comparing at the precision Claude used — "$73"
   * matches a computed 73.48, "$74" does not. That permits readable prose
   * without permitting invention.
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

You are talking to the person who owns the account. They will decide whether
to trade. They can read numbers; what they want from you is the reading a
skilled analyst would give — what the structure implies, where it is weak, and
what would change the picture.

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
    const { map, plans, regime, checklist, regimeTimeframe } = input;
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

    if (checklist) {
      lines.push(`## The five conditions (${regimeTimeframe}, read for ${checklist.tradeType})`);
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
    return `# YOUR TASK

Write the analyst's read. Plain prose and short headed sections — no JSON, no
tables, no restating the numbers back as a list. The person already has the
table; they want what it means.

Cover, in this order:

**1. What the structure says.** Where is price sitting relative to the levels
that matter? Which zones actually carry weight, and why — how many independent
sources, from which timeframes, how tight the band is? Call out an S/R flip if
one is present (a former resistance now being tested from above, or the
reverse) — the source list will show both types at one price when that happens.

**2. What the regime and the conditions add.** Does the regime reading support
the zones or sit awkwardly against them? Which of the five conditions carry
real weight here and which are technically-met-but-thin? Where the conditions
and the structure disagree, say so plainly rather than averaging them.

**3. Each side, honestly.** For the long and the short: what argues for it,
what argues against it, and what specifically would invalidate it. Compare the
blended R against the risk. If a plan's R makes it not worth taking, say that
outright — that is more useful than balance. Note that TP1 is often under 1R
because the first target is the next zone beyond spot, so judge the ladder as
a whole.

**4. What you would watch.** The concrete thing that would change the picture:
a level giving way, a condition flipping, the regime shifting. Tie it to the
trigger prices already given.

**5. The strongest caveat.** Whatever is most likely to make this reading
wrong. Not a disclaimer — the specific weakness in THIS setup. Thin sources,
a stale level, conflicting timeframes, a zone too wide to enter cleanly.

# LANGUAGE

The reader owns the account and reads numbers fine, but this tool's vocabulary
is not theirs yet. The first time you use a term of art — confluence, R
multiple, ADX, bandwidth percentile, S/R flip, blended R — give its meaning in
half a sentence and then keep using it normally. One clause, not a glossary,
and never a definition of a word you did not need in the first place.

Prefer the plain word wherever one exists: "three independent methods land on
the same price" rather than "high confluence"; "how far price typically moves
in a day" rather than "ATR". Never use a term you would have to define twice.

Do not patronise. Explaining a word once is a courtesy; hedging every sentence
is not.

Length: 350–500 words. Be direct. If the honest answer is "this is a poor
setup on both sides and the reason is X", write that — a confident no is worth
more than a hedged maybe.`;
  }
}
