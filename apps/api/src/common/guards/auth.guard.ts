import { createHash, timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verifySession } from '../../auth/session-token';

/**
 * Mark a route reachable without a credential. Health, the banner, and the
 * login route itself — nothing else. An uptime check that needs a secret is
 * not an uptime check, and a login that needs a login cannot be used.
 */
export const IS_PUBLIC = 'meridian:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

const KEY_VAR = 'MERIDIAN_API_KEY';
const SECRET_VAR = 'MERIDIAN_TOKEN_SECRET';

/**
 * The single place logins are checked. Two ways in, one door:
 *
 *   Authorization: Bearer <token>   a person, after logging in
 *   x-api-key: <key>                the scheduler
 *
 * Two, because they fail differently. A session token expires, so it is safe
 * in a browser. A fixed key never expires, which is what a scheduled job
 * needs and exactly what a browser must never hold — anything sent to a
 * browser can be read out of it.
 *
 * Applied to everything at once rather than route by route, so a new route is
 * protected by default and only an explicit `@Public()` opens it.
 *
 * A missing key stops the app at STARTUP. "No key set means no checking" is
 * the usual way something like this ends up protecting nothing.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly expectedKey: Buffer;

  constructor(private readonly reflector: Reflector) {
    const key = process.env[KEY_VAR];
    if (!key || key.length < 16) {
      throw new Error(
        `${KEY_VAR} is missing or shorter than 16 characters. The API refuses ` +
          `to start without it — an unset key must never mean "auth off". ` +
          `Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    // Hashed once at boot so the comparison below is fixed-width.
    this.expectedKey = createHash('sha256').update(key).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'];
    const authorization = request.headers.authorization;
    const bearer =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';

    if (!bearer && typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing credentials');
    }

    // Session token first: it is what a browser sends, so it is the common
    // path. A bearer value that is not a valid session falls through to the
    // key check, which lets a machine caller use either header.
    const secret = process.env[SECRET_VAR];
    if (bearer && secret && verifySession(bearer, secret)) return true;

    const presented = typeof apiKey === 'string' && apiKey ? apiKey : bearer;
    if (presented) {
      const candidate = createHash('sha256').update(presented).digest();
      if (timingSafeEqual(candidate, this.expectedKey)) return true;
    }

    throw new UnauthorizedException('Invalid or expired credentials');
  }
}
