import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Server-side backend client. The browser never calls the API directly, so the
 * session token stays in an httpOnly cookie, BACKEND_URL stays off the wire,
 * and CORS never comes up.
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export { SESSION_COOKIE };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** False for the backend's `@Public()` routes: /health and /auth/login. */
  auth?: boolean;
}

export async function backendFetch<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const { body, auth = true, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string> | undefined),
  };

  if (auth) {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) throw new ApiError('Not signed in', 401);
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BACKEND_URL}${endpoint}`, {
    ...rest,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Freshness is computed against the live price; a cached response would
    // show a stale verdict.
    cache: 'no-store',
  });

  const text = await response.text();
  const data: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(errorMessage(data, response.status), response.status, data);
  }

  return data as T;
}

/**
 * Uniform error shape for every BFF route.
 *
 * Clearing the cookie on 401 is what stops an expired token looping: middleware
 * lets you in on the cookie merely existing, so it has to go for the next
 * navigation to reach sign-in.
 */
export async function proxy<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) cookies().delete(SESSION_COOKIE);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Backend unreachable:', error);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Nest puts the useful text in `message`, as a string or an array. */
function errorMessage(data: unknown, status: number): string {
  const message = (data as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return `Backend error: ${status}`;
}
