import { Injectable } from '@nestjs/common';
import {
  TimeframeAnalysis,
  HTFBiasResult,
  LTFEntryResult,
  MultiTimeframeAnalysisResult,
} from '../types/multi-timeframe.types';
import { EntryChecklistResult } from '../types/checklist.types';
import { SupportResistanceLevel } from '../types/support-resistance.types';

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
   * Build the complete analysis prompt for Claude
   */
  buildAnalysisPrompt(data: PromptData): string {
    return `
You are an expert crypto trader following Miraj's professional trading strategy. Analyze this market data and provide a trade recommendation.

${this.buildStrategyRules()}

${this.buildMarketData(data)}

${this.buildChecklistSection(data.checklist)}

${this.buildTimeframeSection(data.multiTimeframeAnalysis)}

${this.buildSRSection(data.srLevels, data.currentPrice)}

${this.buildTaskInstructions()}

${this.buildOutputFormat()}
`.trim();
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
