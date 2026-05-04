# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules
COPY . .
RUN pnpm --filter @ai-hot-news/db build
RUN pnpm --filter @ai-hot-news/utils build
RUN pnpm --filter @ai-hot-news/worker build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/worker/package.json apps/worker/package.json
COPY --from=builder /app/packages/db/package.json packages/db/package.json
COPY --from=builder /app/packages/types/package.json packages/types/package.json
COPY --from=builder /app/packages/utils/package.json packages/utils/package.json
COPY --from=builder /app/apps/worker/dist apps/worker/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/prisma packages/db/prisma
# One-shot scripts (e.g. SP-4 migrate-sp4.ts, future SP-7 pgvector backfill).
# Lives in worker image (not api) because: api is a NestJS standalone bundle
# that inlines @ai-hot-news/utils, so its runtime has no node_modules/@ai-hot-news/utils
# to resolve. worker has packages/utils/dist + the symlink, so `npx tsx` can
# resolve all SP-4-shaped imports. Invoked via scripts/run-prod-oneshot.sh
# (single-writer assumption: stop worker before running anything that mutates hot_news).
COPY --from=builder /app/packages/db/scripts packages/db/scripts
COPY --from=builder /app/packages/types/src packages/types/src
COPY --from=builder /app/packages/utils/dist packages/utils/dist
RUN pnpm install --prod --frozen-lockfile --filter @ai-hot-news/worker...

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD test "$(($(date +%s) - $(cat /tmp/worker-alive 2>/dev/null || echo 0)))" -lt 90 || exit 1
CMD ["node", "apps/worker/dist/main"]
