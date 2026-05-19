import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MarketData, TradeAnalysisResult, TradeAction } from '../analysis/interfaces/analysis.types';
import { ClaudePromptService, PromptData } from './ai-prompt.service';
import {
  CoordinatorAnalysisResult,
  StrategyRoute,
} from '../analysis-coordinator/interfaces/coordinator.types';
import {
  ClaudeAnalysisResponse,
  ClaudeTradeAnalysis,
  ClaudeWaitAnalysis,
  ClaudeResponseValidationError,
  isTradeSignal,
} from './interfaces/claude-response.types';

@Injectable()
export class ClaudeService {
  private readonly client: Anthropic;
  private readonly model = 'claude-opus-4-7';
  private readonly logger = new Logger(ClaudeService.name);

  constructor(private readonly promptService: ClaudePromptService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Enhanced market analysis using either the new CoordinatorAnalysisResult
   * contract (preferred) or the legacy PromptData shape (deprecated).
   *
   * The method is fully fail-soft: any parse, validation, or API error
   * results in a structured WAIT payload being returned so the caller's
   * pipeline can continue executing without throwing.
   *
   * @param data - Coordinator result or legacy prompt data
   * @returns Structured trade analysis from Claude (never throws)
   */
  async analyzeWithChecklist(
    data: CoordinatorAnalysisResult | PromptData,
  ): Promise<ClaudeAnalysisResponse> {
    const strategyRoute = this.resolveStrategyRoute(data);
    const symbol = this.resolveSymbol(data);

    const prompt = this.isCoordinatorResult(data)
      ? this.promptService.buildAnalysisPrompt(data)
      : this.promptService.buildAnalysisPrompt(data);

    this.logger.log(
      `Sending Claude prompt | symbol=${symbol} | route=${strategyRoute} | length=${prompt.length}`,
    );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const analysis = this.parseEnhancedResponse(textContent.text);
      this.validateClaudeResponse(analysis, strategyRoute);

      this.logger.log(
        `Claude analysis complete | symbol=${symbol} | route=${strategyRoute} | action=${analysis.action} | confidence=${analysis.confidence}%`,
      );

      return analysis;
    } catch (error) {
      return this.buildFallbackWait(error, symbol, strategyRoute);
    }
  }

  /**
   * Build a structured WAIT payload when the upstream call fails for any
   * reason. Logs descriptive tracking info so failures remain observable.
   */
  private buildFallbackWait(
    error: unknown,
    symbol: string,
    strategyRoute: StrategyRoute,
  ): ClaudeWaitAnalysis {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (error instanceof Anthropic.APIError) {
      this.logger.error(
        `Claude API failure | symbol=${symbol} | route=${strategyRoute} | status=${error.status} | message=${error.message}`,
      );
    } else if (error instanceof ClaudeResponseValidationError) {
      this.logger.error(
        `Claude validation failure | symbol=${symbol} | route=${strategyRoute} | field=${error.field} | value=${JSON.stringify(error.receivedValue)} | message=${error.message}`,
      );
    } else {
      this.logger.error(
        `Claude pipeline failure | symbol=${symbol} | route=${strategyRoute} | message=${message}`,
      );
    }

    return {
      action: 'WAIT',
      confidence: 0,
      summary: `AI analysis unavailable for ${symbol} on ${strategyRoute} route — defaulting to WAIT.`,
      reasoning: {
        strategyAnalysis: `Pipeline error: ${message}`,
        regimeContext: 'Not evaluated due to upstream failure.',
        keyLevels: 'Not evaluated due to upstream failure.',
      },
      warnings: [
        'AI pipeline returned a synthetic WAIT payload.',
        'Do NOT use this response to enter a trade.',
      ],
    };
  }

