import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('AdminController', () => {
  let controller: AdminController;
  let svcMock: {
    health: ReturnType<typeof vi.fn>;
    contentPool: ReturnType<typeof vi.fn>;
    feeder: ReturnType<typeof vi.fn>;
    keywordStats: ReturnType<typeof vi.fn>;
    dbSize: ReturnType<typeof vi.fn>;
    llmCost: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    svcMock = {
      health: vi.fn().mockResolvedValue({ apiOk: true }),
      contentPool: vi.fn().mockResolvedValue({}),
      feeder: vi.fn().mockResolvedValue({}),
      keywordStats: vi.fn().mockResolvedValue({}),
      dbSize: vi.fn().mockResolvedValue({}),
      llmCost: vi.fn().mockResolvedValue({}),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: svcMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AdminController);
  });

  const adminReq = { user: { sub: 'admin', role: 'ADMIN' } } as never;
  const nonAdminReq = { user: { sub: 'guest', role: 'VIEWER' } } as never;

  it('GET /admin/health delegates when role=ADMIN', async () => {
    await controller.health(adminReq);
    expect(svcMock.health).toHaveBeenCalledTimes(1);
  });

  it('GET /admin/health throws Forbidden when role !== ADMIN', async () => {
    await expect(controller.health(nonAdminReq)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(svcMock.health).not.toHaveBeenCalled();
  });

  it('GET /admin/health throws Forbidden when no user attached', async () => {
    await expect(
      controller.health({} as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('all 6 endpoints delegate to service when admin', async () => {
    await controller.contentPool(adminReq);
    await controller.feeder(adminReq);
    await controller.keywordStats(adminReq);
    await controller.dbSize(adminReq);
    await controller.llmCost(adminReq);
    expect(svcMock.contentPool).toHaveBeenCalledOnce();
    expect(svcMock.feeder).toHaveBeenCalledOnce();
    expect(svcMock.keywordStats).toHaveBeenCalledOnce();
    expect(svcMock.dbSize).toHaveBeenCalledOnce();
    expect(svcMock.llmCost).toHaveBeenCalledOnce();
  });
});
