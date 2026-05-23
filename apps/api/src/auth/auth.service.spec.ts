import { describe, it, expect, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';
import type { AuthConfig } from './auth.config';

const PASSWORD = 'correct-horse-battery-staple';
const PASSWORD_HASH = hashSync(PASSWORD, 10); // dev-speed rounds for tests

const CFG: AuthConfig = {
  adminUsername: 'admin',
  adminPasswordHash: PASSWORD_HASH,
  jwtSecret: 'test-jwt-secret-must-be-at-least-32-chars-long',
  jwtExpiresIn: '7d',
  cookieSecure: false,
};

function makeService(): AuthService {
  const jwt = new JwtService({});
  return new AuthService(CFG, jwt);
}

describe('AuthService', () => {
  describe('validateCredentials', () => {
    let svc: AuthService;
    beforeEach(() => {
      svc = makeService();
    });

    it('returns { sub, role:ADMIN } on correct credentials', async () => {
      const result = await svc.validateCredentials('admin', PASSWORD);
      expect(result).toEqual({ sub: 'admin', role: 'ADMIN' });
    });

    it('throws UnauthorizedException on wrong password', async () => {
      await expect(svc.validateCredentials('admin', 'wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on wrong username', async () => {
      await expect(svc.validateCredentials('attacker', PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('always runs bcrypt.compare even with wrong username (timing-safe)', async () => {
      // Measure two failed attempts: wrong-username vs wrong-password.
      // Both should take similar wall time (both invoke bcrypt.compare).
      // Without this defense, wrong-username would return ~instantly
      // (skipping bcrypt) while wrong-password takes ~30-60ms — enabling
      // username enumeration via timing attack.
      //
      // bcryptjs.compare is a const export so we can't spy via vi.spyOn;
      // assert behaviorally instead: both timings are in the same order
      // of magnitude (both > 0.5ms, both < 200ms — i.e. neither is a
      // sub-millisecond early-return short-circuit).
      const t1 = performance.now();
      await svc.validateCredentials('wrong-user', 'whatever').catch(() => {});
      const wrongUserMs = performance.now() - t1;

      const t2 = performance.now();
      await svc.validateCredentials('admin', 'wrong-pass').catch(() => {});
      const wrongPwMs = performance.now() - t2;

      // Both should be > 0.5ms (bcrypt compare with rounds=10 ~= 30-60ms
      // on modern CPU; 0.5ms is a generous lower bound that catches the
      // "early-return without bcrypt" regression).
      expect(wrongUserMs).toBeGreaterThan(0.5);
      expect(wrongPwMs).toBeGreaterThan(0.5);
    });
  });

  describe('signToken / verifyToken roundtrip', () => {
    it('signs and verifies a payload back to original shape', () => {
      const svc = makeService();
      const token = svc.signToken({ sub: 'admin', role: 'ADMIN' });
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // header.payload.sig
      const decoded = svc.verifyToken(token);
      expect(decoded.sub).toBe('admin');
      expect(decoded.role).toBe('ADMIN');
    });

    it('verifyToken throws UnauthorizedException on tampered token', () => {
      const svc = makeService();
      const token = svc.signToken({ sub: 'admin', role: 'ADMIN' });
      const tampered = token.slice(0, -4) + 'xxxx';
      expect(() => svc.verifyToken(tampered)).toThrow(UnauthorizedException);
    });

    it('verifyToken throws on garbage input', () => {
      const svc = makeService();
      expect(() => svc.verifyToken('not.a.jwt')).toThrow(UnauthorizedException);
      expect(() => svc.verifyToken('')).toThrow(UnauthorizedException);
    });
  });
});
