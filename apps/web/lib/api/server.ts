/**
 * Server-side API client for BFF routes
 * 
 * This client is used by Next.js API routes to communicate with the backend.
 * It runs on the server only and keeps the backend URL hidden from the client.
 */

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Server-side fetch wrapper for backend calls
 */
export async function backendFetch<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { body, ...restOptions } = options;
  
  const response = await fetch(`${BACKEND_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...restOptions,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.message || `Backend error: ${response.status}`,
      response.status,
      errorData
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;
  
  return JSON.parse(text) as T;
}

/**
 * Create SSE stream URL for client-side EventSource
 */
export function getStreamUrl(endpoint: string, params: Record<string, string>): string {
  const url = new URL(`${BACKEND_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}
