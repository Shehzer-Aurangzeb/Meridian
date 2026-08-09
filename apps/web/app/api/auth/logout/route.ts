import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/api/server';

/**
 * POST /api/auth/logout
 *
 * Nothing to revoke server-side — sessions are signed values, not rows. A
 * stolen token stays valid until it expires.
 */
export async function POST() {
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
