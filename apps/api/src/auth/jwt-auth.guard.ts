import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, type AuthPayload } from './auth.service';
import { COOKIE_NAME } from './auth.config';

/**
 * SP-13 (2026-05-23): protect any endpoint with `@UseGuards(JwtAuthGuard)`.
 *
 * Reads the JWT from the `ahn_session` cookie (set by /auth/login),
 * verifies signature + expiry via AuthService, and attaches the
 * decoded payload to `request.user` for downstream `@Req()` use.
 *
 * SP-13 itself attaches this guard to ZERO endpoints — list / detail /
 * stats stay public (read-only). Future SP-14 / SP-15 will use it on
 * keyword CRUD + monitor management routes.
 *
 * We don't augment `express.Request` globally — instead we type the
 * minimal shape we need locally (cookies + user). Express 5's module
 * structure makes `declare module 'express-serve-static-core'` brittle.
 */

interface AuthRequest {
  cookies?: Record<string, string>;
  user?: AuthPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.[COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('No session cookie');
    }
    req.user = this.auth.verifyToken(token);
    return true;
  }
}
