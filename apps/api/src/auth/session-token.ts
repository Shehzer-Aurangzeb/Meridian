import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

/**
 * Password verification and signed session tokens, on node crypto alone.
 *
 * ─── Why not JWT ─────────────────────────────────────────────────────────
 * Nothing outside this API ever reads these tokens. JWT's value is that a
 * THIRD party can validate one — an API Gateway authorizer, another service,
 * an OIDC consumer. With a single self-issued HMAC token that value is zero,
 * and what remains is JWT's failure surface: the `alg` header. Libraries have
 * repeatedly been talked into accepting `alg: none`, or into verifying an
 * RS256 token as HS256 using the public key as the HMAC secret.
 *
 * This format has no algorithm field to confuse. The signature is always
 * HMAC-SHA256 over the exact bytes that follow the version prefix, and
 * anything that does not verify under that one rule is rejected. Swap this
 * for @nestjs/jwt the day something else has to validate a token.
 *
 *   v1.<base64url payload>.<base64url signature>
 *
 * ─── Revocation ──────────────────────────────────────────────────────────
 * Stateless: there is no session store to check, so a token is valid until it
 * expires. Rotating MERIDIAN_TOKEN_SECRET invalidates every outstanding token
 * at once, which is the logout-everywhere button. Per-token revocation needs
 * a store and is not worth it for one user.
 */

const VERSION = 'v1';
const SCRYPT_KEYLEN = 64;
const b64url = (b: Buffer): string => b.toString('base64url');

export interface SessionPayload {
  /** Expiry, epoch seconds. */
  exp: number;
}

/** `scrypt$<saltHex>$<hashHex>` — the value of MERIDIAN_PASSWORD_HASH. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

export function signSession(
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const payload: SessionPayload = {
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${VERSION}.${body}.${sig}`;
}

/**
 * Returns the payload, or null for ANY failure — bad shape, bad signature,
 * expired, unparseable. A caller that cannot tell those apart cannot leak
 * which one it was.
 */
export function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  const [, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  const presented = Buffer.from(sig, 'base64url');
  // Length-check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString(),
    ) as SessionPayload;
    if (typeof payload?.exp !== 'number') return null;
    if (payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

// Run directly to generate the env values:
//   npx ts-node src/auth/session-token.ts 'my password'
if (require.main === module) {
  const password = process.argv[2];
  if (!password) {
    console.error("usage: ts-node src/auth/session-token.ts '<password>'");
    process.exit(1);
  }
  console.log(`MERIDIAN_PASSWORD_HASH="${hashPassword(password)}"`);
  console.log(`MERIDIAN_TOKEN_SECRET="${randomBytes(32).toString('hex')}"`);
}
