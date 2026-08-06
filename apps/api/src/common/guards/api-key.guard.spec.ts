import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

const KEY = 'a'.repeat(32);

const ctx = (headers: Record<string, string>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

const guardWith = (isPublic = false): ApiKeyGuard => {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  return new ApiKeyGuard(reflector);
};

describe('ApiKeyGuard', () => {
  const original = process.env.MERIDIAN_API_KEY;
  beforeEach(() => {
    process.env.MERIDIAN_API_KEY = KEY;
  });
  afterAll(() => {
    process.env.MERIDIAN_API_KEY = original;
  });

  it('refuses to construct without a key — unset must never mean auth off', () => {
    delete process.env.MERIDIAN_API_KEY;
    expect(() => guardWith()).toThrow(/MERIDIAN_API_KEY is missing/);
  });

  it('refuses a key short enough to guess', () => {
    process.env.MERIDIAN_API_KEY = 'short';
    expect(() => guardWith()).toThrow(/16 characters/);
  });

  it('accepts the key in either header form', () => {
    expect(guardWith().canActivate(ctx({ 'x-api-key': KEY }))).toBe(true);
    expect(guardWith().canActivate(ctx({ authorization: `Bearer ${KEY}` }))).toBe(
      true,
    );
  });

  it('rejects a missing, wrong, or wrong-length key', () => {
    const guard = guardWith();
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-api-key': 'b'.repeat(32) }))).toThrow(
      UnauthorizedException,
    );
    // A different LENGTH must be rejected by value. timingSafeEqual throws on
    // unequal buffers, which is why both sides are hashed first.
    expect(() => guard.canActivate(ctx({ 'x-api-key': 'b' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(ctx({ 'x-api-key': KEY + 'x' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a bare Authorization header that is not a Bearer token', () => {
    expect(() => guardWith().canActivate(ctx({ authorization: KEY }))).toThrow(
      UnauthorizedException,
    );
  });

  it('lets a @Public() route through with no key at all', () => {
    expect(guardWith(true).canActivate(ctx({}))).toBe(true);
  });
});
