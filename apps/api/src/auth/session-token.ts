import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

/**
 * Login checking and signed session tokens, using only built-in crypto.
 *
 *   v1.<payload>.<signature>
 *
 * Deliberately not the usual JWT format. JWT exists so OTHER systems can
 * check a token, which nothing here needs, and its flexible "which algorithm"
 * field has been the source of repeated security holes. This format has no
 * such field: one signing method, and anything that does not match is
 * rejected. Switch to JWT the day another system has to read these.
 *
 * There is no list of active sessions, so a token stays valid until it
 * expires. Changing the signing secret logs everyone out at once.
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

// Set or reset the password:
//   pnpm --filter api set-password 'my password'
//
// There is nothing to "recover" — a scrypt hash is one-way, so a forgotten
// password is replaced, never read back.
if (require.main === module) {
  const password = process.argv[2];
  if (!password) {
    console.error("usage: pnpm --filter api set-password '<password>'");
    process.exit(1);
  }

  console.log(`MERIDIAN_PASSWORD_HASH="${hashPassword(password)}"`);
  console.log();
  // Printed separately, and only on request: this used to be emitted beside
  // the hash every run, and pasting both while resetting a password signs
  // every browser out — the two rotate for different reasons.
  if (process.argv.includes('--new-secret')) {
    console.log(`MERIDIAN_TOKEN_SECRET="${randomBytes(32).toString('hex')}"`);
    console.log('# Replacing this ends every existing session.');
  } else {
    console.log('# Keep your existing MERIDIAN_TOKEN_SECRET.');
    console.log('# Pass --new-secret to rotate it too, which signs out every browser.');
  }
}
