import { Injectable } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import Redis from 'ioredis';

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  uptime: number;
  checks: {
    db: 'ok' | 'fail';
    redis: 'ok' | 'fail';
  };
}

@Injectable()
export class HealthService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async getHealth(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    return {
      ok: db === 'ok' && redis === 'ok',
      service: 'api',
      version: process.env.npm_package_version ?? '0.0.1',
      uptime: process.uptime(),
      checks: { db, redis },
    };
  }

  private async checkDb(): Promise<'ok' | 'fail'> {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async checkRedis(): Promise<'ok' | 'fail'> {
    try {
      await this.redis.connect().catch(() => undefined);
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }
}
