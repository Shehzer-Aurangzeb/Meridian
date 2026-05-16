import { Injectable, Logger } from '@nestjs/common';
import { MultiTimeframeService } from './multi-timeframe.service';
import { SupportResistanceService } from './support-resistance.service';
import { ClaudeService } from './claude.service';
import { PositionSizingService } from './position-sizing.service';
import { LeverageService } from './leverage.service';
import { BinanceService } from './binance.service';
import {
  CompleteAnalysisRequest,
  CompleteAnalysisResponse,
  TradeSummary,
} from '../types/complete-analysis.types';
import { isTradeSignal, ClaudeTradeAnalysis } from '../types/claude-response.types';
import { ExperienceLevel } from '../types/leverage.types';
import { Timeframe } from '../constants/timeframes';

@Injectable()
export class CompleteAnalysisService {
  private readonly logger = new Logger(CompleteAnalysisService.name);

  constructor(
    private readonly multiTimeframeService: MultiTimeframeService,
    private readonly supportResistanceService: SupportResistanceService,
    private readonly claudeService: ClaudeService,
    private readonly positionSizingService: PositionSizingService,
    private readonly leverageService: LeverageService,
    private readonly binanceService: BinanceService,
  ) {}

  /**
   * Main orchestration method
   * Coordinates all services to produce complete analysis
   */
  async analyzeComplete(
    request: CompleteAnalysisRequest,
  ): Promise<CompleteAnalysisResponse> {
    const startTime = Date.now();
    this.logger.log(`Starting complete analysis for ${request.coin}`);

    try {
      // 1. Get current price
      const symbol = `${request.coin.toUpperCase()}USDT`;
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      // 2. Multi-timeframe analysis with checklist
      const tradeType = request.tradeType || 'day';
      const timeframeAnalysis = await this.multiTimeframeService.analyzeMultipleTimeframes({
        symbol,
        tradeType,
        includeDetailedChecklist: true,
      });

      // Extract checklist from analysis
      const checklist = timeframeAnalysis.fivePointChecklist;
      if (!checklist) {
        throw new Error('5-point checklist not available from multi-timeframe analysis');
      }

      // 3. Support/Resistance levels
      const timeframe = (request.timeframe || this.getDefaultTimeframe(tradeType)) as Timeframe;
      const srAnalysis = await this.supportResistanceService.getFullAnalysis(
        symbol,
        currentPrice,
        timeframe,
      );

      const keyLevels: CompleteAnalysisResponse['keyLevels'] = {
        support: srAnalysis.levels
          .filter((l: { type: string }) => l.type === 'support')
          .slice(0, 5),
        resistance: srAnalysis.levels
          .filter((l: { type: string }) => l.type === 'resistance')
          .slice(0, 5),
      };

      // Optional: Fibonacci levels
      if (request.includeFibonacci && srAnalysis.fibonacci) {
        keyLevels.fibonacci = srAnalysis.fibonacci;
      }

      // 4. Claude AI analysis
      const aiAnalysis = await this.claudeService.analyzeWithChecklist({
        coin: request.coin.toUpperCase(),
        currentPrice,
        multiTimeframeAnalysis: timeframeAnalysis,
        checklist,
        srLevels: srAnalysis.levels,
      });

      // 5. Risk management (if account balance provided)
      let riskManagement: CompleteAnalysisResponse['riskManagement'] = undefined;

      const shouldCalculateRisk =
        request.accountBalance &&
        (request.includeRiskManagement !== false) &&
        isTradeSignal(aiAnalysis);

      if (shouldCalculateRisk) {
        const tradeAnalysis = aiAnalysis as ClaudeTradeAnalysis;
        
        // Calculate stop loss percentage
        const stopLossDistance = Math.abs(
          tradeAnalysis.entry.price - tradeAnalysis.stopLoss.price,
        );
        const stopLossPercentage = (stopLossDistance / tradeAnalysis.entry.price) * 100;

        // Find primary timeframe analysis for ATR
        const primaryTF = timeframeAnalysis.timeframeAnalysis?.find(
          (t: { timeframe: string }) => t.timeframe === timeframe,
        );
        const atr = primaryTF?.indicators?.atr || currentPrice * 0.02; // Fallback to 2% of price

        // Get leverage recommendation
        const leverageRec = this.leverageService.recommendLeverage({
          timeframe,
          checklistScore: checklist.totalScore,
          atr,
          currentPrice,
          stopLossPercentage,
          experienceLevel: (request.experienceLevel || 'intermediate') as ExperienceLevel,
          riskTolerance: request.riskTolerance,
          marketCycle:
            timeframeAnalysis.htfBias.bias === 'bullish'
              ? 'bull'
              : timeframeAnalysis.htfBias.bias === 'bearish'
                ? 'bear'
                : 'ranging',
        });

        // Calculate position sizing
        const positionSizing = this.positionSizingService.calculatePositionSize({
          accountBalance: request.accountBalance!,
          riskPercentage: request.riskPercentage || 1,
          entryPrice: tradeAnalysis.entry.price,
          stopLoss: tradeAnalysis.stopLoss.price,
          leverage: leverageRec.recommended,
        });

        // Calculate risk/reward
        const riskReward = this.positionSizingService.calculateRiskReward(
          tradeAnalysis.entry.price,
          tradeAnalysis.stopLoss.price,
          {
            tp1: tradeAnalysis.takeProfit.tp1.price,
            tp2: tradeAnalysis.takeProfit.tp2.price,
            tp3: tradeAnalysis.takeProfit.tp3.price,
          },
        );

        riskManagement = {
          leverageRecommendation: leverageRec,
          positionSizing,
          riskReward,
        };
      }

      // 6. Generate trade summary
      const summary = this.generateTradeSummary(aiAnalysis, checklist, riskManagement);

      // 7. Build response
      const processingTime = Date.now() - startTime;
      this.logger.log(`Complete analysis finished in ${processingTime}ms`);

      return {
        coin: request.coin.toUpperCase(),
        timestamp: new Date().toISOString(),
        currentPrice,
        timeframeAnalysis,
        checklist,
        keyLevels,
        aiAnalysis,
        riskManagement,
        summary,
        meta: {
          processingTimeMs: processingTime,
          cacheHit: false, // TODO: Set based on actual cache usage
          dataFreshness: 'Real-time',
        },
      };
    } catch (error) {
      this.logger.error(`Complete analysis failed for ${request.coin}:`, error);
      throw error;
    }
  }

