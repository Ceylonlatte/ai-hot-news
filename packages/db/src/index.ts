import { PrismaClient } from './generated';

let prismaInstance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

export type { PrismaClient } from './generated';
export * from './generated';

// SP-10.5 (2026-05-21): re-export cleanup-aged pure function so worker module
// can import via package name (`'@ai-hot-news/db'`) instead of relative path —
// keeps SP-4 §10 decision 11 contract (一次性脚本 + 包名 import).
// The scripts/cleanup-aged.ts is a thin entrypoint wrapper that calls into
// this same module.
export { cleanupAged } from './cleanup-aged';
export type { CleanupAgedOptions, CleanupAgedResult } from './cleanup-aged';
