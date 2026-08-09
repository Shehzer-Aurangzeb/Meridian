import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Health & History E2E Tests', () => {
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

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      // Status can be 'ok', 'degraded', or 'healthy' depending on services
      expect(['ok', 'degraded', 'healthy']).toContain(response.body.status);
    });
  });

  describe('GET /', () => {
    it('should return API info', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('running');
    });
  });

  describe('GET /analysis/history', () => {
    it('should return analysis history', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/history')
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('analyses');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.analyses)).toBe(true);
      expect(typeof data.total).toBe('number');
    });

    it('should support limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/history')
        .query({ limit: 5 })
        .expect(200);

      const { data } = response.body;
      expect(data.analyses.length).toBeLessThanOrEqual(5);
    });

    it('should support date filtering', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/history')
        .query({
          startDate: '2024-01-01',
          endDate: '2025-12-31',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /analysis/history/:coin', () => {
    it('should return history for specific coin', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/history/BTC')
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('analyses');
      expect(data).toHaveProperty('coin');
      expect(data.coin).toBe('BTC');
    });
  });

  describe('GET /analysis/performance', () => {
    it('should return performance metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/performance')
        .expect(200);

      const { success, data } = response.body;

      expect(success).toBe(true);
      expect(data).toHaveProperty('recentAnalyses');
    });
  });

  describe('GET /analysis/validate/:coin', () => {
    it('should return indicator validation data', async () => {
      const response = await request(app.getHttpServer())
        .get('/analysis/validate/BTC')
        .query({ timeframe: '1h' })
        .expect(200);

      // Check response structure - can succeed or fail gracefully
      if (response.body.success) {
        expect(response.body.data).toHaveProperty('symbol');
        expect(response.body.data).toHaveProperty('indicators');
        expect(response.body.data).toHaveProperty('instructions');
      } else {
        // If validation fails, should have error message
        expect(response.body).toHaveProperty('error');
      }
    }, 15000);
  });
});
