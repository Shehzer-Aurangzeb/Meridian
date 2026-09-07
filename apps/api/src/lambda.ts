import serverlessExpress from '@codegenie/serverless-express';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
  Handler,
} from 'aws-lambda';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, docsEnabled } from './configure-app';
import { FlowCollectorService, type CollectResult } from './flow/flow-collector.service';
import { loadSecrets } from './load-secrets';

/**
 * Where AWS starts the app. There is no server and no port: AWS runs this
 * function, and whatever it returns is the response.
 *
 * Two different things trigger it — a web request, and the timer that saves
 * the flow data — and they arrive in different shapes, so the first job is
 * working out which one this is.
 *
 * The scheduled-analysis path was removed on 6 September 2026 with the trade
 * planner it existed to run. Its EventBridge rule is gone from the CDK stack;
 * End State A's next scheduled job will save calibrated state rather than
 * plans, and will arrive as its own event shape.
 *
 * The app itself is built OUTSIDE the function on purpose. AWS reuses the
 * same container for several minutes, and anything out here runs once per
 * container instead of once per request. Starting the app takes a second or
 * two, so only the first request pays for it.
 */
let cachedApp: INestApplication | undefined;
let cachedHttp: Handler | undefined;

/** The daily flow collection. Same idea, different shape. */
interface CollectEvent {
  collect: { symbols: string[]; days?: number };
}

function isCollect(event: unknown): event is CollectEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    Array.isArray((event as CollectEvent).collect?.symbols)
  );
}

async function getApp(): Promise<INestApplication> {
  if (!cachedApp) {
    // Secrets first: AuthGuard reads MERIDIAN_API_KEY in its constructor and
    // refuses to boot without it, so they must be in place before Nest starts.
    await loadSecrets();

    const app = await NestFactory.create(AppModule);
    // Identical configuration to the local server — same validation, same
    // CORS, same guards.
    configureApp(app, {
      docs: docsEnabled(process.env.NODE_ENV ?? 'production'),
    });
    // `init()`, not `listen()`: build the app but do not open a port. Nothing
    // listens in Lambda; AWS hands the request over as an argument.
    await app.init();
    cachedApp = app;
  }
  return cachedApp;
}

/**
 * The daily flow collection. Separate from the analysis schedule because it is
 * a different job on a different clock: this one is racing Binance's 30-day
 * retention, and losing a day of it cannot be undone later.
 */
async function runCollect(event: CollectEvent): Promise<CollectResult> {
  const app = await getApp();
  const collector = app.get(FlowCollectorService);
  return collector.collect(event.collect.symbols, event.collect.days);
}

export const handler = async (
  event: APIGatewayProxyEventV2 | CollectEvent,
  context: Context,
  callback: Parameters<Handler>[2],
): Promise<
  | APIGatewayProxyResultV2
  | { saved: string[]; failed: Record<string, string>; scored: unknown }
  | CollectResult
> => {

  if (isCollect(event)) {
    return runCollect(event);
  }

  if (!cachedHttp) {
    const app = await getApp();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHttp = serverlessExpress({ app: expressApp });
  }

  return cachedHttp(event, context, callback) as Promise<APIGatewayProxyResultV2>;
};
