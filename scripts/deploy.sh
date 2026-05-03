#!/usr/bin/env bash
# Run on the VPS by GitHub Actions deploy.yml.
# Pre-condition: /srv/ai-hot-news exists and contains the repo + .env.

set -euo pipefail

REPO_DIR="/srv/ai-hot-news"
COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/.env"
IMAGE_TAG="${1:-latest}"

cd "$REPO_DIR"

# docker compose 从 -f 文件所在目录找 .env，而我们的 .env 在仓库根。
# 用 --env-file 显式指定，避免变量被解析为空字符串导致 invalid reference format。
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

echo "==> Pulling latest source"
git fetch origin main
git reset --hard origin/main

# GHCR 镜像随 public 仓库自动 public，docker pull 无需登录。
# 若以后改 private 包，恢复 docker login：
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

echo "==> Pulling latest images (tag=$IMAGE_TAG)"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE pull

echo "==> Running database migrations"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE run --rm \
  --entrypoint sh api -c "cd packages/db && npx prisma migrate deploy"

# Seed runs every deploy (idempotent: upsert on RSS, findFirst+update-or-create on HN).
# Required so new SourceConfig rows added to packages/db/prisma/seed.ts (e.g. SP-2's
# HN top/ask/show) actually land in prod without manual intervention. Existing rows
# are preserved with their current `enabled` / `crawlInterval` overrides.
echo "==> Seeding source configs (idempotent)"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE run --rm \
  --entrypoint sh api -c "cd packages/db && npx prisma db seed"

echo "==> Bringing up services (excluding caddy until 443 is free; see SP-0 deployment notes)"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE up -d --no-deps postgres redis api worker web

# Worker needs an explicit restart to re-read source_configs after seed inserts
# new rows (e.g. SP-2's three HN platforms). `up -d` is a no-op when the image
# digest didn't change, which is the common case for re-deploys without code
# changes (e.g. re-running deploy after a seed-only patch). Restart is cheap
# (~3s) and idempotent — onModuleInit runs obliterate + register again.
echo "==> Restarting worker to pick up newly-seeded sources"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE restart worker

echo "==> Container status"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE ps

echo "==> Done"
