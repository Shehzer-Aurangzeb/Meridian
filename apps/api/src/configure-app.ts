import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';

/**
 * Everything applied to the Nest app that is NOT "start listening".
 *
 * Extracted so `main.ts` (a normal server) and `lambda.ts` (AWS) configure the
 * app identically. If these two drifted, the API would validate, CORS, or
 * authenticate differently in production than it does on your laptop — and
 * that difference would only ever be discovered in production.
 *
 * The only real difference between the two entry points is the last line:
 * a server calls `app.listen(port)`, Lambda calls `app.init()` and hands the
 * app to the runtime instead.
 */
export function configureApp(
  app: INestApplication,
  opts: { docs: boolean },
): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new PerformanceInterceptor());

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
  // mounted there.
  if (opts.docs) {
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
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  }
}

/** Docs are for local development; a deployed instance opts in explicitly. */
export function docsEnabled(env: string): boolean {
  return env === 'local' || process.env.ENABLE_DOCS === 'true';
}
