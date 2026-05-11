import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MarketData, TradeAnalysisResult, TradeAction } from '../types/analysis.types';

@Injectable()
export class ClaudeService {
  private readonly client: Anthropic;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Analyze market data and return trade suggestion
   * @param marketData - Market data including price, indicators, and candles
   * @returns Trade analysis result with entry, exits, and reasoning
   */
  async analyzeMarket(marketData: MarketData): Promise<TradeAnalysisResult> {
    const prompt = this.buildPrompt(marketData);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      return this.parseClaudeResponse(textContent.text, marketData);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Claude API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Build the analysis prompt for Claude
   */
  private buildPrompt(marketData: MarketData): string {
    const { coin, timeframe, currentPrice, indicators } = marketData;
    const { rsi, bollingerBands, atr, support, resistance } = indicators;

    return `You are a professional crypto trading analyst. Analyze the following market data and provide a trade recommendation.

MARKET DATA:
- Coin: ${coin}USDT
- Timeframe: ${timeframe}
- Current Price: $${currentPrice.toFixed(2)}

TECHNICAL INDICATORS:
- RSI(14): ${rsi.toFixed(2)}
- Bollinger Bands(20,2):
  - Upper: $${bollingerBands.upper.toFixed(2)}
  - Middle: $${bollingerBands.middle.toFixed(2)}
  - Lower: $${bollingerBands.lower.toFixed(2)}
- ATR(14): $${atr.toFixed(2)}
- Support Level: $${support?.toFixed(2) ?? 'N/A'}
- Resistance Level: $${resistance?.toFixed(2) ?? 'N/A'}

TRADING STRATEGY RULES:
1. Entry Conditions (need 3 out of 5):
   - RSI oversold (<30) for LONG or overbought (>70) for SHORT
   - Price at or near support (for LONG) or resistance (for SHORT)
   - Bullish/bearish market structure
   - Volume confirmation
   - Price at Bollinger Band lower (LONG) or upper (SHORT)

2. Exit Strategy (level-to-level):
   - TP1: First resistance/support level (take 33% profit)
   - TP2: Second resistance/support level (take 33% profit)
   - TP3: Third resistance/support level (take 34% profit)

3. Stop Loss:
   - For LONG: Support - ATR
   - For SHORT: Resistance + ATR

4. Leverage:
   - Swing trades (4h+): 2-3x
   - Day trades (1h or less): 5-10x

RESPOND IN THIS EXACT JSON FORMAT:
{
  "action": "LONG" | "SHORT" | "WAIT",
  "entryPrice": <number>,
  "tp1": <number>,
  "tp2": <number>,
  "tp3": <number>,
  "stopLoss": <number>,
  "leverage": <number>,
  "reasoning": "<brief explanation>",
  "conditionsMet": ["<condition1>", "<condition2>", ...]
}

If conditions are not favorable, use action "WAIT" with entryPrice, tp1, tp2, tp3, stopLoss as 0, leverage as 1, and explain in reasoning.

Analyze and respond with only the JSON object, no additional text.`;
  }

  /**
   * Parse Claude's response into structured TradeAnalysisResult
   */
  private parseClaudeResponse(
    response: string,
    marketData: MarketData,
  ): TradeAnalysisResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and sanitize the response
      const action = this.validateAction(parsed.action);
      
      return {
        action,
        entryPrice: this.parseNumber(parsed.entryPrice, marketData.currentPrice),
        tp1: this.parseNumber(parsed.tp1, 0),
        tp2: this.parseNumber(parsed.tp2, 0),
        tp3: this.parseNumber(parsed.tp3, 0),
        stopLoss: this.parseNumber(parsed.stopLoss, 0),
        leverage: this.parseNumber(parsed.leverage, 1),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
        conditionsMet: Array.isArray(parsed.conditionsMet)
          ? parsed.conditionsMet.map(String)
          : [],
      };
    } catch (error) {
      // Return a safe default if parsing fails
      return {
        action: 'WAIT',
        entryPrice: marketData.currentPrice,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        stopLoss: 0,
        leverage: 1,
        reasoning: `Failed to parse Claude response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        conditionsMet: [],
      };
    }
  }

  /**
   * Validate trade action
   */
  private validateAction(action: unknown): TradeAction {
    if (action === 'LONG' || action === 'SHORT' || action === 'WAIT') {
      return action;
    }
    return 'WAIT';
  }

  /**
   * Parse number from response with fallback
   */
  private parseNumber(value: unknown, fallback: number): number {
    const num = Number(value);
    return isNaN(num) ? fallback : num;
  }
}