  /**
   * Generate concise trade summary
   */
  private generateTradeSummary(
    aiAnalysis: any,
    checklist: any,
    riskManagement: CompleteAnalysisResponse['riskManagement'],
  ): TradeSummary {
    const action = aiAnalysis.action as 'LONG' | 'SHORT' | 'WAIT';
    const isWait = action === 'WAIT';

    // Determine confidence based on checklist score
    const confidence: 'high' | 'medium' | 'low' =
      checklist.totalScore >= 80
        ? 'high'
        : checklist.totalScore >= 60
          ? 'medium'
          : 'low';

    // Quick reason
    const quickReason = isWait
      ? aiAnalysis.summary || 'Conditions not met for entry'
      : `${checklist.conditionsMet}/5 conditions met. ${aiAnalysis.summary || ''}`;

    // Collect warnings
    const warnings: string[] = [];

    if (!isWait) {
      // Add checklist warnings
      if (checklist.totalScore < 80) {
        warnings.push('Moderate confidence setup - not all conditions met');
      }

      // Add risk management warnings
      if (riskManagement) {
        warnings.push(...riskManagement.leverageRecommendation.warnings);
        warnings.push(...riskManagement.positionSizing.warnings);
      }

      // Add AI warnings if present
      if (aiAnalysis.warnings) {
        warnings.push(...aiAnalysis.warnings);
      }
    }

    // Should trade?
    const shouldTrade =
      !isWait &&
      checklist.passed &&
      confidence !== 'low' &&
      (!riskManagement || riskManagement.positionSizing.isValid);

    const summary: TradeSummary = {
      action,
      confidence,
      quickReason: quickReason.trim(),
      warnings,
      shouldTrade,
    };

    // Add trade details if not WAIT
    if (!isWait && isTradeSignal(aiAnalysis)) {
      const tradeAnalysis = aiAnalysis as ClaudeTradeAnalysis;
      summary.entry = tradeAnalysis.entry.price;
      summary.stopLoss = tradeAnalysis.stopLoss.price;
      summary.targets = [
        tradeAnalysis.takeProfit.tp1.price,
        tradeAnalysis.takeProfit.tp2.price,
        tradeAnalysis.takeProfit.tp3.price,
      ];
      summary.leverage = riskManagement?.leverageRecommendation.recommended;
    }

    return summary;
  }

  /**
   * Get default timeframe based on trade type
   */
  private getDefaultTimeframe(tradeType: 'swing' | 'day' | 'scalp'): string {
    switch (tradeType) {
      case 'swing':
        return '1d';
      case 'day':
        return '1h';
      case 'scalp':
        return '15m';
      default:
        return '1h';
    }
  }
}
