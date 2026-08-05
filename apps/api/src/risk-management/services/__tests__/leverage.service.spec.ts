import { Test, TestingModule } from '@nestjs/testing';
import { LeverageService } from '../leverage.service';

describe('LeverageService', () => {
  let service: LeverageService;
  
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LeverageService],
    }).compile();
    
    service = module.get<LeverageService>(LeverageService);
  });
  
  it('should be defined', () => {
    expect(service).toBeDefined();
  });
  
  describe('recommendLeverage', () => {
    it('should recommend appropriate leverage for daily swing trade', () => {
      const result = service.recommendLeverage({
        timeframe: '1d',
        checklistScore: 80,
        atr: 450,
        currentPrice: 28000,
        stopLossPercentage: 5,
        experienceLevel: 'intermediate',
      });
      
      expect(result.recommended).toBe(2); // Daily = 2x base
      expect(result.tradeStyle).toBe('swing');
      expect(result.riskLevel).toBe('low');
    });
    
    it('should recommend higher leverage for 4h day trade', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 85,
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
      });
      
      expect(result.recommended).toBeLessThanOrEqual(10); // Advanced cap
      expect(result.recommended).toBeGreaterThanOrEqual(3);
      expect(result.tradeStyle).toBe('day');
    });
    
    it('should reduce leverage for low confidence score (< 80)', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 60, // Minimum passing
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
      });
      
      // Base 5x * 0.8 (low confidence) = 4x
      expect(result.recommended).toBeLessThanOrEqual(5);
      expect(result.adjustments.some(a => a.includes('checklist'))).toBe(true);
    });
    
    it('should reduce leverage more for very low confidence (< 60)', () => {
      const highConfidence = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
      });
      
      const lowConfidence = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 50,
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
      });
      
      expect(lowConfidence.recommended).toBeLessThan(highConfidence.recommended);
    });
    
    it('should cap leverage at experience level for beginners', () => {
      const result = service.recommendLeverage({
        timeframe: '15m', // Base 10x
        checklistScore: 100,
        atr: 200,
        currentPrice: 28000,
        stopLossPercentage: 2,
        experienceLevel: 'beginner', // Cap at 3x
      });
      
      expect(result.recommended).toBeLessThanOrEqual(3);
    });
    
    it('should cap leverage at experience level for intermediate', () => {
      const result = service.recommendLeverage({
        timeframe: '5m', // Base 12x
        checklistScore: 100,
        atr: 150,
        currentPrice: 28000,
        stopLossPercentage: 2,
        experienceLevel: 'intermediate', // Cap at 5x
      });
      
      expect(result.recommended).toBeLessThanOrEqual(5);
    });
    
    it('should reduce leverage for high volatility', () => {
      const result = service.recommendLeverage({
        timeframe: '1h',
        checklistScore: 80,
        atr: 1500, // Very high ATR (5.4% of price)
        currentPrice: 28000,
        stopLossPercentage: 4,
        experienceLevel: 'advanced',
      });
      
      expect(result.recommended).toBeLessThan(7); // Base would be 7x
      expect(result.adjustments.some(a => a.includes('volatility'))).toBe(true);
    });
    
    it('should not reduce leverage for low volatility', () => {
      const lowVol = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 280, // 1% of price - low
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      const highVol = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 1400, // 5% of price - high
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      expect(highVol.recommended).toBeLessThan(lowVol.recommended);
    });
    
    it('should ensure liquidation is beyond stop loss', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 30000,
        stopLossPercentage: 8, // Wide stop
        experienceLevel: 'intermediate',
      });
      
      // Max safe leverage = 100 / (8 * 2) = 6.25x
      expect(result.recommended).toBeLessThanOrEqual(6);
    });
    
    it('should limit leverage with very tight stop loss', () => {
      const result = service.recommendLeverage({
        timeframe: '1h',
        checklistScore: 80,
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 10, // Very wide stop
        experienceLevel: 'expert',
      });
      
      // Max safe = 100 / (10 * 2) = 5x
      expect(result.recommended).toBeLessThanOrEqual(5);
    });
    
    it('should provide three leverage options', () => {
      const result = service.recommendLeverage({
        timeframe: '1h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
      });
      
      expect(result.conservative).toBeLessThan(result.moderate);
      expect(result.moderate).toBe(result.recommended);
      expect(result.aggressive).toBeGreaterThan(result.moderate);
      expect(result.aggressive).toBeLessThanOrEqual(10); // Experience cap
    });
    
    it('should warn for high leverage (10x+)', () => {
      const result = service.recommendLeverage({
        timeframe: '15m',
        checklistScore: 100,
        atr: 200,
        currentPrice: 28000,
        stopLossPercentage: 2,
        experienceLevel: 'expert',
      });
      
      if (result.recommended >= 10) {
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.some(w => w.includes('High leverage'))).toBe(true);
      }
    });
    
    it('should warn for very high leverage (15x+)', () => {
      const result = service.recommendLeverage({
        timeframe: '1m',
        checklistScore: 100,
        atr: 100,
        currentPrice: 28000,
        stopLossPercentage: 1,
        experienceLevel: 'expert',
      });
      
      if (result.recommended >= 15) {
        expect(result.warnings.some(w => w.includes('Very high leverage'))).toBe(true);
      }
    });
    
    it('should adjust for bear market', () => {
      const bullResult = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
        marketCycle: 'bull',
      });
      
      const bearResult = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
        marketCycle: 'bear',
      });
      
      expect(bearResult.recommended).toBeLessThanOrEqual(bullResult.recommended);
    });
    
    it('should adjust for ranging market', () => {
      const bullResult = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
        marketCycle: 'bull',
      });
      
      const rangingResult = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
        marketCycle: 'ranging',
      });
      
      expect(rangingResult.recommended).toBeLessThanOrEqual(bullResult.recommended);
    });
    
    it('should apply conservative risk tolerance', () => {
      const moderate = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
        riskTolerance: 'moderate',
      });
      
      const conservative = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
        riskTolerance: 'conservative',
      });
      
      expect(conservative.recommended).toBeLessThanOrEqual(moderate.recommended);
    });
    
    it('should apply aggressive risk tolerance', () => {
      const moderate = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
        riskTolerance: 'moderate',
      });
      
      const aggressive = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'advanced',
        riskTolerance: 'aggressive',
      });
      
      expect(aggressive.recommended).toBeGreaterThanOrEqual(moderate.recommended);
    });
    
    it('should infer swing trade style for daily timeframe', () => {
      const result = service.recommendLeverage({
        timeframe: '1d',
        checklistScore: 80,
        atr: 450,
        currentPrice: 28000,
        stopLossPercentage: 5,
        experienceLevel: 'intermediate',
      });
      
      expect(result.tradeStyle).toBe('swing');
    });
    
    it('should infer day trade style for 4h timeframe', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 300,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      expect(result.tradeStyle).toBe('day');
    });
    
    it('should infer scalp trade style for 15m timeframe', () => {
      const result = service.recommendLeverage({
        timeframe: '15m',
        checklistScore: 80,
        atr: 200,
        currentPrice: 28000,
        stopLossPercentage: 2,
        experienceLevel: 'advanced',
      });
      
      expect(result.tradeStyle).toBe('scalp');
    });
    
    it('should infer ultra-scalp trade style for 1m timeframe', () => {
      const result = service.recommendLeverage({
        timeframe: '1m',
        checklistScore: 80,
        atr: 100,
        currentPrice: 28000,
        stopLossPercentage: 1,
        experienceLevel: 'expert',
      });
      
      expect(result.tradeStyle).toBe('ultra-scalp');
    });
    
    it('should calculate correct liquidation price', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 30000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      // Liquidation = price * (1 - 100/leverage/100)
      const expectedLiqPrice = 30000 * (1 - 100 / result.recommended / 100);
      expect(result.liquidationPrice).toBeCloseTo(expectedLiqPrice, 0);
    });
    
    it('should return correct risk level for low leverage', () => {
      const result = service.recommendLeverage({
        timeframe: '1d',
        checklistScore: 80,
        atr: 450,
        currentPrice: 28000,
        stopLossPercentage: 5,
        experienceLevel: 'beginner',
      });
      
      expect(result.riskLevel).toBe('low');
    });
    
    it('should return correct risk level for medium leverage', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      if (result.recommended >= 4 && result.recommended <= 5) {
        expect(result.riskLevel).toBe('medium');
      }
    });
    
    it('should include reasoning in response', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning).toContain('4h');
    });
    
    it('should include max drawdown in response', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
      });
      
      // Max drawdown = 100 / leverage
      const expectedDrawdown = (100 / result.recommended).toFixed(1);
      expect(result.maxDrawdown).toBe(`${expectedDrawdown}%`);
    });
    
    it('should use provided trade style override', () => {
      const result = service.recommendLeverage({
        timeframe: '4h',
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate',
        tradeStyle: 'scalp', // Override default 'day' for 4h
      });
      
      expect(result.tradeStyle).toBe('scalp');
    });
    
    // Was: 'should handle unknown timeframe with default base leverage',
    // asserting a silent fallback to 5x. That fallback was the bug — a risk
    // control that grants leverage on input it does not recognise, producing
    // a plausible number instead of an error. A "conservative" 1x default
    // would be no better: still a made-up answer. If leverage cannot be
    // determined the service must refuse to produce a plan.
    it('throws on an unrecognised timeframe rather than fabricating leverage', () => {
      const unknown = {
        timeframe: '2h', // Not in the map
        checklistScore: 80,
        atr: 400,
        currentPrice: 28000,
        stopLossPercentage: 3,
        experienceLevel: 'intermediate' as const,
      };

      expect(() => service.recommendLeverage(unknown)).toThrow(
        /unrecognised timeframe "2h"/i,
      );
      // The error names the valid options so a caller can correct the input.
      expect(() => service.recommendLeverage(unknown)).toThrow(/1w, 1d, 12h, 4h/);
    });

    it.each(['', '1H', '1D', '60m', 'daily', 'nonsense'])(
      'rejects "%s" instead of silently defaulting',
      (timeframe) => {
        expect(() =>
          service.recommendLeverage({
            timeframe,
            checklistScore: 60,
            atr: 500,
            currentPrice: 60000,
            stopLossPercentage: 3,
            experienceLevel: 'intermediate',
          }),
        ).toThrow();
      },
    );
  });
  
  describe('getLeverageConstraints', () => {
    it('should return correct constraints for beginner on 4h', () => {
      const constraints = service.getLeverageConstraints('beginner', '4h');
      
      expect(constraints.min).toBe(1);
      expect(constraints.max).toBe(3); // Beginner cap is 3, 4h base is 5, so min(3, 10) = 3
      expect(constraints.reason).toContain('beginner');
      expect(constraints.reason).toContain('4h');
    });
    
    it('should return correct constraints for intermediate on 1h', () => {
      const constraints = service.getLeverageConstraints('intermediate', '1h');
      
      expect(constraints.min).toBe(1);
      expect(constraints.max).toBeLessThanOrEqual(5); // Intermediate cap
    });
    
    it('should return correct constraints for advanced on 15m', () => {
      const constraints = service.getLeverageConstraints('advanced', '15m');
      
      expect(constraints.min).toBe(1);
      expect(constraints.max).toBeLessThanOrEqual(10); // Advanced cap
    });
    
    it('should return correct constraints for expert on 1m', () => {
      const constraints = service.getLeverageConstraints('expert', '1m');
      
      expect(constraints.min).toBe(1);
      expect(constraints.max).toBe(20); // Expert cap
    });
    
    it('should handle daily timeframe for expert', () => {
      const constraints = service.getLeverageConstraints('expert', '1d');
      
      expect(constraints.min).toBe(1);
      // 1d base is 2, max would be min(20, 2*2) = 4
      expect(constraints.max).toBe(4);
    });
  });
});
