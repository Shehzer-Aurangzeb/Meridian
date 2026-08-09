/**
 * Browser-side fetch for the /api routes. Same-origin, so no base URL and no
 * token to attach — the httpOnly cookie rides along on its own.
 */

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      (data as { error?: string } | undefined)?.error ??
      `Request failed: ${response.status}`;
    throw new RequestError(message, response.status);
  }

  return data as T;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof RequestError && error.status === 401;
}
