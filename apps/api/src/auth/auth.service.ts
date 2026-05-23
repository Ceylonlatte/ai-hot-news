import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { AuthConfig } from './auth.config';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthPayload {
  /** username — also the JWT `sub`. V1 only one user (admin) so unique anyway. */
  sub: string;
  /** static role tag; allows future SP-X multi-user without breaking the JWT shape. */
  role: 'ADMIN';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
    private readonly jwt: JwtService,
  ) {}

  /**
   * SP-13: env-driven single-admin credential check.
   *
   * Why not constant-time username comparison: single-admin means an
   * attacker enumerating usernames learns nothing — only the password
   * matters. bcrypt.compare is already constant-time for the password.
   *
   * Always runs bcrypt.compare even when username is wrong, so wrong-
   * username and wrong-password take similar time (defense against
   * timing-based user enumeration if we later go multi-user).
   */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<AuthPayload> {
    const usernameOk = username === this.cfg.adminUsername;
    const passwordOk = await compare(password, this.cfg.adminPasswordHash);
    if (!usernameOk || !passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return { sub: username, role: 'ADMIN' };
  }

  /**
   * Sign + return a JWT for the given payload. Caller is responsible for
   * setting it as an HttpOnly cookie (see AuthController.login).
   */
  signToken(payload: AuthPayload): string {
    // expiresIn typed as `StringValue | number` upstream — pass as
    // unknown cast to keep the env string flexibility (7d / 30m / etc.)
    // without pinning the ms StringValue type chain across the codebase.
    return this.jwt.sign(payload, {
      secret: this.cfg.jwtSecret,
      expiresIn: this.cfg.jwtExpiresIn as unknown as number,
    });
  }

  /**
   * Verify a JWT, return the payload or throw UnauthorizedException.
   * Used by JwtAuthGuard and AuthController.me().
   */
  verifyToken(token: string): AuthPayload {
    try {
      return this.jwt.verify<AuthPayload>(token, {
        secret: this.cfg.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
