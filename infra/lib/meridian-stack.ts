import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
// `aws-events` and `aws-events-targets` went with the two schedules this stack
// used to carry. Both are re-added when End State A has something worth running
// on a timer.
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

// SCHEDULED_SYMBOLS and SCHEDULE_HOURS were removed with the analysis schedule
// on 5 September 2026. The ten-coin universe and the measured basis for the
// 8-hour spacing (price reaches a zone in a median of 3h, 82% within 12h) are
// recorded in docs/BRIEFING_FOR_REVIEW.md 1.2, so nothing is lost by not
// keeping them as unused constants here.

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

    // ── The analysis schedule — SWITCHED OFF 5 September 2026 ──────────
    //
    // There was a rule here that ran `AnalyzeService` against ten coins every
    // eight hours and saved the result to `CoordinatorRun`. It is gone because
    // the thing it was measuring has been cancelled.
    //
    // Those runs were the live forward test of the trade planner: a zone, an
    // entry ladder, a stop and targets, scored later by `OutcomeScorerService`
    // in R-multiples. Twenty pre-registered tests have now closed the
    // directional programme — the planner loses at zero fee (−0.0476R
    // resolved), and the twentieth test showed that even correctly forecasting
    // the SIZE of the next move does not make its direction payable. See
    // `docs/evidence/README.md` and `docs/evidence/MAGNITUDE_GATE.md`.
    //
    // Continuing to record would have kept accumulating evidence about a
    // product that will not ship, and every row written after the decision
    // would have had to be excluded from anything later anyway.
    //
    // THE RECORD WAS PRESERVED FIRST. 843 rows spanning 2026-08-09 to
    // 2026-09-06, all scored, 488 carrying a net R — dumped from Neon to
    // `~/meridian-archive/coordinator-run-20260905.sql` before this rule was
    // removed. Ending the series was a decision; losing it would have been an
    // accident.
    //
    // The lambda's scheduled-event handler stays, and so does `AnalyzeService`.
    // Nothing invokes them on a schedule any more. Meridian's next scheduled
    // job belongs to End State A, and it will save calibrated state rather than
    // trade plans — see `docs/PRODUCT_LAYERS.md`.

    // ── The flow collector — SWITCHED OFF 5 September 2026 ─────────────
    //
    // There was a daily rule here that collected eight futures-flow metrics
    // into `FlowSample`. It is gone, and the reason is not cost.
    //
    // `FlowSample` reached 29.4 million rows and had ZERO production consumers.
    // Nothing in `src/` ever read one — only research scripts did. Nineteen
    // pre-registered tests have now been run against that data and none cleared
    // its bar; the strongest result, cross-venue price dislocation at |t| = 9.77,
    // is worth one to two basis points against a fourteen basis point fee. See
    // `docs/evidence/README.md`.
    //
    // Turning it off is nearly free to reverse. Six of the eight metrics are
    // republished by `data.binance.vision` back to 2021-12, and `fundingRate`
    // and `premium` have years of history on their live endpoints, so all eight
    // minus one can be refetched to any depth whenever they are wanted again.
    //
    // The exception is `takerBuySellRatio1h`, which has ~30 days of live
    // retention and no archive column — the one series that could not have been
    // recovered. The 9,350 rows Neon held (2026-07-28 to 2026-09-05) were copied
    // into the local database before this rule was removed. It is also the only
    // correct source for an hourly taker feature: averaging the 5-minute ratios
    // is 13.9% off at the median and 67.3% at worst.
    //
    // `FlowCollectorService` and the lambda's `collect` handler both stay. They
    // are what `scripts/flow-backfill.ts` uses, and they are how a manual
    // one-off would be run. Nothing invokes them on a schedule any more.

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
