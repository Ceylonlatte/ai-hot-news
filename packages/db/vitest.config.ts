import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: true,
    setupFiles: ['./test/setup-env.ts'],
  },
});
