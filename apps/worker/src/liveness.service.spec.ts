import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LivenessService } from './liveness.service';

describe('LivenessService', () => {
  const testFile = join(tmpdir(), `worker-alive-test-${process.pid}`);
  let service: LivenessService;

  beforeEach(() => {
    process.env.LIVENESS_FILE = testFile;
    service = new LivenessService();
    if (existsSync(testFile)) unlinkSync(testFile);
  });

  afterEach(() => {
    service.onModuleDestroy();
    if (existsSync(testFile)) unlinkSync(testFile);
  });

  it('onModuleInit 后立即写一次 liveness file', () => {
    service.onModuleInit();
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, 'utf-8');
    expect(content).toMatch(/^\d+$/);
  });

  it('updateLiveness 写入当前时间戳到 liveness file', () => {
    const before = Math.floor(Date.now() / 1000);
    service.updateLiveness();
    expect(existsSync(testFile)).toBe(true);
    const content = parseInt(readFileSync(testFile, 'utf-8'), 10);
    expect(content).toBeGreaterThanOrEqual(before);
  });
});
