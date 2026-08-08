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
import { AnalyzeService } from './analysis-coordinator/analyze.service';
import { CoordinatorPersistenceService } from './analysis-coordinator/coordinator-persistence.service';
import { loadSecrets } from './load-secrets';

/**
 * AWS Lambda entry point.
 *
 * ─── What a Lambda handler actually is ───────────────────────────────────
 * A plain exported function. AWS calls it with two arguments:
 *
 *   event    what happened. For an HTTP request: method, path, headers, body.
 *            For a scheduled run: whatever the schedule was configured to send.
 *   context  facts about this invocation — request id, milliseconds remaining.
 *
 * Whatever the function returns becomes the response. There is no server and
 * no port. AWS starts a container, calls the function, returns the value.
 *
 * ─── One function, two kinds of event ────────────────────────────────────
 * This function is wired to two triggers: an HTTP API (you, or the frontend)
 * and a schedule (the cron that runs the analyses). They send DIFFERENT event
 * shapes, so the first thing the handler does is work out which one it got.
 *
 * That is the part of Lambda worth internalising: an event is just JSON, and
 * "HTTP request" is only one of many things it can describe.
 *
 * ─── Why the app is cached outside the handler ───────────────────────────
 * AWS keeps the container alive after an invocation and reuses it for the
 * next request, typically for minutes. Code out here at module scope runs
 * ONCE per container; code inside the handler runs on EVERY request.
 *
 * Booting Nest takes ~1-2 seconds — it constructs every service and resolves
 * the whole dependency graph. Caching it means only the FIRST request into a
 * fresh container pays that (the "cold start"); every one after answers in
 * milliseconds.
 */
let cachedApp: INestApplication | undefined;
let cachedHttp: Handler | undefined;

/** The event the schedule sends. Shape is ours — see the CDK stack. */
interface ScheduledEvent {
  scheduled: { symbols: string[] };
}

function isScheduled(event: unknown): event is ScheduledEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    Array.isArray((event as ScheduledEvent).scheduled?.symbols)
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
 * The scheduled run. Calls the service directly rather than making an HTTP
 * request to itself — that would pay a second invocation, a second cold
 * start, and need a credential to talk to its own API.
 *
 * Never throws: one bad symbol must not abort the rest of the batch, and a
 * scheduled invocation that throws gets retried by AWS, which would
 * re-analyse the symbols that already succeeded.
 */
async function runScheduled(event: ScheduledEvent): Promise<{
  saved: string[];
  failed: Record<string, string>;
}> {
  const app = await getApp();
  const analyzer = app.get(AnalyzeService);
  const persistence = app.get(CoordinatorPersistenceService);

  const saved: string[] = [];
  const failed: Record<string, string> = {};

  for (const symbol of event.scheduled.symbols) {
    try {
      const analysis = await analyzer.analyze(symbol);
      const { id } = await persistence.persistAnalysis(analysis);
      saved.push(`${symbol}:${id}`);
    } catch (err) {
      failed[symbol] = err instanceof Error ? err.message : String(err);
    }
  }

  // Returned so it lands in the CloudWatch log for the invocation.
  console.log(JSON.stringify({ saved, failed }));
  return { saved, failed };
}

export const handler = async (
  event: APIGatewayProxyEventV2 | ScheduledEvent,
  context: Context,
  callback: Parameters<Handler>[2],
): Promise<APIGatewayProxyResultV2 | { saved: string[]; failed: Record<string, string> }> => {
  if (isScheduled(event)) {
    return runScheduled(event);
  }

  if (!cachedHttp) {
    const app = await getApp();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHttp = serverlessExpress({ app: expressApp });
  }

  return cachedHttp(event, context, callback) as Promise<APIGatewayProxyResultV2>;
};
