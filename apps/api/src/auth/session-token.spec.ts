import {
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
} from './session-token';

const SECRET = 'x'.repeat(32);
const NOW = 1_770_000_000_000; // fixed clock; Date.now() would make this flaky
const HOUR = 3_600_000;

describe('password hashing', () => {
  it('accepts the right password and rejects the wrong one', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts, so the same password never hashes the same way twice', () => {
    expect(hashPassword('same')).not.toEqual(hashPassword('same'));
  });

  it('rejects a malformed or truncated stored hash instead of throwing', () => {
    expect(verifyPassword('p', 'garbage')).toBe(false);
    expect(verifyPassword('p', 'scrypt$abc')).toBe(false);
    expect(verifyPassword('p', 'bcrypt$aa$bb')).toBe(false);
    // Right shape, wrong digest length — timingSafeEqual would throw on this.
    expect(verifyPassword('p', `scrypt$aa$${'bb'.repeat(8)}`)).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips and carries an expiry', () => {
    const token = signSession(SECRET, 3600, NOW);
    expect(verifySession(token, SECRET, NOW)?.exp).toBe(NOW / 1000 + 3600);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(SECRET, 3600, NOW);
    expect(verifySession(token, 'y'.repeat(32), NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession(SECRET, 3600, NOW);
    expect(verifySession(token, SECRET, NOW + HOUR + 1000)).toBeNull();
    // Exactly at expiry is expired, not valid.
    expect(verifySession(token, SECRET, NOW + HOUR)).toBeNull();
  });

  it('rejects a tampered payload — the whole point of signing it', () => {
    const token = signSession(SECRET, 1, NOW);
    const [v, , sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifySession(`${v}.${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [
      '',
      'v1',
      'v1.a',
      'v1.a.b.c',
      'v2.a.b',
      'not.a.token',
      'v1..',
      `v1.${'a'.repeat(20)}.${'b'.repeat(20)}`,
    ]) {
      expect(verifySession(bad, SECRET, NOW)).toBeNull();
    }
  });

  it('has no algorithm field to confuse — a stripped signature is not valid', () => {
    // The JWT `alg: none` class of bug, checked directly.
    const [v, body] = signSession(SECRET, 3600, NOW).split('.');
    expect(verifySession(`${v}.${body}.`, SECRET, NOW)).toBeNull();
  });
});
