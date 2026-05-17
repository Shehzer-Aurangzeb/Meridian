import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Risk Management E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /analysis/position-size', () => {
    it('should calculate position size correctly', async () => {
      const response = await request(app.getHttpServer())
        .post('/analysis/position-size')
        .send({
          accountBalance: 10000,
          riskPercentage: 1,
          entryPrice: 28000,
          stopLoss: 27000,
          leverage: 5,
        });
      
      expect([200, 201]).toContain(response.status);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data.riskAmount).toBe(100); // 1% of 10000
      expect(data.positionSize).toBeGreaterThan(0);
      expect(data.coinAmount).toBeGreaterThan(0);
      expect(data.margin).toBeGreaterThan(0);
      expect(data.liquidationPrice).toBeLessThan(28000);
      expect(typeof data.isValid).toBe('boolean');
      expect(Array.isArray(data.warnings)).toBe(true);
    });

    it('should handle different leverage values', async () => {
      const [low, high] = await Promise.all([
        request(app.getHttpServer())
          .post('/analysis/position-size')
          .send({
            accountBalance: 5000,
            riskPercentage: 2,
            entryPrice: 3000,
            stopLoss: 2900,
            leverage: 2,
          }),
        request(app.getHttpServer())
          .post('/analysis/position-size')
          .send({
            accountBalance: 5000,
            riskPercentage: 2,
            entryPrice: 3000,
            stopLoss: 2900,
            leverage: 10,
          }),
      ]);

      // Higher leverage = same position size but lower margin
      expect(low.body.data.margin).toBeGreaterThan(high.body.data.margin);
      expect(low.body.data.positionSize).toBeCloseTo(high.body.data.positionSize, 2);
    });
  });

  describe('POST /analysis/risk-reward', () => {
    it('should calculate risk/reward ratios correctly', async () => {
      const response = await request(app.getHttpServer())
        .post('/analysis/risk-reward')
        .send({
          entryPrice: 100,
          stopLoss: 95,
          tp1: 110,
          tp2: 115,
          tp3: 125,
        });
      
      expect([200, 201]).toContain(response.status);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data.tp1).toBe(2); // (110-100)/(100-95) = 10/5 = 2
      expect(data.tp2).toBe(3); // (115-100)/(100-95) = 15/5 = 3
      expect(data.tp3).toBe(5); // (125-100)/(100-95) = 25/5 = 5
      expect(data.overall).toBeGreaterThan(0);
    });

    it('should handle SHORT positions', async () => {
      const response = await request(app.getHttpServer())
        .post('/analysis/risk-reward')
        .send({
          entryPrice: 100,
          stopLoss: 105, // Stop above entry = SHORT
          tp1: 95,
          tp2: 90,
          tp3: 85,
        });
      
      expect([200, 201]).toContain(response.status);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data.tp1).toBe(1); // (100-95)/(105-100) = 5/5 = 1
      expect(data.tp2).toBe(2); // (100-90)/(105-100) = 10/5 = 2
      expect(data.tp3).toBe(3); // (100-85)/(105-100) = 15/5 = 3
    });
  });

  describe('GET /analysis/portfolio-allocation', () => {
    it('should return portfolio allocation based on 60/20/20 rule', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/portfolio-allocation')
        .query({ balance: 10000 })
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('longTerm');
      expect(data).toHaveProperty('midTerm');
      expect(data).toHaveProperty('shortTerm');

      // 60/20/20 split
      expect(data.longTerm.allocation).toBe(6000);
      expect(data.midTerm.allocation).toBe(2000);
      expect(data.shortTerm.allocation).toBe(2000);

      // Leverage guidelines
      expect(data.longTerm.leverage).toBe(1);
      expect(data.midTerm.leverage).toBeGreaterThan(1);
      expect(data.shortTerm.leverage).toBeGreaterThan(data.midTerm.leverage);
    });
  });

  describe('GET /analysis/leverage/:timeframe', () => {
    it('should return recommended leverage for timeframe', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/leverage/1h')
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('timeframe');
      expect(data.timeframe).toBe('1h');
      expect(data).toHaveProperty('min');
      expect(data).toHaveProperty('max');
      expect(data).toHaveProperty('recommended');
      expect(data.min).toBeLessThanOrEqual(data.recommended);
      expect(data.recommended).toBeLessThanOrEqual(data.max);
    });

    it('should have lower leverage for higher timeframes', async () => {
      const [daily, hourly] = await Promise.all([
        request(app.getHttpServer()).get('/analysis/leverage/1d'),
        request(app.getHttpServer()).get('/analysis/leverage/1h'),
      ]);

      // Higher timeframe = lower leverage (more conservative)
      expect(daily.body.data.max).toBeLessThanOrEqual(hourly.body.data.max);
    });
  });

  describe('POST /analysis/leverage-recommendation', () => {
    it('should recommend appropriate leverage', async () => {
      const response = await request(app.getHttpServer())
        .post('/analysis/leverage-recommendation')
        .send({
          timeframe: '1h',
          checklistScore: 80,
          atr: 400,
          currentPrice: 28000,
          stopLossPercentage: 3,
          experienceLevel: 'intermediate',
        });
      
      expect([200, 201]).toContain(response.status);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data.recommended).toBeGreaterThanOrEqual(1);
      expect(data.recommended).toBeLessThanOrEqual(20);
      expect(data).toHaveProperty('conservative');
      expect(data).toHaveProperty('moderate');
      expect(data).toHaveProperty('aggressive');
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(data.conservative).toBeLessThanOrEqual(data.moderate);
      expect(data.moderate).toBeLessThanOrEqual(data.aggressive);
    });

    it('should cap leverage for beginners', async () => {
      const response = await request(app.getHttpServer())
        .post('/analysis/leverage-recommendation')
        .send({
          timeframe: '15m', // Short timeframe, normally high leverage
          checklistScore: 100,
          atr: 100,
          currentPrice: 28000,
          stopLossPercentage: 1,
          experienceLevel: 'beginner',
        });
      
      expect([200, 201]).toContain(response.status);

      // Beginner max is 3x regardless of other factors
      expect(response.body.data.recommended).toBeLessThanOrEqual(3);
    });
  });

  describe('GET /analysis/leverage-constraints', () => {
    it('should return leverage constraints for experience level', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/leverage-constraints')
        .query({
          experienceLevel: 'intermediate',
          timeframe: '4h',
        })
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('min');
      expect(data).toHaveProperty('max');
      expect(data.min).toBeLessThan(data.max);
    });

    it('should have different limits for different experience levels', async () => {
      const [beginner, expert] = await Promise.all([
        request(app.getHttpServer())
          .get('/analysis/leverage-constraints')
          .query({ experienceLevel: 'beginner', timeframe: '1h' }),
        request(app.getHttpServer())
          .get('/analysis/leverage-constraints')
          .query({ experienceLevel: 'expert', timeframe: '1h' }),
      ]);

      expect(beginner.body.data.max).toBeLessThan(expert.body.data.max);
    });
  });
});
