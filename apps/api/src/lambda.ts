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
import { OutcomeScorerService } from './analysis-coordinator/outcome-scorer.service';
import { FlowCollectorService, type CollectResult } from './flow/flow-collector.service';
import { loadSecrets } from './load-secrets';

/**
 * Where AWS starts the app. There is no server and no port: AWS runs this
 * function, and whatever it returns is the response.
 *
 * Three different things trigger it — a web request, the timer that runs the
 * scheduled analyses, and the timer that saves the flow data — and they arrive
 * in different shapes, so the first job is working out which one this is.
 *
 * The app itself is built OUTSIDE the function on purpose. AWS reuses the
 * same container for several minutes, and anything out here runs once per
 * container instead of once per request. Starting the app takes a second or
 * two, so only the first request pays for it.
 */
let cachedApp: INestApplication | undefined;
let cachedHttp: Handler | undefined;

/** The event the schedule sends. Shape is ours — see the CDK stack. */
interface ScheduledEvent {
  scheduled: { symbols: string[] };
}

/** The daily flow collection. Same idea, different shape. */
interface CollectEvent {
  collect: { symbols: string[]; days?: number };
}

function isScheduled(event: unknown): event is ScheduledEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    Array.isArray((event as ScheduledEvent).scheduled?.symbols)
  );
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
 * The scheduled run. Calls the code directly rather than making a web request
 * to itself, which would cost a second startup and need its own credentials.
 *
 * Never fails outright: one bad coin must not stop the rest, and a failure
 * here makes AWS retry the whole batch, re-analysing the coins that worked.
 */
async function runScheduled(event: ScheduledEvent): Promise<{
  saved: string[];
  failed: Record<string, string>;
  scored: unknown;
}> {
  const app = await getApp();
  const analyzer = app.get(AnalyzeService);
  const persistence = app.get(CoordinatorPersistenceService);
  const scorer = app.get(OutcomeScorerService);

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

  // Then settle the outcomes. Only rows that can still move are touched — the
  // ones just created, plus whatever was PENDING or OPEN last time. Terminal
  // rows are never revisited, which is what keeps this a handful of requests
  // rather than one per analysis ever saved.
  //
  // Never fails the run: a scored outcome is a nicety, a saved analysis is not.
  let scored: unknown;
  try {
    scored = await scorer.scoreUnresolved();
  } catch (err) {
    scored = { error: err instanceof Error ? err.message : String(err) };
  }

  // Returned so it lands in the CloudWatch log for the invocation.
  console.log(JSON.stringify({ saved, failed, scored }));
  return { saved, failed, scored };
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
  event: APIGatewayProxyEventV2 | ScheduledEvent | CollectEvent,
  context: Context,
  callback: Parameters<Handler>[2],
): Promise<
  | APIGatewayProxyResultV2
  | { saved: string[]; failed: Record<string, string>; scored: unknown }
  | CollectResult
> => {
  if (isScheduled(event)) {
    return runScheduled(event);
  }

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
