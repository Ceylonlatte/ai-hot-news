#!/usr/bin/env bash
# Dev-only: TRUNCATE all crawled data + reseed source_configs.
#
# Use cases:
#   - Cleaning out stale rows after a long dev session
#   - Verifying cold-start behaviour for a new SP (RSS, HN, Reddit, ...)
#   - Reproducing prod-like "clean baseline" before manual smoke
#
# Pre-requisite: dev compose is running (`docker compose -f docker/docker-compose.dev.yml up -d`)
# and Node 22 + pnpm install have been run at least once on this clone.
#
# After this script:
#   hot_news = 0 rows
#   keyword_hits = 0 rows (cascaded from hot_news)
#   source_configs = freshly seeded (RSS + HN entries from packages/db/prisma/seed.ts)
#   raw_crawled_items, etc. = preserved (not truncated; treat as cold history)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.dev.yml"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy from .env.example and fill in dev creds." >&2
  exit 1
fi

# shellcheck source=/dev/null
set -a; . "$ENV_FILE"; set +a

PG_CONTAINER="ai-hot-news-postgres-dev"

if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  echo "==> Postgres container '$PG_CONTAINER' not running. Starting dev compose..."
  docker compose -f "$COMPOSE_FILE" up -d postgres
  echo "==> Waiting for postgres to be healthy..."
  until docker inspect --format='{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null | grep -q healthy; do
    sleep 1
  done
fi

echo "==> Counting current rows..."
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT 'hot_news' AS tbl, count(*) FROM hot_news UNION ALL SELECT 'keyword_hits', count(*) FROM keyword_hits UNION ALL SELECT 'source_configs', count(*) FROM source_configs;"

echo ""
read -r -p "TRUNCATE hot_news CASCADE + delete source_configs and reseed? [y/N] " confirm
case "$confirm" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Aborted."; exit 0 ;;
esac

echo "==> TRUNCATE hot_news CASCADE (cascades to keyword_hits)..."
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE hot_news CASCADE;"

echo "==> DELETE FROM source_configs (preserves table; seed will re-upsert)..."
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM source_configs;"

echo "==> Reseeding via prisma..."
cd "$REPO_ROOT"
pnpm db:seed

echo "==> Final counts:"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT 'hot_news' AS tbl, count(*) FROM hot_news UNION ALL SELECT 'keyword_hits', count(*) FROM keyword_hits UNION ALL SELECT 'source_configs', count(*) FROM source_configs;"

echo ""
echo "Done. Restart 'pnpm dev' to backfill via the worker."
