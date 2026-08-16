/**
 * Loads passwords and API keys from AWS when the app starts.
 *
 * They are fetched at runtime rather than set as plain environment variables,
 * because the deployment files that would hold them are stored and viewable
 * in several places. Those files hold only the NAME of the secret; the app is
 * given permission to look up the value itself.
 *
 * Runs once per container, not per request. On a laptop it does nothing and
 * the values come from the local .env file instead, so there is one code path
 * for both.
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
