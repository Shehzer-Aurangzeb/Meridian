import { Injectable } from '@nestjs/common';
import {
  TimeframeAnalysis,
  HTFBiasResult,
  LTFEntryResult,
  MultiTimeframeAnalysisResult,
} from '../analysis/interfaces/multi-timeframe.types';
import { EntryChecklistResult } from '../analysis/interfaces/checklist.types';
import { SupportResistanceLevel } from '../analysis/interfaces/support-resistance.types';

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
   * Build the enhanced analysis prompt for Claude Opus
   * Encourages deep market reasoning beyond mechanical rule-following
   */
  buildAnalysisPrompt(data: PromptData): string {
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

  private buildStrategyRules(): string {
    return `
=== MIRAJ'S STRATEGY RULES ===

Core Principles:
1. DDE (Data Determines Everything) - All decisions based on data, not emotions
2. HTF determines bias, LTF determines entry
3. Minimum 3/5 entry conditions must be met (60+ points)
4. Risk 1-2% per trade maximum
5. Use ATR-based stop loss (Support/Resistance ± ATR)
6. Take profits at 3 levels: TP1 (20%), TP2 (30%), TP3 (50%)

Entry Conditions (20 points each):
1. RSI: Oversold (15-35) for LONG, Overbought (65-85) for SHORT
2. QQE: Green bars for LONG, Red bars for SHORT
3. Bollinger Bands: At extreme + bands expanded (not squeezed)
4. Market Structure: HH/HL for LONG, LH/LL for SHORT
5. Support/Resistance: At level within 2%, strength ≥ 3

Trade Signals:
- LONG: Bullish HTF + 3+ bullish LTF conditions met
- SHORT: Bearish HTF + 3+ bearish LTF conditions met
- WAIT: < 3 conditions OR conflicting signals OR squeezed bands
`;
  }

  private buildMarketData(data: PromptData): string {
    return `
=== MARKET DATA ===

Coin: ${data.coin}USDT
Current Price: $${data.currentPrice.toFixed(2)}
Timestamp: ${new Date().toISOString()}
`;
  }

  private buildChecklistSection(checklist: EntryChecklistResult): string {
    return `
=== 5-POINT ENTRY CHECKLIST ===

Total Score: ${checklist.totalScore}/100 (${checklist.conditionsMet}/5 conditions met)
Trade Type: ${checklist.tradeType.toUpperCase()}
Status: ${checklist.passed ? '✅ PASSED' : '❌ FAILED'} (need 60+ points)

1. RSI Condition [${checklist.rsi.score}/20]:
   ${checklist.rsi.passed ? '✅' : '❌'} ${checklist.rsi.reason}
   ${checklist.rsi.value !== undefined ? `   Value: ${checklist.rsi.value}` : ''}

2. QQE Volume Bars [${checklist.qqe.score}/20]:
   ${checklist.qqe.passed ? '✅' : '❌'} ${checklist.qqe.reason}

3. Bollinger Band Extreme [${checklist.bollingerBand.score}/20]:
   ${checklist.bollingerBand.passed ? '✅' : '❌'} ${checklist.bollingerBand.reason}

4. Market Structure [${checklist.marketStructure.score}/20]:
   ${checklist.marketStructure.passed ? '✅' : '❌'} ${checklist.marketStructure.reason}

5. Support/Resistance [${checklist.supportResistance.score}/20]:
   ${checklist.supportResistance.passed ? '✅' : '❌'} ${checklist.supportResistance.reason}
`;
  }

  private buildTimeframeSection(analysis: MultiTimeframeAnalysisResult): string {
    const { htfBias, ltfEntry, timeframeAnalysis } = analysis;

    return `
=== TIMEFRAME ANALYSIS ===

HTF Bias (Higher Timeframes):
- Bias: ${htfBias.bias.toUpperCase()}
- Confidence: ${htfBias.confidence}%
- Reasoning: ${htfBias.reasoning.join('; ')}
- Aligned Timeframes: ${htfBias.alignedTimeframes.join(', ') || 'None'}
- Conflicting Timeframes: ${htfBias.conflictingTimeframes.join(', ') || 'None'}

LTF Entry Signal (Lower Timeframes):
- Has Entry: ${ltfEntry.hasEntry ? 'YES' : 'NO'}
- Signal: ${ltfEntry.signal.toUpperCase().replace(/_/g, ' ')}
- Timeframe: ${ltfEntry.timeframe || 'N/A'}
- Reasons: ${ltfEntry.reasons.join('; ') || 'N/A'}
${ltfEntry.entryZone ? `- Entry Zone: $${ltfEntry.entryZone.low.toFixed(2)} - $${ltfEntry.entryZone.high.toFixed(2)}` : ''}
${ltfEntry.suggestedStopLoss ? `- Suggested Stop Loss: $${ltfEntry.suggestedStopLoss.toFixed(2)}` : ''}
${ltfEntry.riskRewardRatio ? `- Risk/Reward: ${ltfEntry.riskRewardRatio.toFixed(2)}:1` : ''}

Individual Timeframes:
${timeframeAnalysis
  .map(
    (tf) => `
${tf.timeframe.toUpperCase()}:
  - Bias: ${tf.bias}
  - Confidence: ${tf.confidence}%
  - Structure: ${tf.marketStructure.pattern}
  - RSI: ${tf.indicators.rsi.toFixed(2)}
  - ATR: $${tf.indicators.atr.toFixed(2)}
  - Price vs BB: ${this.describeBBPosition(tf.currentPrice, tf.indicators.bollingerBands)}
  - BB Width: ${this.calculateBandWidth(tf.indicators.bollingerBands).toFixed(2)}%
`,
  )
  .join('')}
`;
  }

  private buildSRSection(
    levels: SupportResistanceLevel[],
    currentPrice: number,
  ): string {
    const support = levels
      .filter((l) => l.type === 'support' && l.price < currentPrice)
      .sort((a, b) => b.price - a.price) // Closest first
      .slice(0, 3);

    const resistance = levels
      .filter((l) => l.type === 'resistance' && l.price > currentPrice)
      .sort((a, b) => a.price - b.price) // Closest first
      .slice(0, 3);

    return `
=== SUPPORT & RESISTANCE LEVELS ===

Support Levels (below current price):
${
  support
    .map(
      (l) =>
        `  - $${l.price.toFixed(2)} (strength: ${l.strength}/5, ${l.distancePercent.toFixed(1)}% away, ${l.touchCount} touches)`,
    )
    .join('\n') || '  - None nearby'
}

Resistance Levels (above current price):
${
  resistance
    .map(
      (l) =>
        `  - $${l.price.toFixed(2)} (strength: ${l.strength}/5, ${l.distancePercent.toFixed(1)}% away, ${l.touchCount} touches)`,
    )
    .join('\n') || '  - None nearby'
}
`;
  }

  private buildTaskInstructions(): string {
    return `
=== YOUR TASK ===

Based on the checklist and timeframe analysis above:

1. Determine the final action: LONG, SHORT, or WAIT
   - LONG: Bullish HTF + checklist passed (60+ points)
   - SHORT: Bearish HTF + checklist passed (60+ points)
   - WAIT: If checklist failed OR conflicting signals

2. If LONG or SHORT, calculate:
   - Entry Price: Use current price or nearest S/R level
   - Stop Loss: Use ATR method: S/R level ± ATR value
   - Take Profit Levels:
     * TP1: Conservative target (3-5% gain)
     * TP2: Mid-range target (7-10% gain)
     * TP3: Optimistic target (12-15% gain)
   - Leverage: Based on timeframe and confidence
     * Daily/12h: 2-3x (swing trade)
     * 4h/1h: 5-7x (day trade)
     * 15m: 10-12x (scalp)
   - Risk/Reward Ratio

3. Provide reasoning explaining:
   - Why this action aligns with Miraj's strategy
   - Which specific conditions support the decision
   - What timeframe confluence exists
   - Key levels to watch

4. Add warnings if:
   - Conflicting timeframes
   - Low confidence setup
   - High volatility (wide ATR)
   - Approaching major resistance/support

IMPORTANT:
- Be conservative - better to WAIT than force a trade
- If < 3 conditions met, recommend WAIT (explain why)
- If HTF and LTF conflict, recommend WAIT
- If Bollinger Bands squeezed, recommend WAIT (breakout pending)
`;
  }

  private buildOutputFormat(): string {
    return `
=== OUTPUT FORMAT ===

Respond in JSON format ONLY. No markdown, no backticks, just pure JSON:

{
  "action": "LONG" | "SHORT" | "WAIT",
  "confidence": 0-100,
  "entry": {
    "price": number,
    "reasoning": "string"
  },
  "stopLoss": {
    "price": number,
    "distance": "percentage string (e.g., '5.2%')",
    "method": "string (e.g., 'Support at $28,600 minus ATR $450')"
  },
  "takeProfit": {
    "tp1": { "price": number, "gain": "percentage string" },
    "tp2": { "price": number, "gain": "percentage string" },
    "tp3": { "price": number, "gain": "percentage string" }
  },
  "leverage": {
    "recommended": number,
    "rationale": "string"
  },
  "riskReward": number,
  "summary": "string (2-3 sentences explaining the trade)",
  "reasoning": {
    "checklistAnalysis": "string (which conditions passed/failed)",
    "timeframeConfluence": "string (HTF + LTF alignment)",
    "keyLevels": "string (S/R considerations)",
    "risks": "string (what could invalidate this trade)"
  },
  "warnings": ["string array of any warnings"],
  "conditionsMet": "X/5 format string"
}

If action is WAIT, omit entry/stopLoss/takeProfit/leverage fields and explain why in summary.
`;
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
