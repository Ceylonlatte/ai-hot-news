import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, AUTH_CONFIG, type AuthPayload } from './auth.service';
import { COOKIE_NAME, type AuthConfig } from './auth.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';

// SP-13: local request shape — see JwtAuthGuard for why we avoid module augmentation.
interface AuthRequest {
  user?: AuthPayload;
}

/**
 * SP-13 (2026-05-23): /auth/* endpoints.
 *
 * Three handlers:
 *   POST /auth/login   { username, password } → 200 + Set-Cookie + { ok, user }
 *   GET  /auth/me      → 200 { user } | 401
 *   POST /auth/logout  → 200 + clear cookie
 *
 * Cookie is HttpOnly + SameSite=Lax + Secure(prod). Lax not Strict because
 * Strict breaks any cross-origin GET that would carry the cookie, e.g.
 * coming back from an external OAuth provider (not in V1 but harmless to
 * leave room). XSRF in V1 is mitigated by SameSite=Lax + Web fetch never
 * sending the cookie to third-party origins.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; user: { username: string; role: 'ADMIN' } }> {
    const payload = await this.auth.validateCredentials(body.username, body.password);
    const token = this.auth.signToken(payload);
    res.cookie(COOKIE_NAME, token, this.cookieOptions());
    return { ok: true, user: { username: payload.sub, role: payload.role } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthRequest): { user: { username: string; role: 'ADMIN' } } {
    // JwtAuthGuard guarantees req.user is set when this handler runs.
    const u = req.user;
    if (!u) throw new UnauthorizedException(); // defensive — Guard should have thrown
    return { user: { username: u.sub, role: u.role } };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    // Clear cookie by setting to empty + immediate expiry. We don't gate
    // logout behind JwtAuthGuard — calling logout while already logged-
    // out should still succeed (idempotent) instead of returning 401.
    res.clearCookie(COOKIE_NAME, this.cookieOptions());
    return { ok: true };
  }

  /**
   * Cookie options shared across login + logout so the Set-Cookie
   * attributes match (otherwise some browsers won't replace/clear the
   * cookie). `maxAge` is computed from `JWT_EXPIRES_IN` env string —
   * for V1 we hardcode 7d (matches default jwtExpiresIn).
   */
  private cookieOptions(): {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    maxAge: number;
    domain?: string;
  } {
    const opts: ReturnType<typeof AuthController.prototype.cookieOptions> = {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.cookieSecure,
      path: '/',
      maxAge: 7 * 24 * 3600 * 1000,
    };
    if (this.cfg.cookieDomain) {
      opts.domain = this.cfg.cookieDomain;
    }
    return opts;
  }
}
