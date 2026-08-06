import * as dotenv from 'dotenv';

const env = process.env.NODE_ENV ?? 'local';
dotenv.config({ path: `.env.${env}` });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new PerformanceInterceptor());

  // CORS — env-driven, comma-separated. Required for SSE EventSource.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // x-api-key must be listed or the browser's preflight blocks it and every
    // request fails CORS rather than 401 — a confusing way to find out auth
    // is on.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'x-api-key',
    ],
    exposedHeaders: ['Content-Type', 'X-Request-Id'],
    maxAge: 86_400,
  });

  const config = new DocumentBuilder()
    .setTitle('Meridian API')
    .setDescription('Trading analysis API with AI-powered insights')
    .setVersion('1.0')
    .addTag('health', 'Health check endpoints')
    .addTag('analysis', 'Market analysis endpoints')
    .addTag('analysis-coordinator', 'Strategy coordination & SSE streaming')
    .addTag('risk-management', 'Risk management calculations')
    .addTag('performance', 'Performance tracking')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Meridian API running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`📚 Swagger docs: http://localhost:${port}/docs`);
  console.log(`📄 OpenAPI JSON: http://localhost:${port}/docs-json`);
}

bootstrap();
