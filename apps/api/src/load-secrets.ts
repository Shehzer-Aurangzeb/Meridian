/**
 * Pull secrets from AWS Secrets Manager into `process.env` at cold start.
 *
 * ─── Why not just put them in the Lambda's environment variables ─────────
 * Because CDK would then write them into the CloudFormation template, and
 * that template is stored in S3, visible in the console, and usually
 * committed or logged somewhere. Secrets in an infrastructure template are
 * secrets in plaintext.
 *
 * So the template holds only the NAME of a secret. The function is granted
 * permission to read it, and fetches the value at runtime. This is the
 * standard AWS pattern and the reason Lambda execution roles exist.
 *
 * ─── Cost ────────────────────────────────────────────────────────────────
 * One API call per container, not per request — it runs inside the same
 * cached bootstrap as Nest. At six scheduled runs a day this is free.
 *
 * ─── Local development ───────────────────────────────────────────────────
 * If MERIDIAN_SECRET_ID is unset (any laptop), this does nothing and the
 * values come from .env.local as before. Deployed, it is set by the CDK
 * stack. One code path, two environments, no branching in the app itself.
 */
export async function loadSecrets(): Promise<void> {
  const secretId = process.env.MERIDIAN_SECRET_ID;
  if (!secretId) return;

  // Imported lazily and by name so bundlers leave it alone: the AWS SDK v3 is
  // already present in the Lambda runtime, so shipping a copy would only make
  // the artifact bigger and slower to cold start.
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );

  if (!response.SecretString) {
    throw new Error(`Secret ${secretId} has no string value`);
  }

  const values = JSON.parse(response.SecretString) as Record<string, string>;

  // Does not overwrite anything already set, so a deliberate per-function
  // override in the CDK stack still wins over the shared secret.
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value;
  }
}
