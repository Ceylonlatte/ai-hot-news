import { describe, it, expect, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { COOKIE_NAME, type AuthConfig } from './auth.config';

const CFG: AuthConfig = {
  adminUsername: 'admin',
  adminPasswordHash: hashSync('pw', 10),
  jwtSecret: 'test-jwt-secret-must-be-at-least-32-chars-long',
  jwtExpiresIn: '7d',
  cookieSecure: false,
};

function makeContext(cookies: Record<string, string> | undefined): ExecutionContext {
  const req: { cookies?: Record<string, string>; user?: unknown } = { cookies };
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => req as T,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let auth: AuthService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    auth = new AuthService(CFG, new JwtService({}));
    guard = new JwtAuthGuard(auth);
  });

  it('throws UnauthorizedException when no cookie present', () => {
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when cookie present but ahn_session missing', () => {
    const ctx = makeContext({ other: 'value' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws on invalid jwt in cookie', () => {
    const ctx = makeContext({ [COOKIE_NAME]: 'garbage' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true + attaches user to req on valid token', () => {
    const token = auth.signToken({ sub: 'admin', role: 'ADMIN' });
    const cookies = { [COOKIE_NAME]: token };
    const ctx = makeContext(cookies);
    const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    // JWT verify auto-adds iat/exp claims — assert only the fields we care about.
    expect(req.user).toMatchObject({ sub: 'admin', role: 'ADMIN' });
  });
});
