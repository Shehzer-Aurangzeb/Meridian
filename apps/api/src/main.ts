import * as dotenv from 'dotenv';

// Load environment variables based on NODE_ENV
const env = process.env.NODE_ENV ?? 'local';
dotenv.config({ path: `.env.${env}` });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';

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

  // Setup Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Meridian API')
    .setDescription('Trading analysis API with AI-powered insights')
    .setVersion('1.0')
    .addTag('health', 'Health check endpoints')
    .addTag('analysis', 'Market analysis endpoints')
    .addTag('risk-management', 'Risk management calculations')
    .addTag('performance', 'Performance tracking')
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