  /**
   * Parse enhanced Claude response
   */
  private parseEnhancedResponse(text: string): ClaudeAnalysisResponse {
    try {
      // Remove markdown code fences if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      // Try to extract JSON from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.logger.error('Failed to parse Claude response:', text.substring(0, 500));
      throw new Error(
        `Invalid JSON response from Claude: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Validate Claude's response structure and values, with route-aware rules.
   *
   * - WAIT: requires `summary`, `confidence`, and a descriptive `reasoning`
   *   block. Does NOT enforce the "X/5" conditionsMet format (a squeeze
   *   breakout WAIT has no checklist).
   * - LONG / SHORT on SQUEEZE_BREAKOUT: validates entry, stop loss, take
   *   profits, leverage, risk/reward. The reasoning block must reflect the
   *   volatility breakout context (keyLevels must be present).
   * - LONG / SHORT on CONFLUENCE_CHECKLIST: full trade validation PLUS the
   *   strict "X/5" conditionsMet format.
   */
  validateClaudeResponse(
    response: ClaudeAnalysisResponse,
    strategyRoute: StrategyRoute = 'CONFLUENCE_CHECKLIST',
  ): void {
    // --- Shared field validation -------------------------------------------
    if (!response.action || !['LONG', 'SHORT', 'WAIT'].includes(response.action)) {
      throw new ClaudeResponseValidationError(
        'Invalid or missing action',
        'action',
        response.action,
      );
    }

    if (
      typeof response.confidence !== 'number' ||
      response.confidence < 0 ||
      response.confidence > 100
    ) {
      throw new ClaudeResponseValidationError(
        'Confidence must be a number between 0 and 100',
        'confidence',
        response.confidence,
      );
    }

    if (!response.summary || typeof response.summary !== 'string') {
      throw new ClaudeResponseValidationError(
        'Missing or invalid summary',
        'summary',
        response.summary,
      );
    }

    this.validateReasoningBlock(response);

    // --- Route-specific validation ----------------------------------------
    if (isTradeSignal(response)) {
      this.validateTradeResponse(response);

      if (strategyRoute === 'SQUEEZE_BREAKOUT') {
        this.validateSqueezeBreakoutReasoning(response);
      }
    }
  }

  /**
   * Validate the structured reasoning block is present and descriptive.
   *
   * Aligned with the schemas emitted by
   * `ClaudePromptService.buildCoordinatorOutputSchema`:
   *  - Every response must carry `strategyAnalysis`, `regimeContext`,
   *    `keyLevels` (base reasoning block).
   *  - Trade signals (LONG / SHORT) additionally require `invalidation`
   *    and `risks`.
   *  - WAIT signals legitimately omit `invalidation` / `risks`.
   */
  private validateReasoningBlock(response: ClaudeAnalysisResponse): void {
    const reasoning = response.reasoning as unknown as
      | Record<string, unknown>
      | undefined;
    if (!reasoning || typeof reasoning !== 'object') {
      throw new ClaudeResponseValidationError(
        'Missing or invalid reasoning block',
        'reasoning',
        reasoning,
      );
    }

    const baseFields = ['strategyAnalysis', 'regimeContext', 'keyLevels'];
    const tradeFields = isTradeSignal(response)
      ? ['invalidation', 'risks']
      : [];

    for (const field of [...baseFields, ...tradeFields]) {
      const value = reasoning[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ClaudeResponseValidationError(
          `Reasoning block missing descriptive "${field}"`,
          `reasoning.${field}`,
          value,
        );
      }
    }
  }

  /**
   * Verify that a SQUEEZE_BREAKOUT trade response anchors its reasoning in
   * the volatility breakout context (key levels / trigger zone must be
   * referenced in the reasoning block).
   */
  private validateSqueezeBreakoutReasoning(response: ClaudeTradeAnalysis): void {
    const keyLevels = response.reasoning?.keyLevels?.toLowerCase() ?? '';
    const hasBreakoutContext =
      keyLevels.includes('breakout') ||
      keyLevels.includes('squeeze') ||
      keyLevels.includes('trigger') ||
      keyLevels.includes('compression') ||
      keyLevels.includes('volatility');

    if (!hasBreakoutContext) {
      throw new ClaudeResponseValidationError(
        'SQUEEZE_BREAKOUT reasoning must reference breakout/squeeze/trigger context',
        'reasoning.keyLevels',
        response.reasoning?.keyLevels,
      );
    }
  }

  /**
   * Validate trade-specific response fields (entry, stop loss, TPs, leverage, R:R).
   */
  private validateTradeResponse(response: ClaudeTradeAnalysis): void {
    // Entry validation
    if (!response.entry?.price || typeof response.entry.price !== 'number') {
      throw new ClaudeResponseValidationError(
        'Missing or invalid entry price',
        'entry.price',
        response.entry?.price,
      );
    }

    // Stop loss validation
    if (!response.stopLoss?.price || typeof response.stopLoss.price !== 'number') {
      throw new ClaudeResponseValidationError(
        'Missing or invalid stop loss price',
        'stopLoss.price',
        response.stopLoss?.price,
      );
    }

    // Take profit validation
    if (
      !response.takeProfit?.tp1?.price ||
      !response.takeProfit?.tp2?.price ||
      !response.takeProfit?.tp3?.price
    ) {
      throw new ClaudeResponseValidationError(
        'Missing take profit levels',
        'takeProfit',
        response.takeProfit,
      );
    }

    // Leverage validation
    if (!response.leverage?.recommended || typeof response.leverage.recommended !== 'number') {
      throw new ClaudeResponseValidationError(
        'Missing or invalid leverage',
        'leverage.recommended',
        response.leverage?.recommended,
      );
    }

    // Risk/reward validation
    if (typeof response.riskReward !== 'number' || response.riskReward <= 0) {
      throw new ClaudeResponseValidationError(
        'Invalid risk/reward ratio',
        'riskReward',
        response.riskReward,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Input discrimination helpers
  // ---------------------------------------------------------------------------

  /**
   * Discriminate between the new CoordinatorAnalysisResult contract and the
   * legacy PromptData shape using the unique `strategyRoute` field.
   */
  private isCoordinatorResult(
    input: CoordinatorAnalysisResult | PromptData,
  ): input is CoordinatorAnalysisResult {
    return (
      typeof (input as CoordinatorAnalysisResult).strategyRoute === 'string' &&
      typeof (input as CoordinatorAnalysisResult).symbol === 'string'
    );
  }

  /**
   * Resolve the active strategy route for downstream validation. Legacy
   * PromptData callers always validate as CONFLUENCE_CHECKLIST.
   */
  private resolveStrategyRoute(
    input: CoordinatorAnalysisResult | PromptData,
  ): StrategyRoute {
    return this.isCoordinatorResult(input) ? input.strategyRoute : 'CONFLUENCE_CHECKLIST';
  }

  /**
   * Resolve a symbol identifier for logging and fallback payloads.
   */
  private resolveSymbol(input: CoordinatorAnalysisResult | PromptData): string {
    if (this.isCoordinatorResult(input)) return input.symbol;
    return (input as PromptData)?.coin ?? 'UNKNOWN';
  }

  /**
   * Legacy method: Analyze market data and return trade suggestion
   * @param marketData - Market data including price, indicators, and candles
   * @returns Trade analysis result with entry, exits, and reasoning
   * @deprecated Use analyzeWithChecklist for enhanced analysis
   */
  async analyzeMarket(marketData: MarketData): Promise<TradeAnalysisResult> {
    const prompt = this.buildLegacyPrompt(marketData);

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

      return this.parseLegacyResponse(textContent.text, marketData);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Claude API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Build the legacy analysis prompt for Claude
   */
  private buildLegacyPrompt(marketData: MarketData): string {
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
   * Parse Claude's legacy response into structured TradeAnalysisResult
   */
  private parseLegacyResponse(
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
