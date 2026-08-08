#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MeridianStack } from '../lib/meridian-stack';

/**
 * The CDK entry point. `cdk deploy` runs this file, which describes the
 * stack, turns it into a CloudFormation template, and hands it to AWS.
 *
 * Region matters more than usual here: `api.binance.com` returns HTTP 451 to
 * US IP ranges. Verify from the region you intend to use BEFORE deploying —
 * see docs/DEPLOYMENT_PLAN.md. Override with:
 *
 *   cdk deploy -c region=eu-central-1 -c corsOrigins=https://your.vercel.app
 */
const app = new cdk.App();

const region = app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION;
const corsOrigins =
  app.node.tryGetContext('corsOrigins') ?? 'http://localhost:3000';

new MeridianStack(app, 'MeridianStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  corsOrigins,
  description: 'Meridian API — Lambda + HTTP API + scheduled analyses',
});
