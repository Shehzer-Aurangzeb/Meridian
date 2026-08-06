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
 * The single authentication point. Two credentials, one door.
 *
 *   Authorization: Bearer <session token>   humans, from POST /auth/login
 *   x-api-key: <key>                        machines, the scheduler
 *
 * ─── Why two ─────────────────────────────────────────────────────────────
 * They fail differently. A session token expires and is issued against a
 * password, so it can live in a browser without the password ever being
 * there. A static key never expires, which is exactly what a cron needs and
 * exactly what a browser must not hold — anything shipped to a browser is
 * readable in devtools, and a static key read there is permanent access.
 *
 * ─── Global, not per-controller ──────────────────────────────────────────
 * Registered once as APP_GUARD in AppModule. A guard applied per-controller
 * protects the controllers someone remembered, and the next route added is
 * open by default. Here the default is closed and `@Public()` is the
 * deliberate, greppable exception.
 *
 * ─── Fail closed ─────────────────────────────────────────────────────────
 * A missing MERIDIAN_API_KEY throws at BOOT. "No key configured means auth is
 * off" is the standard way a guard like this ends up protecting nothing,
 * usually found after a deploy where the env var was never set.
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
