import { defineConfig } from 'vitest/config';

// SP-10 PR-B (2026-05-21): first vitest infra for apps/web — implicit debt
// from SP-4.5 (`test: echo 'no tests yet (P4)'`) cleared here so PR-B / PR-C
// can ship spec'd client components and pure URL helpers with TDD coverage.
// Config mirrors packages/ui — same jsdom + RTL + jest-dom matchers stack so
// future cross-package shared test helpers stay portable.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['@testing-library/jest-dom/vitest'],
    include: [
      'app/**/*.spec.{ts,tsx}',
      'lib/**/*.spec.{ts,tsx}',
    ],
  },
});
