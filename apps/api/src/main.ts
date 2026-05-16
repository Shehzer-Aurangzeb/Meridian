import * as dotenv from 'dotenv';

// Load environment variables based on NODE_ENV
const env = process.env.NODE_ENV ?? 'local';
dotenv.config({ path: `.env.${env}` });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PerformanceInterceptor } from './interceptors/performance.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable performance monitoring
  app.useGlobalInterceptors(new PerformanceInterceptor());

  // Enable CORS for frontend communication
  app.enableCors({
    origin: 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Meridian API running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
}

bootstrap();
