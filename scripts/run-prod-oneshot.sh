#!/usr/bin/env bash
# Run a one-shot tsx script (backfill / migration / repair) on prod, inside the
# worker image, using the SAME image tag that's currently serving prod traffic.
#
# Why worker image (not api): api is a NestJS standalone bundle that inlines
# @ai-hot-news/utils — there's no node_modules/@ai-hot-news/utils at runtime.
# worker keeps the pnpm symlink + packages/utils/dist, so tsx can resolve
# arbitrary SP-shaped imports (utils + db + types). See apps/worker/Dockerfile
# for the COPY layout.
#
# Why this wrapper: docker compose run for one-shot scripts has 3 footguns
# this script eliminates:
#   1. IMAGE_TAG drift — .env defaults to :latest, deploy.sh uses :sha-<commit>;
#      a typo'd manual IMAGE_TAG silently runs old code against new schema.
#      We auto-detect from the running worker container instead.
#   2. Postgres networking — without --no-deps, compose run brings up postgres
#      as a dependency (correct); with --no-deps, the container can't reach
#      the DB. We deliberately keep deps.
#   3. Ergonomic single-line invocation — wraps the entrypoint + cwd dance.
#
# Usage:
#   bash scripts/run-prod-oneshot.sh <cwd-rel-from-/app> <tsx-rel-path-from-cwd>
#
# Example (SP-4 backfill):
#   bash scripts/run-prod-oneshot.sh packages/db scripts/migrate-sp4.ts
#
# IMPORTANT: if the script mutates `hot_news` (or any table the worker also writes),
# stop the worker first to preserve the single-writer assumption that backfill
# scripts rely on for P2002 conflict resolution. Pre/post:
#   docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker
#   bash scripts/run-prod-oneshot.sh packages/db scripts/migrate-sp4.ts
#   docker compose -f docker/docker-compose.prod.yml --env-file .env start worker

set -euo pipefail

CWD_REL="${1:?usage: $0 <cwd-rel-from-/app> <tsx-rel-path-from-cwd>}"
SCRIPT_REL="${2:?usage: $0 <cwd-rel-from-/app> <tsx-rel-path-from-cwd>}"

COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE="./.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run from the repo root (e.g. /srv/ai-hot-news)." >&2
  exit 1
fi

# Ask docker for the worker's image (e.g. ghcr.io/.../worker:sha-abc123) and
# split off the tag. Format string is portable across docker compose v2.
#
# We use `ps -a` (not bare `ps`) on purpose: this script is documented to be
# run AFTER stopping the worker for any hot_news-mutating one-shot (single-
# writer assumption — see the docstring above and SP-4 §10 decision 11). With
# bare `ps`, a stopped worker is invisible and the lookup fails. `-a` finds
# both running and stopped containers, which is exactly what we need to read
# the deployed image tag without first restarting the worker.
RUNNING_IMAGE=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a --format '{{.Image}}' worker | head -n1 || true)

if [ -z "${RUNNING_IMAGE:-}" ]; then
  echo "ERROR: no 'worker' container found (running or stopped)." >&2
  echo "Hint: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps -a worker" >&2
  echo "If the worker has never been started, run \`scripts/deploy.sh\` first." >&2
  exit 1
fi

# Tag = everything after the last colon. Image refs may contain a registry port
# (e.g. registry:5000/foo:tag), so use parameter expansion to grab the suffix only.
RUNNING_TAG="${RUNNING_IMAGE##*:}"

if [ -z "$RUNNING_TAG" ] || [ "$RUNNING_TAG" = "$RUNNING_IMAGE" ]; then
  echo "ERROR: could not extract tag from running worker image '$RUNNING_IMAGE'." >&2
  exit 1
fi

echo "==> Worker is running with tag: $RUNNING_TAG"
echo "==> Will run '$SCRIPT_REL' (cwd /app/$CWD_REL) inside a one-shot worker:$RUNNING_TAG container"
echo "==> Reminder: stop worker first if this script mutates hot_news."
echo ""

IMAGE_TAG="$RUNNING_TAG" docker compose \
  --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  run --rm --entrypoint sh worker \
  -c "cd /app/$CWD_REL && npx tsx $SCRIPT_REL"
