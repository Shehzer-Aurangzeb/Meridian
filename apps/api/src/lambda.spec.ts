import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

/**
 * Calls the real handler with the event shape API Gateway actually sends.
 *
 * This is how a Lambda is tested without AWS: the handler is just a function,
 * so you call it with an event and assert on what it returns. No server, no
 * deploy, no `sam local` needed for the basics.
 *
 * What it proves: the app boots inside Lambda, routing works, the guard is
 * applied, and the response is shaped the way API Gateway requires. Those are
 * the four things that break first when moving a working app to Lambda.
 */
describe('lambda handler', () => {
  const event = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): APIGatewayProxyEventV2 =>
    ({
      version: '2.0',
      routeKey: '$default',
      rawPath: path,
      rawQueryString: '',
      headers: { 'content-type': 'application/json', ...headers },
      requestContext: {
        http: { method, path, protocol: 'HTTP/1.1', sourceIp: '1.2.3.4' },
      },
      isBase64Encoded: false,
    }) as unknown as APIGatewayProxyEventV2;

  // Lambda gives the handler a deadline. serverless-express does not use it,
  // but the type requires it and real code often does.
  const context = {
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 30_000,
  } as unknown as Context;

  // The guard refuses to construct without a key — including inside Lambda,
  // which is the point: a function deployed without its env vars must fail at
  // cold start, not serve unauthenticated traffic.
  beforeAll(() => {
    process.env.MERIDIAN_API_KEY ??= 'k'.repeat(32);
    process.env.NODE_ENV = 'test';
  });

  it('boots, routes, and returns an API Gateway response', async () => {
    const { handler } = await import('./lambda');

    const res = (await handler(
      event('GET', '/health/live'),
      context,
      () => undefined,
    )) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(200);
    // The response must be a plain object with statusCode/body — that is the
    // contract API Gateway parses. An Express response object would fail here.
    expect(typeof res.body).toBe('string');
  });

  it('still enforces auth — a Lambda is not a way around the guard', async () => {
    const { handler } = await import('./lambda');

    const res = (await handler(
      event('GET', '/analyses'),
      context,
      () => undefined,
    )) as { statusCode: number };

    expect(res.statusCode).toBe(401);
  });

  it('reuses the booted app across invocations (the warm path)', async () => {
    const { handler } = await import('./lambda');

    const first = Date.now();
    await handler(event('GET', '/health/live'), context, () => undefined);
    const firstMs = Date.now() - first;

    const second = Date.now();
    await handler(event('GET', '/health/live'), context, () => undefined);
    const secondMs = Date.now() - second;

    // Not a benchmark — just proof the second call did not re-boot Nest.
    // A cold boot is ~1000ms; a warm call is single-digit.
    expect(secondMs).toBeLessThanOrEqual(firstMs + 50);
    expect(secondMs).toBeLessThan(500);
  });
});
