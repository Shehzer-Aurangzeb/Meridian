import * as dotenv from 'dotenv';

const env = process.env.NODE_ENV ?? 'local';
dotenv.config({ path: `.env.${env}` });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, docsEnabled } from './configure-app';

/**
 * Local / container entry point: a normal long-running HTTP server.
 *
 * The AWS entry point is `lambda.ts`. Both share `configureApp` so the two
 * cannot drift; the only difference is that this one listens on a port.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const docs = docsEnabled(env);

  configureApp(app, { docs });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Meridian API running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(
    docs
      ? `📚 Swagger docs: http://localhost:${port}/docs`
      : '📚 Swagger docs: disabled (set ENABLE_DOCS=true to mount)',
  );
}

bootstrap();
