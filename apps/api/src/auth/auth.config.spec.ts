import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadAuthConfig } from './auth.config';

const ENV_KEYS = [
  'NODE_ENV',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'COOKIE_DOMAIN',
  'COOKIE_SECURE',
] as const;

describe('loadAuthConfig', () => {
  let backup: Record<string, string | undefined>;

  beforeEach(() => {
    backup = {};
    for (const k of ENV_KEYS) {
      backup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  });

  describe('dev defaults', () => {
    it('uses dev fallback hash + dev jwt secret when env unset', () => {
      const cfg = loadAuthConfig();
      expect(cfg.adminUsername).toBe('admin');
      expect(cfg.adminPasswordHash).toMatch(/^\$2[ab]\$10\$/);
      expect(cfg.jwtSecret.length).toBeGreaterThanOrEqual(32);
      expect(cfg.jwtExpiresIn).toBe('7d');
      expect(cfg.cookieSecure).toBe(false);
      expect(cfg.cookieDomain).toBeUndefined();
    });

    it('honors ADMIN_USERNAME override', () => {
      process.env.ADMIN_USERNAME = 'shinpei';
      expect(loadAuthConfig().adminUsername).toBe('shinpei');
    });

    it('trims ADMIN_USERNAME whitespace', () => {
      process.env.ADMIN_USERNAME = '  shinpei  ';
      expect(loadAuthConfig().adminUsername).toBe('shinpei');
    });

    it('honors JWT_EXPIRES_IN override', () => {
      process.env.JWT_EXPIRES_IN = '30d';
      expect(loadAuthConfig().jwtExpiresIn).toBe('30d');
    });
  });

  describe('prod fail-fast', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('throws when JWT_SECRET missing in prod', () => {
      process.env.ADMIN_PASSWORD_HASH = '$2b$12$' + 'a'.repeat(53);
      expect(() => loadAuthConfig()).toThrow(/JWT_SECRET must be set in production/);
    });

    it('throws when ADMIN_PASSWORD_HASH missing in prod', () => {
      process.env.JWT_SECRET = 'x'.repeat(48);
      expect(() => loadAuthConfig()).toThrow(/ADMIN_PASSWORD_HASH must be set in production/);
    });

    it('passes when all required env are set', () => {
      process.env.ADMIN_PASSWORD_HASH = '$2b$12$' + 'a'.repeat(53);
      process.env.JWT_SECRET = 'x'.repeat(48);
      const cfg = loadAuthConfig();
      expect(cfg.adminUsername).toBe('admin');
      expect(cfg.cookieSecure).toBe(true);
    });
  });

  describe('bcrypt hash validation', () => {
    it('throws on malformed ADMIN_PASSWORD_HASH (not $2[abxy]$NN$)', () => {
      process.env.ADMIN_PASSWORD_HASH = 'plain-password';
      expect(() => loadAuthConfig()).toThrow(/does not look like a bcryptjs hash/);
    });

    it('accepts $2a$ prefix', () => {
      process.env.ADMIN_PASSWORD_HASH = '$2a$10$' + 'a'.repeat(53);
      expect(() => loadAuthConfig()).not.toThrow();
    });

    it('accepts $2b$ prefix', () => {
      process.env.ADMIN_PASSWORD_HASH = '$2b$12$' + 'a'.repeat(53);
      expect(() => loadAuthConfig()).not.toThrow();
    });

    it('accepts $2y$ prefix (some legacy hashes)', () => {
      process.env.ADMIN_PASSWORD_HASH = '$2y$12$' + 'a'.repeat(53);
      expect(() => loadAuthConfig()).not.toThrow();
    });
  });

  describe('JWT secret length', () => {
    it('throws when JWT_SECRET < 32 chars (even in dev)', () => {
      process.env.JWT_SECRET = 'too-short';
      expect(() => loadAuthConfig()).toThrow(/JWT_SECRET too short/);
    });

    it('accepts exactly 32 chars', () => {
      process.env.JWT_SECRET = 'x'.repeat(32);
      expect(() => loadAuthConfig()).not.toThrow();
    });
  });

  describe('cookieSecure', () => {
    it('defaults true in prod, false in dev', () => {
      delete process.env.NODE_ENV;
      expect(loadAuthConfig().cookieSecure).toBe(false);
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_PASSWORD_HASH = '$2b$12$' + 'a'.repeat(53);
      process.env.JWT_SECRET = 'x'.repeat(48);
      expect(loadAuthConfig().cookieSecure).toBe(true);
    });

    it('COOKIE_SECURE=false forces off even in prod', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_PASSWORD_HASH = '$2b$12$' + 'a'.repeat(53);
      process.env.JWT_SECRET = 'x'.repeat(48);
      process.env.COOKIE_SECURE = 'false';
      expect(loadAuthConfig().cookieSecure).toBe(false);
    });

    it('COOKIE_SECURE=true forces on even in dev', () => {
      process.env.COOKIE_SECURE = 'true';
      expect(loadAuthConfig().cookieSecure).toBe(true);
    });
  });
});
