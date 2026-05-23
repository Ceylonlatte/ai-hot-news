import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadAuthConfig } from './auth.config';
import { AuthService, AUTH_CONFIG } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * SP-13 (2026-05-23): @Global so future modules can `@UseGuards(JwtAuthGuard)`
 * without re-importing AuthModule. The Guard depends only on AuthService
 * which is exported here.
 *
 * loadAuthConfig() is called eagerly at module construction time so
 * misconfiguration (missing JWT_SECRET / malformed bcrypt hash) crashes
 * the API at boot rather than at first login. Spec §0 Q12 fail-fast.
 */
@Global()
@Module({
  imports: [JwtModule.register({})], // secret passed per-call in AuthService
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
    AuthService,
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
