import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let serviceMock: { getHealth: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    serviceMock = {
      getHealth: vi.fn().mockResolvedValue({
        ok: true,
        service: 'api',
        version: '0.0.1',
        uptime: 1.23,
        checks: { db: 'ok', redis: 'ok' },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: serviceMock }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('GET /health 返回 ok=true 含 db/redis 状态', async () => {
    const result = await controller.getHealth();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('api');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('ok');
    expect(serviceMock.getHealth).toHaveBeenCalledOnce();
  });
});
