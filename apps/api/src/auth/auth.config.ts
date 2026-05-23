/**
 * SP-13 (2026-05-23): runtime auth config loaded from env.
 *
 * Loaded eagerly at module init via AuthModule.forRoot so failures
 * (missing JWT_SECRET in prod, bad bcrypt hash format, etc.) crash
 * the API at startup rather than at first login attempt.
 *
 * Single-admin-account design: M5 是个人自用 read-only 网站，多用户
 * 体系不在 V1 范围内。schema 已预留 `User` 表（M0 SP-0），未来 SP-X
 * 多用户时把 admin 写进 User table 即可，guard / token shape 不变。
 *
 * Required prod env:
 *   ADMIN_USERNAME     — 登录用户名（默认 "admin"）
 *   ADMIN_PASSWORD_HASH — bcryptjs hash（$2a$/$2b$ 开头，rounds≥10）
 *   JWT_SECRET         — 至少 32 字节 random（生成：openssl rand -base64 48）
 *   JWT_EXPIRES_IN     — JWT 有效期（默认 "7d"）
 *   COOKIE_DOMAIN      — 可选，跨子域共享时设；单 host 不设
 *   COOKIE_SECURE      — "true" / "false"；prod 必须 true (https-only)
 */

export const COOKIE_NAME = 'ahn_session';

export interface AuthConfig {
  adminUsername: string;
  adminPasswordHash: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  cookieDomain?: string;
  cookieSecure: boolean;
}

const DEV_FALLBACK_HASH =
  // bcryptjs hash of "dev-password" rounds=10. Dev-only. Prod env必须显式设置。
  '$2a$10$LXdU0sNNxJzm0w8/W3kkfeg9KQqNJxMrHCxqzC6gE5N6OHylASkfa';

export function loadAuthConfig(): AuthConfig {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  const adminUsername = env.ADMIN_USERNAME?.trim() || 'admin';

  let adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? '';
  if (!adminPasswordHash) {
    if (isProd) {
      throw new Error(
        '[auth] ADMIN_PASSWORD_HASH must be set in production. ' +
          'Generate via: node -e "console.log(require(\'bcryptjs\').hashSync(\'YOUR_PASSWORD\', 12))"',
      );
    }
    adminPasswordHash = DEV_FALLBACK_HASH;
  }
  if (!/^\$2[abxy]\$\d{2}\$/.test(adminPasswordHash)) {
    throw new Error(
      `[auth] ADMIN_PASSWORD_HASH does not look like a bcryptjs hash (got prefix "${adminPasswordHash.slice(0, 7)}"). ` +
        'Expected "$2a$NN$" / "$2b$NN$" — generate via bcryptjs.hashSync(pw, 12).',
    );
  }

  let jwtSecret = env.JWT_SECRET?.trim() ?? '';
  if (!jwtSecret) {
    if (isProd) {
      throw new Error(
        '[auth] JWT_SECRET must be set in production. ' +
          'Generate via: openssl rand -base64 48',
      );
    }
    jwtSecret = 'dev-only-jwt-secret-do-not-use-in-prod-' + 'x'.repeat(32);
  }
  if (jwtSecret.length < 32) {
    throw new Error(
      `[auth] JWT_SECRET too short (${jwtSecret.length} chars). Need ≥32. Generate via: openssl rand -base64 48`,
    );
  }

  const jwtExpiresIn = env.JWT_EXPIRES_IN?.trim() || '7d';

  const cookieDomain = env.COOKIE_DOMAIN?.trim() || undefined;

  // Default secure=true in prod, false in dev. Allow explicit override
  // (e.g. local testing via http on a dev VPS would need COOKIE_SECURE=false).
  const cookieSecureRaw = env.COOKIE_SECURE?.trim().toLowerCase();
  const cookieSecure =
    cookieSecureRaw != null && cookieSecureRaw.length > 0
      ? cookieSecureRaw === 'true'
      : isProd;

  return {
    adminUsername,
    adminPasswordHash,
    jwtSecret,
    jwtExpiresIn,
    cookieDomain,
    cookieSecure,
  };
}
