import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth(): Promise<HealthResponse> {
    return this.health.getHealth();
  }
}
