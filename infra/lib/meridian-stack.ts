import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Coins the scheduled run analyses.
 *
 * BTC and ETH as the majors, plus eight long-standing large caps chosen to
 * span different sectors — L1s, an oracle, a payments coin — rather than the
 * top eight by market cap. Highly correlated coins produce highly correlated
 * analyses, which is less information for the same cost.
 *
 * All ten verified to return a full 250-candle 12h history on Binance, which
 * is what the regime leg needs for its bandwidth percentile.
 *
 * Easy swaps if you want them: DOGE, ATOM, NEAR, ARB, OP, UNI, AAVE — all
 * checked and available.
 */
const SCHEDULED_SYMBOLS = [
  'BTC', 'ETH',
  'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC',
];

/**
 * How often the schedule fires. Every 8 hours — 00:00, 08:00, 16:00 UTC.
 *
 * The measured constraint (STATE_OF_PLAY.md 14h, 582 trades): price reaches
 * a zone in a median of 3h, 82% within 12h, 100% within 24h. So an analysis
 * older than a day is finished, and 8h spacing keeps every run well inside
 * that window while producing 30 analyses a day across ten coins.
 *
 * Going wider costs something specific: at 12h spacing, roughly half of what
 * you open will already have filled or stopped. That is still fine for the
 * forward-test record — the outcome badge says what happened — but worse for
 * deciding whether to take a trade now.
 *
 * Crypto trades 24/7, so there is no session to align to.
 */
const SCHEDULE_HOURS = '0/8';

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
        // Pinned, not inherited from whatever machine runs the build. An
        // Apple Silicon laptop produces arm64 and a GitHub x86 runner
        // produces amd64; whichever does not match the function's
        // `architecture` below fails at INIT with Runtime.InvalidEntrypoint —
        // 3ms, 11MB, no logs, because Node never starts. Pinning both sides
        // makes the artifact identical wherever it is built.
        platform: ecr_assets.Platform.LINUX_ARM64,
      }),

      // Graviton: ~20% cheaper per ms than x86, and native on an Apple
      // Silicon machine so local builds need no emulation. CI runners are
      // x86, so the workflow sets up QEMU to cross-build.
      architecture: lambda.Architecture.ARM_64,

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
      description: `Analyse ${SCHEDULED_SYMBOLS.length} coins every 8 hours`,
      schedule: events.Schedule.cron({ minute: '0', hour: SCHEDULE_HOURS }),
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

    // ── CI deploy role ──────────────────────────────────────────────────
    // GitHub Actions assumes this role using an OIDC token it signs for each
    // job. No AWS access keys exist in the repository, so there is nothing to
    // leak and nothing to rotate — the credentials expire with the job.
    //
    // `githubRepo` lives in cdk.json, NOT on the command line. It used to be
    // passed as `-c githubRepo=...`, which made this block conditional on a
    // flag the CI deploy did not pass — so the first CI deploy synthesised a
    // template WITHOUT the role, and CloudFormation dutifully deleted the role
    // that deploy had just authenticated with. It worked exactly once and then
    // destroyed its own credentials. Context that the stack cannot be correct
    // without does not belong in an argument someone has to remember.
    const githubRepo = this.node.tryGetContext('githubRepo') as string | undefined;
    if (githubRepo) {
      const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
      });

      const deployRole = new iam.Role(this, 'GithubDeployRole', {
        roleName: 'meridian-github-deploy',
        assumedBy: new iam.WebIdentityPrincipal(
          provider.openIdConnectProviderArn,
          {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              // Pinned to main. Without this condition ANY branch — including
              // one opened by a fork's pull request — could assume the role
              // and deploy. This single line is the difference between "CI can
              // deploy" and "anyone who opens a PR can deploy".
              'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:ref:refs/heads/main`,
            },
          },
        ),
      });

      // Not AdministratorAccess. CDK deploys by assuming the roles that
      // `cdk bootstrap` created, so permission to assume those is all CI
      // needs — the bootstrap roles already carry the real privileges.
      deployRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
        }),
      );

      new CfnOutput(this, 'GithubDeployRoleArn', {
        value: deployRole.roleArn,
        description: 'Put this in the repo secret AWS_DEPLOY_ROLE_ARN',
      });
    }

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
