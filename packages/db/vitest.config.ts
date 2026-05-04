import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: true,
    setupFiles: ['./test/setup-env.ts'],
    // All specs in this package run integration tests against ONE shared
    // Postgres. SP-4.5 introduced cleanup-rss-pre-window.spec which globally
    // deletes RSS rows older than 7d — that races with migrate-sp4.spec
    // creating RSS rows with backdated publishedAt. Force sequential file
    // execution so specs can't clobber each other's rows.
    fileParallelism: false,
  },
});
