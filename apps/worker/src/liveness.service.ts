import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { writeFileSync } from 'node:fs';

const DEFAULT_FILE = '/tmp/worker-alive';
const INTERVAL_MS = 30_000;

@Injectable()
export class LivenessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LivenessService.name);
  private timer?: NodeJS.Timeout;
  private readonly file = process.env.LIVENESS_FILE ?? DEFAULT_FILE;

  onModuleInit(): void {
    this.updateLiveness();
    this.timer = setInterval(() => this.updateLiveness(), INTERVAL_MS);
    this.logger.log(`Liveness writer started at ${this.file} (interval ${INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  updateLiveness(): void {
    try {
      writeFileSync(this.file, String(Math.floor(Date.now() / 1000)));
    } catch (err) {
      this.logger.error(`Failed to write liveness file ${this.file}`, err);
    }
  }
}
