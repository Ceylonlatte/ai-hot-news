#!/usr/bin/env bash
# Run on the VPS by GitHub Actions deploy.yml.
# Pre-condition: /srv/ai-hot-news exists and contains the repo + .env.

set -euo pipefail

REPO_DIR="/srv/ai-hot-news"
COMPOSE_FILE="docker/docker-compose.prod.yml"
IMAGE_TAG="${1:-latest}"

cd "$REPO_DIR"

echo "==> Pulling latest source"
git fetch origin main
git reset --hard origin/main

echo "==> Logging into GHCR"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

echo "==> Pulling latest images (tag=$IMAGE_TAG)"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" pull

echo "==> Running database migrations"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" run --rm \
  --entrypoint sh api -c "cd packages/db && npx prisma migrate deploy"

echo "==> Bringing up services"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" up -d

echo "==> Container status"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" ps

echo "==> Done"
