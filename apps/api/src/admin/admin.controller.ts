import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminContentPoolDto,
  AdminDbSizeDto,
  AdminFeederDto,
  AdminHealthDto,
  AdminKeywordStatsDto,
  AdminLlmCostDto,
} from '@ai-hot-news/types';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Local-typed Request shape — matches what JwtAuthGuard attaches.
// V1 has only one role ('ADMIN') so 'user.role !== ADMIN' check is
// nominal; future SP-X multi-user adds editor/viewer roles to gate.
interface AuthRequest extends Request {
  user?: { sub: string; role: 'ADMIN' };
}

/**
 * SP-19 PR-B (2026-05-24): admin ops dashboard endpoints.
 *
 * All routes require an authenticated session (SP-13 JwtAuthGuard) AND
 * role=ADMIN. The role check is local to this controller rather than a
 * separate RolesGuard — V1 has one role; introducing the guard now would
 * be premature ceremony. When SP-X adds editor/viewer, promote to a
 * proper @Roles() decorator.
 *
 * Why all-GET: the admin views are read-only by design. Mutations live
 * on their feature controllers (keywords / users / settings).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('health')
  async health(@Req() req: AuthRequest): Promise<AdminHealthDto> {
    requireAdmin(req);
    return this.svc.health();
  }

  @Get('content-pool')
  async contentPool(@Req() req: AuthRequest): Promise<AdminContentPoolDto> {
    requireAdmin(req);
    return this.svc.contentPool();
  }

  @Get('feeder')
  async feeder(@Req() req: AuthRequest): Promise<AdminFeederDto> {
    requireAdmin(req);
    return this.svc.feeder();
  }

  @Get('keyword-stats')
  async keywordStats(@Req() req: AuthRequest): Promise<AdminKeywordStatsDto> {
    requireAdmin(req);
    return this.svc.keywordStats();
  }

  @Get('db-size')
  async dbSize(@Req() req: AuthRequest): Promise<AdminDbSizeDto> {
    requireAdmin(req);
    return this.svc.dbSize();
  }

  @Get('llm-cost')
  async llmCost(@Req() req: AuthRequest): Promise<AdminLlmCostDto> {
    requireAdmin(req);
    return this.svc.llmCost();
  }
}

function requireAdmin(req: AuthRequest): void {
  if (req.user?.role !== 'ADMIN') {
    throw new ForbiddenException('admin role required');
  }
}
