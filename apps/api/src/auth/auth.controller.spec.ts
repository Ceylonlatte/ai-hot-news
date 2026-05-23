import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService, AUTH_CONFIG, type AuthPayload } from './auth.service';

// Local shape mirrors the one in auth.controller.ts — both intentionally
// avoid express module augmentation (express 5 brittle, see Guard comment).
interface AuthRequest {
  user?: AuthPayload;
}
import { COOKIE_NAME, type AuthConfig } from './auth.config';

const PASSWORD = 'pw';
const PASSWORD_HASH = hashSync(PASSWORD, 10);

const CFG: AuthConfig = {
  adminUsername: 'admin',
  adminPasswordHash: PASSWORD_HASH,
  jwtSecret: 'test-jwt-secret-must-be-at-least-32-chars-long',
  jwtExpiresIn: '7d',
  cookieSecure: false,
};

function makeMockRes(): Response & {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
} {
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
  return res as unknown as Response & typeof res;
}

describe('AuthController', () => {
  let controller: AuthController;
  let auth: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: CFG },
        AuthService,
        JwtService,
      ],
    }).compile();
    controller = module.get(AuthController);
    auth = module.get(AuthService);
  });

  describe('POST /auth/login', () => {
    it('200 + Set-Cookie + { ok, user } on correct credentials', async () => {
      const res = makeMockRes();
      const result = await controller.login(
        { username: 'admin', password: PASSWORD },
        res,
      );
      expect(result).toEqual({ ok: true, user: { username: 'admin', role: 'ADMIN' } });
      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [name, token, opts] = res.cookie.mock.calls[0]!;
      expect(name).toBe(COOKIE_NAME);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
      expect(opts).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // CFG.cookieSecure = false in this test
        path: '/',
      });
      expect(opts.maxAge).toBe(7 * 24 * 3600 * 1000);
    });

    it('401 on wrong password (cookie NOT set)', async () => {
      const res = makeMockRes();
      await expect(
        controller.login({ username: 'admin', password: 'wrong' }, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/me', () => {
    it('returns { user } when req.user is set (Guard would set this)', () => {
      const req: AuthRequest = { user: { sub: 'admin', role: 'ADMIN' } };
      const result = controller.me(req);
      expect(result).toEqual({ user: { username: 'admin', role: 'ADMIN' } });
    });

    it('throws UnauthorizedException defensively when req.user missing', () => {
      const req: AuthRequest = {};
      expect(() => controller.me(req)).toThrow(UnauthorizedException);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the session cookie and returns { ok:true }', () => {
      const res = makeMockRes();
      const result = controller.logout(res);
      expect(result).toEqual({ ok: true });
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      const [name, opts] = res.clearCookie.mock.calls[0]!;
      expect(name).toBe(COOKIE_NAME);
      // Same shape as login's cookie() — required for some browsers to
      // actually replace/clear the existing cookie.
      expect(opts).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    });

    it('idempotent — calling logout twice does not throw', () => {
      const res = makeMockRes();
      expect(() => controller.logout(res)).not.toThrow();
      expect(() => controller.logout(res)).not.toThrow();
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
  });

  // Ensure AuthService.signToken is wired (smoke that JwtModule provides JwtService)
  it('AuthService.signToken is callable via DI (smoke)', () => {
    expect(typeof auth.signToken({ sub: 'admin', role: 'ADMIN' })).toBe('string');
  });
});
