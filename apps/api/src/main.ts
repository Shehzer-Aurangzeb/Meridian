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

  // Swagger is mounted by SwaggerModule.setup, which sits OUTSIDE Nest's
  // guard chain — AuthGuard cannot protect it. Rather than bolt on basic-auth
  // middleware to guard a page nobody needs in production, it is simply not
  // mounted there. Set ENABLE_DOCS=true to get it back on a deployed
  // instance, deliberately and temporarily.
  const docsEnabled = env === 'local' || process.env.ENABLE_DOCS === 'true';

  if (docsEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Meridian API')
      .setDescription('Trading analysis API')
      .setVersion('1.0')
      .addTag('health', 'Health check endpoints')
      .addTag('auth', 'Login and credential check')
      .addTag('analyses', 'Run, list and read saved analyses')
      .addTag('risk-management', 'Risk management calculations')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
    });
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Meridian API running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(
    docsEnabled
      ? `📚 Swagger docs: http://localhost:${port}/docs`
      : '📚 Swagger docs: disabled (set ENABLE_DOCS=true to mount)',
  );
}

bootstrap();
