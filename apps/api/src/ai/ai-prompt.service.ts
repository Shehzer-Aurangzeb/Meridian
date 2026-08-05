import { Injectable } from '@nestjs/common';
import {
  TimeframeAnalysis,
  HTFBiasResult,
  LTFEntryResult,
  MultiTimeframeAnalysisResult,
} from '../analysis/interfaces/multi-timeframe.types';
import {
  EntryChecklistResult,
  ChecklistStatus,
  ChecklistCondition,
} from '../analysis/interfaces/checklist.types';
import { SupportResistanceLevel } from '../analysis/interfaces/support-resistance.types';
import { CoordinatorAnalysisResult } from '../analysis-coordinator/interfaces/coordinator.types';
import { SqueezeBreakoutSetup } from '../squeeze-breakout/interfaces/squeeze-breakout.types';
import { MarketRegimeResult } from '../market-regime/interfaces/market-regime.types';

/**
 * @deprecated Legacy prompt input retained for backwards compatibility while
 * call sites are migrated to the unified {@link CoordinatorAnalysisResult}
 * contract. New code MUST pass a `CoordinatorAnalysisResult` instead.
 */
export interface PromptData {
  coin: string;
  currentPrice: number;
  multiTimeframeAnalysis: MultiTimeframeAnalysisResult;
  checklist: EntryChecklistResult;
  srLevels: SupportResistanceLevel[];
}

@Injectable()
export class ClaudePromptService {
  /**
   * Build a Claude Opus analysis prompt.
   *
   * Primary contract (new): consumes the unified `CoordinatorAnalysisResult`
   * emitted by the `AnalysisCoordinatorService`. The prompt dynamically
   * pivots its core instructions based on `strategyRoute`:
   *
   *  - `SQUEEZE_BREAKOUT`     → volatility-compression playbook (trigger
   *                              prices, volume confirmation, fakeout watch).
   *  - `CONFLUENCE_CHECKLIST` → tiered confluence playbook (WATCHING …
   *                              APEX_SETUP, partial-credit Z-scores).
   *
   * Legacy contract (deprecated): consumes a `PromptData` payload from the
   * pre-coordinator pipeline. Routes to the legacy template unchanged.
   */
  buildAnalysisPrompt(coordinatorResult: CoordinatorAnalysisResult): string;
  buildAnalysisPrompt(data: PromptData): string;
  buildAnalysisPrompt(
    input: CoordinatorAnalysisResult | PromptData,
  ): string {
    if (this.isCoordinatorResult(input)) {
      return this.buildCoordinatorPrompt(input);
    }
    return this.buildLegacyPrompt(input);
  }

  private isCoordinatorResult(
    input: CoordinatorAnalysisResult | PromptData,
  ): input is CoordinatorAnalysisResult {
    return (
      typeof (input as CoordinatorAnalysisResult).strategyRoute === 'string' &&
      'regimeResult' in input
    );
  }

  // ════════════════════════════════════════════════════════════════════
  //  COORDINATOR-DRIVEN PROMPT (primary)
  // ════════════════════════════════════════════════════════════════════

