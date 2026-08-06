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

/**
 * Mark a route reachable without a key. Health and liveness only — an uptime
 * check that needs a secret is not a liveness check.
 */
export const IS_PUBLIC = 'meridian:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

const ENV_VAR = 'MERIDIAN_API_KEY';

/**
 * Shared-secret auth for a single-user tool.
 *
 *   x-api-key: <key>          or      Authorization: Bearer <key>
 *
 * ─── Why a shared secret and not JWTs ────────────────────────────────────
 * There is one user and no user table. Sessions, refresh tokens and a
 * password reset flow would all be machinery guarding a door only one person
 * ever walks through. Upgrade path if that changes: swap this guard for
 * @nestjs/passport — the registration point (APP_GUARD) does not move.
 *
 * ─── Fail closed ─────────────────────────────────────────────────────────
 * A missing MERIDIAN_API_KEY throws at BOOT rather than disabling auth.
 * "No key configured means everything is allowed" is the single most common
 * way an API key guard ends up protecting nothing — usually discovered after
 * a deploy where the env var was never set.
 *
 * ─── Constant-time comparison ────────────────────────────────────────────
 * Both sides are SHA-256'd before `timingSafeEqual`, which requires equal
 * lengths and THROWS otherwise. Hashing first makes the buffers fixed-width,
 * so a wrong-length key is rejected by value rather than by an exception —
 * and the length of the real key does not leak through the error path.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(private readonly reflector: Reflector) {
    const key = process.env[ENV_VAR];
    if (!key || key.length < 16) {
      throw new Error(
        `${ENV_VAR} is missing or shorter than 16 characters. The API refuses ` +
          `to start without it — an unset key must never mean "auth off". ` +
          `Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    this.expected = createHash('sha256').update(key).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-api-key'];
    const bearer = request.headers.authorization;

    const presented =
      (typeof header === 'string' && header) ||
      (typeof bearer === 'string' && bearer.startsWith('Bearer ')
        ? bearer.slice(7)
        : '');

    if (!presented) {
      throw new UnauthorizedException('Missing API key');
    }

    const candidate = createHash('sha256').update(presented).digest();
    if (!timingSafeEqual(candidate, this.expected)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
