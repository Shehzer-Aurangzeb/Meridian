import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * Coins the scheduled run analyses. Six runs a day across these is the cadence
 * the plan backtest supports: median time for price to reach a zone was 3h,
 * and 100% of fills happened within 24h.
 */
const SCHEDULED_SYMBOLS = ['BTC', 'ETH', 'SOL'];

export interface MeridianStackProps extends StackProps {
  /** Where the frontend is served from, for CORS. */
  corsOrigins: string;
}

/**
 * Everything Meridian needs in AWS, as code.
 *
 * CDK turns this TypeScript into a CloudFormation template — a JSON document
 * describing the desired end state. AWS then works out what to create,
 * change or delete to get there. Nothing here is imperative: you are not
 * saying "make a Lambda", you are saying "a Lambda like this should exist".
 *
 * That is the whole point of infrastructure-as-code. The alternative is
 * clicking through the console, which nobody can review, repeat, or roll
 * back — and which nobody remembers six months later.
 */
export class MeridianStack extends Stack {
  constructor(scope: Construct, id: string, props: MeridianStackProps) {
    super(scope, id, props);

    // ── Secrets ─────────────────────────────────────────────────────────
    // Created empty and filled in ONCE by hand (console or CLI). CDK never
    // sees the values, so they never reach the CloudFormation template.
    // The function gets read permission and fetches them at cold start.
    const secret = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: 'meridian/app',
      description:
        'MERIDIAN_API_KEY, MERIDIAN_TOKEN_SECRET, MERIDIAN_PASSWORD_HASH, ' +
        'DATABASE_URL, ANTHROPIC_API_KEY — set these by hand after first deploy',
      // Retained on stack deletion: losing MERIDIAN_TOKEN_SECRET logs everyone
      // out, and losing DATABASE_URL is worse.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── The function ────────────────────────────────────────────────────
    const api = new lambda.DockerImageFunction(this, 'Api', {
      // A container image, not a zip of bundled JavaScript.
      //
      // esbuild bundling was tried first and does not work here: Prisma's
      // client is GENERATED at install time, so there is nothing for the
      // bundler to resolve, and CDK offers no hook to run `prisma generate`
      // after its install step. A container just runs the same build you run
      // locally. See apps/api/Dockerfile.lambda.
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../..'), {
        file: 'apps/api/Dockerfile.lambda',
      }),

      // Memory also buys CPU on Lambda — they scale together. 1024MB is the
      // usual sweet spot for a Nest cold start: less is slower to boot, more
      // costs more per millisecond without booting much faster.
      memorySize: 1024,

      // One analysis takes ~700ms and the scheduled run does several in
      // sequence, plus a cold start. The HTTP route gives up at 30s anyway;
      // this ceiling is for the scheduled path.
      timeout: Duration.seconds(120),

      environment: {
        NODE_ENV: 'production',
        MERIDIAN_SECRET_ID: secret.secretName,
        CORS_ORIGINS: props.corsOrigins,
        // Keeps the AWS SDK's TCP connections alive between invocations.
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },

      // Without this, logs are kept forever and quietly cost money.
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // The execution role is how a Lambda is allowed to touch anything. This
    // grants exactly one permission: read that one secret. Nothing else.
    secret.grantRead(api);

    // ── HTTP front door ─────────────────────────────────────────────────
    // HTTP API, not REST API: cheaper, faster, and everything this needs.
    // Auth is the app's own AuthGuard, so no authorizer here — the guard
    // already covers the CLI and local development identically.
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'meridian',
      // CORS is handled inside the app (configure-app.ts) so that local and
      // deployed behave the same. Configuring it here too would mean two
      // places to change and one of them being wrong.
    });

    httpApi.addRoutes({
      // Every path goes to the one function, which routes internally. This is
      // called a "lambdalith". Splitting per route buys independent scaling
      // and per-route permissions, and costs a bundle per function and more
      // cold starts. At this size the single function is the right trade.
      path: '/{proxy+}',
      methods: [apigw.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', api),
    });

    // ── The schedule ────────────────────────────────────────────────────
    // Six times a day, every four hours. The event is a constant JSON object
    // of our own shape — Lambda events are just JSON, and `lambda.ts` checks
    // for this shape to tell a cron run from an HTTP request.
    new events.Rule(this, 'AnalysisSchedule', {
      description: `Run an analysis for ${SCHEDULED_SYMBOLS.join(', ')} every 4 hours`,
      schedule: events.Schedule.cron({ minute: '0', hour: '0/4' }),
      targets: [
        new targets.LambdaFunction(api, {
          event: events.RuleTargetInput.fromObject({
            scheduled: { symbols: SCHEDULED_SYMBOLS },
          }),
          // A failed scheduled run is not worth retrying: four hours later
          // the next one produces a fresher analysis anyway, and a retry
          // would re-analyse the symbols that already succeeded.
          retryAttempts: 0,
        }),
      ],
    });

    new CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'Base URL — put this in the frontend',
    });
    new CfnOutput(this, 'SecretName', {
      value: secret.secretName,
      description: 'Fill this in before the first request: aws secretsmanager put-secret-value',
    });
  }
}
