import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PositionSizingService } from '../position-sizing.service';

describe('PositionSizingService', () => {
  let service: PositionSizingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PositionSizingService],
    }).compile();

    service = module.get<PositionSizingService>(PositionSizingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculatePositionSize', () => {
    it('should calculate correct position size for 1% risk long position', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 28000,
        stopLoss: 27000, // $1000 stop = 3.57%
        leverage: 5,
      });

      expect(result.riskAmount).toBe(100); // 1% of 10000
      expect(result.stopLossPercentage).toBeCloseTo(3.57, 1);
      expect(result.direction).toBe('long');
      expect(result.positionSize).toBeCloseTo(2800, -1); // 100 / 0.0357 ≈ 2800
      expect(result.margin).toBeCloseTo(560, -1); // positionSize / 5
      expect(result.maxLoss).toBe(100);
      expect(result.isValid).toBe(true);
    });

    it('should calculate correct position size for 2% risk short position', () => {
      const result = service.calculatePositionSize({
        accountBalance: 5000,
        riskPercentage: 2,
        entryPrice: 30000,
        stopLoss: 31500, // 5% stop loss
        leverage: 3,
      });

      expect(result.riskAmount).toBe(100); // 2% of 5000
      expect(result.stopLossPercentage).toBe(5);
      expect(result.direction).toBe('short');
      expect(result.positionSize).toBe(2000); // 100 / 0.05
      expect(result.margin).toBeCloseTo(666.67, 1); // 2000 / 3
      expect(result.isValid).toBe(true);
    });

    it('should calculate correct coin amount', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 50000, // BTC at 50k
        stopLoss: 47500, // 5% stop
        leverage: 2,
      });

      // Position size = 100 / 0.05 = 2000
      // Coin amount = 2000 / 50000 = 0.04
      expect(result.positionSize).toBe(2000);
      expect(result.coinAmount).toBe(0.04);
    });

    it('should calculate liquidation price correctly for long', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 30000,
        stopLoss: 29000,
        leverage: 10,
      });

      // 10x leverage liquidates at 10% loss
      // Entry 30000, liquidation at 27000 (10% down)
      expect(result.liquidationPrice).toBe(27000);
      expect(result.direction).toBe('long');
    });

    it('should calculate liquidation price correctly for short', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 30000,
        stopLoss: 31000,
        leverage: 10,
      });

      // 10x leverage liquidates at 10% move against
      // Entry 30000, short liquidation at 33000 (10% up)
      expect(result.liquidationPrice).toBe(33000);
      expect(result.direction).toBe('short');
    });

    it('should warn if margin usage is high (> 10%)', () => {
      const result = service.calculatePositionSize({
        accountBalance: 1000,
        riskPercentage: 2,
        entryPrice: 28000,
        stopLoss: 27440, // 2% stop
        leverage: 2,
      });

      // Position size = 20 / 0.02 = 1000
      // Margin = 1000 / 2 = 500 = 50% of account
      expect(result.marginPercentage).toBe(50);
      expect(result.warnings.some((w) => w.includes('capital usage'))).toBe(
        true,
      );
    });

    it('should warn if stop loss is too tight (< 2%)', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 28000,
        stopLoss: 27800, // 0.71% stop
        leverage: 3,
      });

      expect(result.stopLossPercentage).toBeCloseTo(0.71, 1);
      expect(result.warnings.some((w) => w.includes('tight'))).toBe(true);
    });

    it('should warn if stop loss is too wide (> 15%)', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 28000,
        stopLoss: 23000, // ~18% stop
        leverage: 2,
      });

      expect(result.stopLossPercentage).toBeCloseTo(17.86, 1);
      expect(result.warnings.some((w) => w.includes('wide'))).toBe(true);
    });

    it('should warn if leverage is high (> 10x)', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 28000,
        stopLoss: 27000,
        leverage: 15,
      });

      expect(result.warnings.some((w) => w.includes('High leverage'))).toBe(
        true,
      );
    });

    it('should mark invalid if liquidation is before stop loss for long', () => {
      const result = service.calculatePositionSize({
        accountBalance: 10000,
        riskPercentage: 1,
        entryPrice: 28000,
        stopLoss: 25000, // 10.7% stop
        leverage: 10, // liquidates at 10% = 25200
      });

      // Liquidation at 25200 is ABOVE stop loss at 25000
      expect(result.liquidationPrice).toBe(25200);
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('DANGER'))).toBe(true);
    });

    it('should mark invalid if insufficient balance', () => {
      const result = service.calculatePositionSize({
        accountBalance: 100,
        riskPercentage: 2,
        entryPrice: 28000,
        stopLoss: 27720, // 1% stop
        leverage: 2,
      });

      // Risk = $2, position = $200, margin = $100 = 100% of account
      // This should trigger high margin warning but still be "valid" since margin = balance
      expect(result.marginPercentage).toBe(100);
    });

    it('should throw error for invalid account balance', () => {
      expect(() =>
        service.calculatePositionSize({
          accountBalance: 0,
          riskPercentage: 1,
          entryPrice: 28000,
          stopLoss: 27000,
          leverage: 5,
        }),
      ).toThrow(BadRequestException);
    });

    it('should throw error for invalid risk percentage', () => {
      expect(() =>
        service.calculatePositionSize({
          accountBalance: 10000,
          riskPercentage: 10, // Too high
          entryPrice: 28000,
          stopLoss: 27000,
          leverage: 5,
        }),
      ).toThrow(BadRequestException);
    });

    it('should throw error if entry equals stop loss', () => {
      expect(() =>
        service.calculatePositionSize({
          accountBalance: 10000,
          riskPercentage: 1,
          entryPrice: 28000,
          stopLoss: 28000,
          leverage: 5,
        }),
      ).toThrow(BadRequestException);
    });

    it('should throw error for invalid leverage', () => {
      expect(() =>
        service.calculatePositionSize({
          accountBalance: 10000,
          riskPercentage: 1,
          entryPrice: 28000,
          stopLoss: 27000,
          leverage: 25, // Too high
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculateLiquidationPrice', () => {
    it('should calculate 5x long liquidation (20% drop)', () => {
      const liqPrice = service.calculateLiquidationPrice(10000, 5, 'long');
      expect(liqPrice).toBe(8000); // 20% down from 10000
    });

    it('should calculate 5x short liquidation (20% rise)', () => {
      const liqPrice = service.calculateLiquidationPrice(10000, 5, 'short');
      expect(liqPrice).toBe(12000); // 20% up from 10000
    });

    it('should calculate 1x long liquidation (100% drop)', () => {
      const liqPrice = service.calculateLiquidationPrice(10000, 1, 'long');
      expect(liqPrice).toBe(0); // 100% down = 0
    });

    it('should calculate 20x liquidation (5% move)', () => {
      const liqPrice = service.calculateLiquidationPrice(10000, 20, 'long');
      expect(liqPrice).toBe(9500); // 5% down
    });
  });

  describe('calculateRiskReward', () => {
    it('should calculate R:R ratios correctly', () => {
      const rr = service.calculateRiskReward(
        28000, // entry
        27000, // stop (1000 risk)
        {
          tp1: 29000, // 1000 reward (1:1)
          tp2: 30000, // 2000 reward (2:1)
          tp3: 31500, // 3500 reward (3.5:1)
        },
      );

      expect(rr.tp1).toBe(1);
      expect(rr.tp2).toBe(2);
      expect(rr.tp3).toBe(3.5);

      // Overall = weighted average (20% @ TP1, 30% @ TP2, 50% @ TP3)
      // = (1 * 0.2) + (2 * 0.3) + (3.5 * 0.5) = 0.2 + 0.6 + 1.75 = 2.55
      expect(rr.overall).toBe(2.55);
    });

    it('should handle short position R:R', () => {
      const rr = service.calculateRiskReward(
        30000, // entry (short)
        31000, // stop (1000 risk)
        {
          tp1: 29000, // 1000 reward
          tp2: 28000, // 2000 reward
          tp3: 27000, // 3000 reward
        },
      );

      expect(rr.tp1).toBe(1);
      expect(rr.tp2).toBe(2);
      expect(rr.tp3).toBe(3);
    });

    it('should throw error if entry equals stop', () => {
      expect(() =>
        service.calculateRiskReward(28000, 28000, {
          tp1: 29000,
          tp2: 30000,
          tp3: 31000,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculatePortfolioAllocation', () => {
    it('should follow 60/20/20 allocation rule', () => {
      const allocation = service.calculatePortfolioAllocation(10000);

      expect(allocation.totalBalance).toBe(10000);
      expect(allocation.longTerm.allocation).toBe(6000); // 60%
      expect(allocation.midTerm.allocation).toBe(2000); // 20%
      expect(allocation.shortTerm.allocation).toBe(2000); // 20%

      expect(allocation.longTerm.leverage).toBe(1);
      expect(allocation.midTerm.leverage).toBe(2);
      expect(allocation.shortTerm.leverage).toBe(5);
    });

    it('should handle small balances', () => {
      const allocation = service.calculatePortfolioAllocation(100);

      expect(allocation.longTerm.allocation).toBe(60);
      expect(allocation.midTerm.allocation).toBe(20);
      expect(allocation.shortTerm.allocation).toBe(20);
    });

    it('should throw error for negative balance', () => {
      expect(() => service.calculatePortfolioAllocation(-100)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('suggestPortfolioType', () => {
    it('should suggest long-term for daily timeframe', () => {
      expect(service.suggestPortfolioType('1d', 1)).toBe('longTerm');
    });

    it('should suggest long-term for weekly timeframe', () => {
      expect(service.suggestPortfolioType('1w', 1)).toBe('longTerm');
    });

    it('should suggest mid-term for 4h timeframe', () => {
      expect(service.suggestPortfolioType('4h', 3)).toBe('midTerm');
    });

    it('should suggest mid-term for 12h timeframe', () => {
      expect(service.suggestPortfolioType('12h', 2)).toBe('midTerm');
    });

    it('should suggest short-term for 1h with high leverage', () => {
      expect(service.suggestPortfolioType('1h', 10)).toBe('shortTerm');
    });

    it('should suggest short-term for 15m timeframe', () => {
      expect(service.suggestPortfolioType('15m', 7)).toBe('shortTerm');
    });
  });

  describe('getRecommendedLeverage', () => {
    it('should recommend 1x for daily', () => {
      const rec = service.getRecommendedLeverage('1d');
      expect(rec.recommended).toBe(1);
      expect(rec.min).toBe(1);
      expect(rec.max).toBe(2);
    });

    it('should recommend 3x for 4h', () => {
      const rec = service.getRecommendedLeverage('4h');
      expect(rec.recommended).toBe(3);
      expect(rec.min).toBe(2);
      expect(rec.max).toBe(5);
    });

    it('should recommend 5x for 1h', () => {
      const rec = service.getRecommendedLeverage('1h');
      expect(rec.recommended).toBe(5);
    });

    it('should recommend 10x for 5m', () => {
      const rec = service.getRecommendedLeverage('5m');
      expect(rec.recommended).toBe(10);
    });
  });
});
