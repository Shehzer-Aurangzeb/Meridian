import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, backendFetch, SESSION_COOKIE } from '@/lib/api/server';

interface LoginResult {
  token: string;
  /** Seconds. */
  expiresIn: number;
}

/** POST /api/auth/login — the token goes into the cookie, never the response. */
export async function POST(request: NextRequest) {
  const { password } = (await request.json().catch(() => ({}))) as {
    password?: unknown;
  };

  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  try {
    const { token, expiresIn } = await backendFetch<LoginResult>('/auth/login', {
      method: 'POST',
      body: { password },
      auth: false,
    });

    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      // A `secure` cookie is silently dropped over http, which on localhost
      // looks exactly like a wrong password.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Login failed:', error);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
