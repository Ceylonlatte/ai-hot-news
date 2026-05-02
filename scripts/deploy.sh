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

echo "==> Bringing up services (excluding caddy until 443 is free; see SP-0 deployment notes)"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE up -d --no-deps postgres redis api worker web

echo "==> Container status"
IMAGE_TAG="$IMAGE_TAG" $COMPOSE ps

echo "==> Done"
