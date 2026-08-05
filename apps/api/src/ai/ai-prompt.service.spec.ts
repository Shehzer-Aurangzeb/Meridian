import { ClaudePromptService, PromptData } from './ai-prompt.service';
import { MultiTimeframeAnalysisResult, HTFBiasResult, LTFEntryResult, TimeframeAnalysis } from '../analysis/interfaces/multi-timeframe.types';
import { EntryChecklistResult, ChecklistCondition, ChecklistStatus } from '../analysis/interfaces/checklist.types';
import { SupportResistanceLevel } from '../analysis/interfaces/support-resistance.types';

describe('ClaudePromptService', () => {
  let service: ClaudePromptService;

  beforeEach(() => {
    service = new ClaudePromptService();
  });

  // Helper to create mock checklist condition
  const createCondition = (
    name: string,
    passed: boolean,
    reason: string,
    value?: number | string,
  ): ChecklistCondition => ({
    name,
    passed,
    score: passed ? 20 : 0,
    reason,
    value,
  });

  // Helper to create mock checklist
  const createChecklist = (
    tradeType: 'long' | 'short',
    conditionsPassed: boolean[],
  ): EntryChecklistResult => {
    const conditions = [
      createCondition('RSI', conditionsPassed[0], conditionsPassed[0] ? 'RSI at 28 - oversold' : 'RSI at 55 - neutral', 28),
      createCondition('QQE', conditionsPassed[1], conditionsPassed[1] ? 'Green bars' : 'Red bars'),
      createCondition('Bollinger Band', conditionsPassed[2], conditionsPassed[2] ? 'At lower band, bands expanded' : 'Mid-range'),
      createCondition('Market Structure', conditionsPassed[3], conditionsPassed[3] ? 'HH/HL pattern confirmed' : 'Ranging market'),
      createCondition('Support/Resistance', conditionsPassed[4], conditionsPassed[4] ? 'At strong support $28,600' : 'No nearby level'),
    ];

    const conditionsMet = conditionsPassed.filter(Boolean).length;
    const totalScore = conditionsMet * 20;

    // Derive status from score to mirror ChecklistService.determineStatus tiers
    const deriveStatus = (score: number): ChecklistStatus => {
      if (score >= 80) return 'APEX_SETUP';
      if (score >= 60) return 'STRATEGIC_TRADE';
      if (score >= 40) return 'TACTICAL_SETUP';
      return 'WATCHING';
    };
    const status = deriveStatus(totalScore);

    return {
      rsi: conditions[0],
      qqe: conditions[1],
      bollingerBand: conditions[2],
      marketStructure: conditions[3],
      supportResistance: conditions[4],
      totalScore,
      conditionsMet,
      status,
      passed: status !== 'WATCHING',
      tradeType,
      conditions,
    };
  };

  // Helper to create mock HTF bias
  const createHTFBias = (bias: 'bullish' | 'bearish' | 'neutral', confidence: number): HTFBiasResult => ({
    bias,
    confidence,
    reasoning: [`${bias} structure on daily`, `${bias} momentum on 4h`],
    alignedTimeframes: ['1d', '4h'] as any[],
    conflictingTimeframes: [],
  });

  // Helper to create mock LTF entry
  const createLTFEntry = (hasEntry: boolean): LTFEntryResult => ({
    hasEntry,
    timeframe: hasEntry ? '1h' : null,
    signal: hasEntry ? 'pullback_to_support' : 'none',
    reasons: hasEntry ? ['RSI oversold at support', 'QQE showing bullish momentum'] : [],
    entryZone: hasEntry ? { low: 28500, high: 28700 } : null,
    suggestedStopLoss: hasEntry ? 27800 : null,
    riskRewardRatio: hasEntry ? 2.5 : null,
  });

  // Helper to create mock timeframe analysis
  const createTimeframeAnalysis = (timeframe: string, bias: 'bullish' | 'bearish' | 'neutral'): TimeframeAnalysis => ({
    timeframe: timeframe as any,
    indicators: {
      rsi: bias === 'bullish' ? 28 : bias === 'bearish' ? 72 : 50,
      bollingerBands: { upper: 30000, middle: 29000, lower: 28000 },
      atr: 450,
      support: 28600,
      resistance: 30500,
    },
    extendedIndicators: {
      // Base IndicatorResults properties
      rsi: bias === 'bullish' ? 28 : bias === 'bearish' ? 72 : 50,
      bollingerBands: { upper: 30000, middle: 29000, lower: 28000 },
      atr: 450,
      support: 28600,
      resistance: 30500,
      // Extended properties
      qqe: { 
        value: 50, 
        color: bias === 'bullish' ? 'green' : 'red', 
        previousColor: bias === 'bullish' ? 'green' : 'red',
        trend: bias === 'bullish' ? 'rising' : 'falling',
      },
      bandWidth: 6.9,
      keyLevels: [],
    },
    marketStructure: {
      structure: bias === 'bullish' ? 'bullish' : bias === 'bearish' ? 'bearish' : 'ranging',
      pattern: bias === 'bullish' ? 'HH/HL' : bias === 'bearish' ? 'LH/LL' : 'ranging',
      swingPoints: [],
      lastHigherHigh: null,
      lastHigherLow: null,
      lastLowerHigh: null,
      lastLowerLow: null,
      trendStrength: 75,
    },
    bias,
    confidence: 80,
    key50Level: 29000,
    currentPrice: 28750,
    candleCount: 100,
  });

  // Helper to create mock S/R levels
  const createSRLevels = (): SupportResistanceLevel[] => [
    {
      price: 28600,
      type: 'support',
      strength: 4,
      timeframe: '4h' as any,
      lastTested: new Date(),
      held: true,
      distancePercent: 0.5,
      touchCount: 5,
    },
    {
      price: 27500,
      type: 'support',
      strength: 3,
      timeframe: '1d' as any,
      lastTested: new Date(),
      held: true,
      distancePercent: 4.3,
      touchCount: 3,
    },
    {
      price: 30500,
      type: 'resistance',
      strength: 4,
      timeframe: '4h' as any,
      lastTested: new Date(),
      held: true,
      distancePercent: 6.1,
      touchCount: 4,
    },
  ];

  // Helper to create full mock data
  const createMockData = (
    tradeType: 'long' | 'short',
    conditionsPassed: boolean[],
    htfBias: 'bullish' | 'bearish' | 'neutral',
  ): PromptData => {
    const checklist = createChecklist(tradeType, conditionsPassed);
    const mtfResult: MultiTimeframeAnalysisResult = {
      symbol: 'BTC',
      analyzedAt: new Date(),
      currentPrice: 28750,
      timeframeAnalysis: [
        createTimeframeAnalysis('1d', htfBias),
        createTimeframeAnalysis('4h', htfBias),
        createTimeframeAnalysis('1h', tradeType === 'long' ? 'bullish' : 'bearish'),
      ],
      htfBias: createHTFBias(htfBias, 85),
      ltfEntry: createLTFEntry(checklist.passed),
      entryChecklist: {
        htfBiasConfirmed: htfBias !== 'neutral',
        marketStructureAligned: true,
        keyLevelIdentified: true,
        ltfConfirmation: true,
        rsiConditionMet: conditionsPassed[0],
        score: checklist.conditionsMet,
        passed: checklist.passed,
      },
      fivePointChecklist: checklist,
      tradeSuggestion: {
        action: checklist.passed ? (tradeType === 'long' ? 'long' : 'short') : 'wait',
        confidence: checklist.passed ? 80 : 30,
        reasoning: checklist.passed ? 'Strong setup with confluence' : 'Insufficient conditions met',
      },
    };

    return {
      coin: 'BTC',
      currentPrice: 28750,
      multiTimeframeAnalysis: mtfResult,
      checklist,
      srLevels: createSRLevels(),
    };
  };

  /**
   * These assert that the prompt CARRIES THE DATA the model needs — scores,
   * trade type, price, levels, output schema keys — rather than matching
   * prose headers. Prompt wording is tuned often; the data contract is not.
   */
  describe('buildAnalysisPrompt', () => {
    it('carries the full checklist state for a 5/5 long setup', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('100/100');
      expect(prompt).toContain('5/5 conditions met');
      expect(prompt).toContain('LONG');
      expect(prompt).toContain('✅ PASSED');

      // Coin and price must reach the model.
      expect(prompt).toContain('BTCUSDT');
      expect(prompt).toContain('28,750');
    });

    it('carries a failing score for a 1/5 setup', () => {
      // 1/5 fails the playbook's 3-of-5 minimum. Note this fixture derives
      // `passed` from the old tier rule, where WATCHING was the only failing
      // tier; production now fails 2/5 as well. The assertion holds under
      // both, and the fixture is exercising prompt rendering, not the gate.
      const data = createMockData('long', [true, false, false, false, false], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('20/100');
      expect(prompt).toContain('1/5 conditions met');
      expect(prompt).toContain('❌ FAILED');
    });

    it('carries short direction and bearish bias', () => {
      const data = createMockData('short', [true, true, true, true, false], 'bearish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('SHORT');
      expect(prompt).toContain('BEARISH');
      expect(prompt).toContain('80/100');
      expect(prompt).toContain('✅ PASSED');
    });

    it('states the scoring rule the model must apply', () => {
      const data = createMockData('long', [true, true, true, false, false], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('60+ points');
      // All five conditions must be named so the model can reason per-condition.
      expect(prompt).toContain('RSI');
      expect(prompt).toContain('QQE');
      expect(prompt).toContain('Bollinger Band');
      expect(prompt).toContain('Market Structure');
      expect(prompt).toContain('Support/Resistance');
    });

    it('carries S/R levels with strength, distance and touch count', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('$28,600');
      expect(prompt).toContain('$30,500');
      expect(prompt).toContain('strength: 4/5');
      expect(prompt).toContain('% away');
      expect(prompt).toContain('touches');
    });

    it('specifies every field of the JSON output contract', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      // These keys are what ClaudeService.parseEnhancedResponse validates.
      for (const key of [
        '"action"',
        '"confidence"',
        '"entry"',
        '"stopLoss"',
        '"takeProfit"',
        '"leverage"',
        '"riskReward"',
        '"reasoning"',
        '"warnings"',
      ]) {
        expect(prompt).toContain(key);
      }

      // Both branches of the decision must be specified.
      expect(prompt).toContain('"LONG" | "SHORT"');
      expect(prompt).toContain('"WAIT"');
    });

    it('carries HTF bias and LTF entry signal', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('BULLISH');
      expect(prompt).toContain('85% confidence');
      expect(prompt).toContain('Has Entry');
      // Per-timeframe breakdown must be present.
      expect(prompt).toContain('4H');
    });

    it('surfaces conflicting timeframes when present', () => {
      const data = createMockData('long', [true, false, true, false, false], 'neutral');
      data.multiTimeframeAnalysis.htfBias.conflictingTimeframes = ['1d', '4h'] as any[];
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('NEUTRAL');
      expect(prompt).toContain('1d, 4h');
    });

    it('stays within a sane token budget', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt.length).toBeGreaterThan(2500);
      expect(prompt.length).toBeLessThan(15000);
    });
  });

  describe('edge cases', () => {
    it('should handle empty S/R levels', () => {
      const data = createMockData('long', [true, true, true, true, true], 'bullish');
      data.srLevels = [];
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('None identified nearby');
    });

    it('should handle missing entry zone in LTF', () => {
      const data = createMockData('long', [false, false, true, false, false], 'neutral');
      const prompt = service.buildAnalysisPrompt(data);

      expect(prompt).toContain('Has Entry**: NO');
    });
  });
});