  private buildCoordinatorPrompt(r: CoordinatorAnalysisResult): string {
    const role = this.buildRole();
    const context = this.buildCoordinatorContext(r);
    const strategyBlock =
      r.strategyRoute === 'SQUEEZE_BREAKOUT'
        ? this.buildSqueezeBreakoutInstructions(
            r.squeezeSetup,
            r.regimeResult,
          )
        : this.buildConfluenceChecklistInstructions(
            r.checklistResult,
            r.regimeResult,
          );
    const task = this.buildCoordinatorTask(r);
    const output = this.buildCoordinatorOutputSchema();

    return [role, context, strategyBlock, task, output]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildRole(): string {
    return `# ROLE
You are an elite crypto trading analyst executing a two-strategy framework driven by a market-regime classifier:

  • SQUEEZE_BREAKOUT     — for assets in a volatility-compression phase.
  • CONFLUENCE_CHECKLIST — for assets in a directional or mean-reverting regime.

The upstream coordinator has already classified the regime and selected the
strategy. Your job is NOT to reclassify it. Your job is to apply the correct
playbook with deep market reasoning, then return a structured trade decision.`;
  }

  private buildCoordinatorContext(r: CoordinatorAnalysisResult): string {
    const m = r.regimeResult.metrics;
    const bw =
      m.bandWidthPercentile !== null
        ? `${m.bandWidth.toFixed(2)}% (percentile ${m.bandWidthPercentile.toFixed(0)}, threshold ${m.bandWidthThreshold.toFixed(2)}%)`
        : `${m.bandWidth.toFixed(2)}% (threshold ${m.bandWidthThreshold.toFixed(2)}%)`;

    return `# MARKET CONTEXT

- Symbol:        ${r.symbol}
- Timeframe:     ${r.timeframe}
- Regime:        ${r.regimeResult.regime}
- Strategy:      ${r.strategyRoute}
- Coordinator:   ${r.reasoning}
- Analysis Time: ${new Date().toISOString()}

## Regime Metrics
- ADX:        ${m.adx.toFixed(2)}  (+DI ${m.pdi.toFixed(2)} / -DI ${m.mdi.toFixed(2)})
- RSI:        ${m.rsi.toFixed(2)}
- ATR:        ${m.atr.toFixed(4)}
- BB Width:   ${bw}
- Regime Reason: ${r.regimeResult.reason}`;
  }

  // ──────────────────────────────────────────────────────────────────
  //  SQUEEZE_BREAKOUT branch
  // ──────────────────────────────────────────────────────────────────

  private buildSqueezeBreakoutInstructions(
    setup: SqueezeBreakoutSetup | null,
    regime: MarketRegimeResult,
  ): string {
    if (!setup) {
      return `# STRATEGY: SQUEEZE_BREAKOUT

The coordinator routed this asset to SQUEEZE_BREAKOUT but the upstream
service produced no setup payload. Return action=WAIT and explain that
the compression has not yet produced actionable trigger levels.`;
    }

    const upper = setup.upperTriggerPrice;
    const lower = setup.lowerTriggerPrice;
    const range = upper - lower;
    const rangePct =
      lower > 0 ? ((range / lower) * 100).toFixed(2) : 'n/a';

    return `# STRATEGY: SQUEEZE_BREAKOUT  (volatility compression release)

This asset is in a high-density volatility COMPRESSION phase. Directional
bias is unknown — do NOT predict direction. Your task is to validate the
upcoming breakout using the exact bounds and volume baseline below.

## Compression Bounds (the "line in the sand")
- Upper Trigger:    $${this.fmtPrice(upper)}   (a CLOSE above ⇒ LONG signal)
- Lower Trigger:    $${this.fmtPrice(lower)}   (a CLOSE below ⇒ SHORT signal)
- Range:            $${this.fmtPrice(range)}  (${rangePct}% of lower trigger)
- Lookback Window:  ${setup.lookback} candles on ${setup.timeframe}
- Volume Baseline:  ${this.fmtVolume(setup.volumeBaseline)} (SMA over lookback)
- Volume Confirm:   ≥ ${setup.volumeMultiplier.toFixed(2)}× baseline on breakout candle
- Current BB Width: ${regime.metrics.bandWidth.toFixed(2)}% (compressed)

## Entry Rules (from upstream)
${setup.entryConditions}

## Reasoning You MUST Perform
1. **Has a trigger fired?**  Compare the most recent close to the upper/lower
   triggers. Only declare LONG/SHORT if a close has breached a trigger.
2. **Volume validation.**    A breakout without ≥${setup.volumeMultiplier.toFixed(2)}× the volume
   baseline is a likely fakeout — downgrade confidence aggressively or WAIT.
3. **Fakeout watch.**        Wicks that pierce but fail to close beyond the
   trigger are traps. Penalise wick-only breaks.
4. **Compression release quality.** Wider compression (lower BB width
   percentile) tends to produce more sustained moves — factor this into
   confidence and leverage sizing.
5. **Invalidation.**          A LONG breakout that re-enters the range
   invalidates the setup; same for SHORT. Place stops just inside the range
   (e.g. lower trigger for LONG, upper trigger for SHORT) ± ATR buffer.`;
  }

  // ──────────────────────────────────────────────────────────────────
  //  CONFLUENCE_CHECKLIST branch
  // ──────────────────────────────────────────────────────────────────

  private buildConfluenceChecklistInstructions(
    checklist: EntryChecklistResult | null,
    regime: MarketRegimeResult,
  ): string {
    if (!checklist) {
      return `# STRATEGY: CONFLUENCE_CHECKLIST

The coordinator routed this asset to CONFLUENCE_CHECKLIST but the upstream
service produced no checklist payload. Return action=WAIT.`;
    }

    const tierGuide = this.describeChecklistTier(checklist.status);
    const conditions = [
      checklist.rsi,
      checklist.qqe,
      checklist.bollingerBand,
      checklist.marketStructure,
      checklist.supportResistance,
    ]
      .map((c, i) => this.formatChecklistCondition(c, i + 1))
      .join('\n');

    return `# STRATEGY: CONFLUENCE_CHECKLIST  (tiered 5-point confluence)

This asset is in a ${regime.regime} regime. Trade direction bias: **${checklist.tradeType.toUpperCase()}**.

The upstream checklist uses a tiered scoring system with DYNAMIC relative
thresholds (Z-scores against the asset's own recent history) and partial
credit at support/resistance — it is NOT a binary 60+ gate.

## Tier Result
- Total Score:      ${checklist.totalScore}/100
- Conditions Met:   ${checklist.conditionsMet}/5
- **Status:        ${checklist.status}** — ${tierGuide}
- Tradeable Gate:   ${checklist.passed ? 'YES' : 'NO'} (${checklist.conditionsMet}/5 conditions, needs 3)

## Per-Condition Breakdown (each scored 0–20 with partial credit)
${conditions}

## Reasoning You MUST Perform
1. **Respect the tier.**  Treat status as the dominant signal — not raw score.
     • WATCHING        → almost always WAIT (no conviction).
     • TACTICAL_SETUP  → small-size, low-leverage, only if confluence story is coherent.
     • STRATEGIC_TRADE → standard sizing, normal leverage.
     • APEX_SETUP      → high-conviction, may justify larger leverage.
2. **Read Z-scores, not absolutes.**  An RSI condition that scored 18/20 at
   an RSI of 42 indicates an unusually oversold reading FOR THIS ASSET. Do
   not override the dynamic threshold with a static 30/70 mental model.
3. **Partial-credit S/R.**  A supportResistance score of 12/20 means the
   level is close but not perfectly aligned (e.g. weaker strength, slightly
   further than 2%). Weight stop placement and confidence accordingly.
4. **Regime coherence.**  Long setups in MEAN_REVERSION regimes target the
   mid-band; long setups in TRENDING regimes target continuation. Reject
   setups that fight the regime without an exceptional reason.
5. **Invalidation.**  The strongest failed condition usually defines the
   invalidation point — use it for stop-loss reasoning.`;
  }

  private formatChecklistCondition(
    c: ChecklistCondition,
    idx: number,
  ): string {
    const mark = c.passed ? '✓' : '✗';
    const valueStr =
      c.value !== undefined ? ` | value=${String(c.value)}` : '';
    const thresholdStr = c.threshold ? ` | threshold=${c.threshold}` : '';
    return `  ${idx}. [${mark}] ${c.name}  (${c.score}/20)${valueStr}${thresholdStr}
        ${c.reason}`;
  }

  private describeChecklistTier(status: ChecklistStatus): string {
    switch (status) {
      case 'WATCHING':
        return 'no actionable confluence; default to WAIT.';
      case 'TACTICAL_SETUP':
        return 'early confluence forming; trade only with strong narrative, reduced size.';
      case 'STRATEGIC_TRADE':
        return 'multi-factor confluence aligned; standard execution.';
      case 'APEX_SETUP':
        return 'rare full-stack alignment; high-conviction setup, scale leverage prudently.';
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Task + output schema (shared)
  // ──────────────────────────────────────────────────────────────────

  private buildCoordinatorTask(r: CoordinatorAnalysisResult): string {
    const defaultAction =
      r.strategyRoute === 'CONFLUENCE_CHECKLIST' &&
      r.checklistResult?.status === 'WATCHING'
        ? 'WAIT'
        : 'LONG | SHORT | WAIT';

    return `# YOUR TASK

1. Apply the playbook above with deep market reasoning. Do NOT mechanically
   restate the inputs — synthesise them.
2. Choose ONE final action: **${defaultAction}**.
3. If LONG or SHORT, produce a complete trade plan: entry, stop-loss
   (method must be explicit), 3-tier take profit, leverage rationale, and
   weighted risk/reward.
4. If WAIT, return the lightweight WAIT schema and explain precisely WHY
   staying sidelined is correct in this regime + strategy context.
5. Be honest about uncertainty. Capital preservation > forced trades.`;
  }

  private buildCoordinatorOutputSchema(): string {
    return `# OUTPUT FORMAT  (return ONLY valid JSON — no markdown, no prose, no backticks)

## Schema A — when action is LONG or SHORT
{
  "action": "LONG" | "SHORT",
  "confidence": <0-100>,
  "entry": {
    "price": <number>,
    "reasoning": "<why this exact entry — reference triggers / S-R / tier>"
  },
  "stopLoss": {
    "price": <number>,
    "distance": "<percentage e.g. '1.85%'>",
    "method": "<explicit method e.g. 'lower trigger $X − 0.5×ATR' or 'support $X − ATR'>"
  },
  "takeProfit": {
    "tp1": { "price": <number>, "gain": "<percentage>" },
    "tp2": { "price": <number>, "gain": "<percentage>" },
    "tp3": { "price": <number>, "gain": "<percentage>" }
  },
  "leverage": {
    "recommended": <1-20>,
    "rationale": "<tie to timeframe, volatility, tier/compression quality>"
  },
  "riskReward": <number — weighted R:R across TP1/TP2/TP3>,
  "summary": "<1-2 sentence thesis>",
  "reasoning": {
    "strategyAnalysis": "<how the active playbook applies here>",
    "regimeContext": "<why the regime supports this action>",
    "keyLevels": "<triggers / S-R that matter>",
    "invalidation": "<what flips this idea>",
    "risks": "<what could go wrong>"
  },
  "warnings": ["<array of caution points, may be empty>"]
}

## Schema B — when action is WAIT  (lightweight, NO entry/stopLoss/takeProfit/leverage/riskReward)
{
  "action": "WAIT",
  "confidence": <0-100 — how clearly this is NOT a trade>,
  "summary": "<one sentence: why sitting out is correct>",
  "reasoning": {
    "strategyAnalysis": "<what the active playbook says is missing>",
    "regimeContext": "<why the regime is not actionable now>",
    "keyLevels": "<which triggers / levels would change the decision>"
  },
  "warnings": ["<specific reasons to avoid trading right now>"]
}

Return ONLY the JSON object. No surrounding text.`;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Small formatting helpers
  // ──────────────────────────────────────────────────────────────────

  private fmtPrice(n: number): string {
    if (!Number.isFinite(n)) return 'n/a';
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
    return n.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  private fmtVolume(n: number): string {
    if (!Number.isFinite(n)) return 'n/a';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toFixed(2);
  }

  // ════════════════════════════════════════════════════════════════════
  //  LEGACY PROMPT (PromptData) — kept verbatim for backwards compatibility
  // ════════════════════════════════════════════════════════════════════

  /**
   * @deprecated Use the `CoordinatorAnalysisResult` overload. This path is
   * retained only while existing call sites (AiService, AnalysisController)
   * are migrated to the unified coordinator contract.
   */
  private buildLegacyPrompt(data: PromptData): string {
    const { coin, currentPrice, multiTimeframeAnalysis, checklist, srLevels } = data;
    const { htfBias, ltfEntry, timeframeAnalysis } = multiTimeframeAnalysis;

    // Get support and resistance levels
    const supportLevels = srLevels
      .filter((l) => l.type === 'support' && l.price < currentPrice)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);
    
    const resistanceLevels = srLevels
      .filter((l) => l.type === 'resistance' && l.price > currentPrice)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3);

    return `# ROLE
You are an elite crypto trading analyst. You use Miraj's proven 5-point strategy as your analytical framework, but you apply deep market expertise, contextual reasoning, and intelligent synthesis to provide actionable insights.

Your goal: Make traders MORE intelligent by explaining market dynamics, not just reporting indicator values.

═══════════════════════════════════════════════════════════════

# MIRAJ'S 5-POINT STRATEGY (Your Framework)

This is your foundation. Follow these rules, but THINK about what they mean:

## 1. RSI Condition (20 points)
- **LONG**: RSI between 15-35 (oversold)
- **SHORT**: RSI between 65-85 (overbought)
- **Context matters**: RSI 30 in a downtrend vs uptrend means different things

## 2. QQE Volume Bars (20 points)
- **LONG**: Green QQE bars (momentum building)
- **SHORT**: Red QQE bars (momentum weakening)
- **Volume context**: Are volume bars confirming or diverging from price?

## 3. Bollinger Band Extreme (20 points)
- **LONG**: Price at lower band AND bands expanded (not squeezed)
- **SHORT**: Price at upper band AND bands expanded
- **Critical**: BB squeeze (width <2%) = WAIT (pending breakout)
- **Think**: Is this a reversal point or continuation?

## 4. Market Structure (20 points)
- **LONG**: Higher Highs + Higher Lows (HH/HL) on HTF
- **SHORT**: Lower Highs + Lower Lows (LH/LL) on HTF
- **Trend quality**: Strong consistent structure vs choppy weak structure?

## 5. Support/Resistance Confluence (20 points)
- **LONG**: Price within 2% of support with strength ≥3
- **SHORT**: Price within 2% of resistance with strength ≥3
- **Level quality**: How many touches? How recent? How clean?

**SCORING**: Need 60+ points (3/5 conditions) to trade. 80+ = high confidence.

═══════════════════════════════════════════════════════════════

# CURRENT MARKET DATA

## Basic Info
- **Coin**: ${coin}USDT
- **Current Price**: $${currentPrice.toLocaleString()}
- **Analysis Time**: ${new Date().toISOString()}

## 5-Point Checklist Results
**Total Score**: ${checklist.totalScore}/100 (${checklist.conditionsMet}/5 conditions met)
**Trade Type**: ${checklist.tradeType.toUpperCase()}
**Status**: ${checklist.passed ? '✅ PASSED' : '❌ FAILED'} (need 60+ points)

1. **RSI**: ${checklist.rsi.passed ? '✓ PASS' : '✗ FAIL'} (${checklist.rsi.score}/20 points)
   ${checklist.rsi.reason}${checklist.rsi.value !== undefined ? ` | Value: ${checklist.rsi.value}` : ''}

2. **QQE**: ${checklist.qqe.passed ? '✓ PASS' : '✗ FAIL'} (${checklist.qqe.score}/20 points)
   ${checklist.qqe.reason}

3. **Bollinger Bands**: ${checklist.bollingerBand.passed ? '✓ PASS' : '✗ FAIL'} (${checklist.bollingerBand.score}/20 points)
   ${checklist.bollingerBand.reason}

4. **Market Structure**: ${checklist.marketStructure.passed ? '✓ PASS' : '✗ FAIL'} (${checklist.marketStructure.score}/20 points)
   ${checklist.marketStructure.reason}

5. **Support/Resistance**: ${checklist.supportResistance.passed ? '✓ PASS' : '✗ FAIL'} (${checklist.supportResistance.score}/20 points)
   ${checklist.supportResistance.reason}

## Multi-Timeframe Analysis

### Higher Timeframe Bias (Trend Direction)
- **Bias**: ${htfBias.bias.toUpperCase()} (${htfBias.confidence}% confidence)
- **Reasoning**: ${htfBias.reasoning.join('; ')}
- **Aligned Timeframes**: ${htfBias.alignedTimeframes.join(', ') || 'None'}
- **Conflicting Timeframes**: ${htfBias.conflictingTimeframes.join(', ') || 'None'}

### Lower Timeframe Entry Signal
- **Has Entry**: ${ltfEntry.hasEntry ? 'YES' : 'NO'}
- **Signal**: ${ltfEntry.signal.toUpperCase().replace(/_/g, ' ')}
- **Timeframe**: ${ltfEntry.timeframe || 'N/A'}
- **Reasons**: ${ltfEntry.reasons.join('; ') || 'N/A'}
${ltfEntry.entryZone ? `- **Entry Zone**: $${ltfEntry.entryZone.low.toFixed(2)} - $${ltfEntry.entryZone.high.toFixed(2)}` : ''}
${ltfEntry.suggestedStopLoss ? `- **Suggested Stop Loss**: $${ltfEntry.suggestedStopLoss.toFixed(2)}` : ''}
${ltfEntry.riskRewardRatio ? `- **Risk/Reward**: ${ltfEntry.riskRewardRatio.toFixed(2)}:1` : ''}

### Detailed Timeframe Breakdown
${timeframeAnalysis.map(tf => `
**${tf.timeframe.toUpperCase()} Timeframe**:
- Bias: ${tf.bias} (${tf.confidence}% confidence)
- RSI: ${tf.indicators.rsi.toFixed(2)}
- BB Width: ${this.calculateBandWidth(tf.indicators.bollingerBands).toFixed(2)}%
- Price vs BB: ${this.describeBBPosition(tf.currentPrice, tf.indicators.bollingerBands)}
- ATR: $${tf.indicators.atr.toFixed(2)}
- Structure: ${tf.marketStructure.pattern} (${tf.marketStructure.structure})
`).join('')}

## Key Support/Resistance Levels

### Support Levels (buy zones):
${supportLevels.map(l => 
  `- $${l.price.toLocaleString()} (strength: ${l.strength}/5, ${l.distancePercent.toFixed(2)}% away, ${l.touchCount} touches)`
).join('\n') || '- None identified nearby'}

### Resistance Levels (sell zones):
${resistanceLevels.map(l => 
  `- $${l.price.toLocaleString()} (strength: ${l.strength}/5, ${l.distancePercent.toFixed(2)}% away, ${l.touchCount} touches)`
).join('\n') || '- None identified nearby'}

═══════════════════════════════════════════════════════════════

# YOUR ANALYSIS TASK

## Step 1: Deep Reasoning (Think Before Deciding)

Analyze this market setup by considering:

### Market Context
- What phase is this market in? (accumulation, markup, distribution, markdown)
- Is this a healthy trend or exhausted move?
- Are we at a decision point (support/resistance) or in no-man's land?

### Confluence Analysis
- Do ALL timeframes agree or conflict?
- Are indicators confirming each other or diverging?
- Is there hidden confluence not captured by the checklist?

### Risk Assessment
- What could invalidate this setup?
- Where is the "point of no return"?
- Are there warning signs the checklist missed?

### Market Psychology
- What are retail traders likely thinking/doing?
- Is smart money accumulating or distributing?
- Is this a trap (false breakout) or genuine opportunity?

## Step 2: Make Your Decision

Based on your analysis:

**If checklist score < 60**: Almost always WAIT
- Exception: If you see exceptional confluence the checklist missed, explain why

**If checklist score 60-79**: Consider WAIT or cautious trade
- Only trade if you have strong conviction from your deeper analysis

**If checklist score 80+**: Strong setup, likely trade
- But still WAIT if you see red flags the checklist missed

## Step 3: Provide Trade Plan (if LONG or SHORT)

### Entry
- Exact price (current or slightly better)
- Entry reasoning beyond "checklist passed"

### Stop Loss
- Method: Support/Resistance ± ATR, or structure-based
- Exact price and distance percentage
- Why this stop makes sense

### Take Profits (3 levels)
- **TP1** (20% position): First meaningful resistance/support
- **TP2** (30% position): Second level or Fibonacci extension
- **TP3** (50% position): Major target or trend extension
- Gain percentages for each
- Reasoning for target selection

### Leverage
- Recommended leverage (1-20x)
- Rationale based on timeframe, volatility, confidence
- Risk level (conservative/moderate/aggressive)

### Risk/Reward
- Calculate R:R ratio (weighted average)
- Explain if R:R justifies the trade

═══════════════════════════════════════════════════════════════

# OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown, no extra text):

## For LONG or SHORT:
{
  "action": "LONG" | "SHORT",
  "confidence": <0-100 number>,
  "entry": {
    "price": <number>,
    "reasoning": "<why enter here, beyond checklist>"
  },
  "stopLoss": {
    "price": <number>,
    "distance": "<percentage string>",
    "method": "<how you calculated it>"
  },
  "takeProfit": {
    "tp1": { "price": <number>, "gain": "<percentage string>" },
    "tp2": { "price": <number>, "gain": "<percentage string>" },
    "tp3": { "price": <number>, "gain": "<percentage string>" }
  },
  "leverage": {
    "recommended": <1-20 number>,
    "rationale": "<why this leverage>"
  },
  "riskReward": <number (weighted average R:R)>,
  "summary": "<1-2 sentence trade thesis>",
  "reasoning": {
    "checklistAnalysis": "<what checklist shows>",
    "timeframeConfluence": "<do timeframes agree?>",
    "keyLevels": "<support/resistance context>",
    "marketContext": "<what phase/condition is market in?>",
    "risks": "<what could go wrong>"
  },
  "warnings": ["<array of caution points if any>"],
  "conditionsMet": "<X/5>"
}

## For WAIT:
{
  "action": "WAIT",
  "confidence": <0-100 number representing how clearly this is NOT a trade>,
  "summary": "<why waiting is the right decision>",
  "reasoning": {
    "checklistAnalysis": "<what failed and why>",
    "timeframeConfluence": "<conflicts or lack of alignment>",
    "keyLevels": "<are we between levels or at weak level?>",
    "marketContext": "<why current conditions aren't tradeable>"
  },
  "warnings": ["<specific reasons to avoid trading>"],
  "conditionsMet": "<X/5>"
}

═══════════════════════════════════════════════════════════════

# CRITICAL REMINDERS

1. **Think, don't just check boxes**: Explain market dynamics
2. **Context matters**: Same indicator value means different things in different contexts
3. **Be honest about uncertainty**: If it's borderline, say so
4. **Protect capital**: When in doubt, WAIT
5. **Explain your reasoning**: Make the trader understand WHY, not just WHAT

Your analysis should make a trader think: "Ah, I understand the market better now."

Begin your analysis.`;
  }

  /**
   * Helper to describe price position relative to Bollinger Bands
   */
  private describeBBPosition(
    currentPrice: number,
    bollingerBands: { upper: number; middle: number; lower: number },
  ): string {
    const { upper, middle, lower } = bollingerBands;
    const range = upper - lower;

    if (range === 0) return 'Squeezed (no range)';

    const position = ((currentPrice - lower) / range) * 100;

    if (position < 10) return 'At lower band (oversold)';
    if (position < 20) return 'Near lower band (oversold)';
    if (position > 90) return 'At upper band (overbought)';
    if (position > 80) return 'Near upper band (overbought)';
    if (position >= 45 && position <= 55) return `At middle band`;
    return `Mid-range (${position.toFixed(0)}%)`;
  }

  /**
   * Calculate Bollinger Band width as percentage
   */
  private calculateBandWidth(bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  }): number {
    const { upper, middle, lower } = bollingerBands;
    if (middle === 0) return 0;
    return ((upper - lower) / middle) * 100;
  }
}
