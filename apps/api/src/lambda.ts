import serverlessExpress from '@codegenie/serverless-express';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
  Handler,
} from 'aws-lambda';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, docsEnabled } from './configure-app';

/**
 * AWS Lambda entry point.
 *
 * ─── What a Lambda handler actually is ───────────────────────────────────
 * A plain exported function. AWS calls it with two arguments:
 *
 *   event    what happened — for an HTTP API, the request: method, path,
 *            headers, body, query string.
 *   context  facts about this invocation — request id, how many
 *            milliseconds of execution time remain, memory limit.
 *
 * Whatever the function returns becomes the HTTP response. There is no
 * server, no port, and nothing listening. AWS starts a container, calls the
 * function, and returns the value.
 *
 * ─── What serverless-express does ────────────────────────────────────────
 * Nest is an Express app underneath, and Express expects `(req, res)` objects
 * from a real socket. serverless-express translates: it converts the Lambda
 * event into a fake Express request, runs it through the app, and converts
 * the Express response back into the object Lambda wants. That is all it is —
 * an adapter between two calling conventions.
 *
 * ─── Why the app is cached outside the handler ───────────────────────────
 * This is the single most important line in the file.
 *
 * AWS keeps the container alive after an invocation and reuses it for the
 * next request — typically for minutes. Code at module scope (out here) runs
 * ONCE per container; code inside the handler runs on EVERY request.
 *
 * Booting Nest takes ~1-2 seconds: it constructs every service and resolves
 * the whole dependency graph. Doing that per request would add that to every
 * call. By caching the built handler in a module-scope variable, only the
 * FIRST request into a fresh container pays for it — that is the "cold
 * start" — and every subsequent one reuses it and answers in milliseconds.
 *
 * ─── One consequence worth knowing ───────────────────────────────────────
 * Because containers are reused, anything you put in a module-scope variable
 * survives between requests. That is exactly what makes this caching work,
 * and also why you must never store one user's data there.
 */
let cachedHandler: Handler | undefined;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create(AppModule);

  // Identical configuration to the local server — same validation, same CORS,
  // same guards. `docsEnabled` reads NODE_ENV, which in Lambda comes from the
  // function's environment variables, not from a .env file.
  configureApp(app, { docs: docsEnabled(process.env.NODE_ENV ?? 'production') });

  // `init()` instead of `listen()`: build the app, but do not open a port.
  // Nothing is listening in Lambda — AWS delivers the request as an argument.
  await app.init();

  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
  callback: Parameters<Handler>[2],
): Promise<APIGatewayProxyResultV2> => {
  // `??=` means "only if not already set", so the boot happens once per
  // container and every warm request skips straight to serving.
  cachedHandler ??= await bootstrap();
  return cachedHandler(event, context, callback) as Promise<APIGatewayProxyResultV2>;
};
