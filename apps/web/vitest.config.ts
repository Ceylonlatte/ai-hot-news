import { defineConfig } from 'vitest/config';
import path from 'node:path';

// SP-10 PR-B (2026-05-21): first vitest infra for apps/web — implicit debt
// from SP-4.5 (`test: echo 'no tests yet (P4)'`) cleared here so PR-B / PR-C
// can ship spec'd client components and pure URL helpers with TDD coverage.
// Config mirrors packages/ui — same jsdom + RTL + jest-dom matchers stack so
// future cross-package shared test helpers stay portable.
//
// `esbuild.jsx: 'automatic'` enables the React 17+ jsx-runtime transform so
// spec files don't need to `import React from 'react'` (Next.js apps default
// to this transform; tsconfig `jsx: 'preserve'` is interpreted by Next itself,
// not vitest's esbuild).
//
// `resolve.alias['@']` mirrors the tsconfig `paths: { '@/*': ['./*'] }` so
// production imports like `@/lib/api` resolve in tests (vitest doesn't read
// tsconfig paths by default).
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
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
