#!/usr/bin/env bash
# Local dev one-shot bootstrap.
#
# Usage:
#   bash scripts/dev-up.sh setup    # Fresh-clone bootstrap: env + install + docker + migrate + seed
#   bash scripts/dev-up.sh start    # Daily startup: ensure docker is up, then run pnpm dev (foreground)
#   bash scripts/dev-up.sh          # Same as `start`
#
# Designed to be re-runnable. Existing .env is preserved, node_modules is reused
# (pnpm install is a noop when lockfile is up-to-date), Postgres is left running
# if already healthy, and prisma migrate / seed are themselves idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.dev.yml"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
PG_CONTAINER="ai-hot-news-postgres-dev"
REDIS_CONTAINER="ai-hot-news-redis-dev"

MODE="${1:-start}"
case "$MODE" in
  setup|start) ;;
  *) echo "ERROR: unknown mode '$MODE'. Use 'setup' or 'start'." >&2; exit 2 ;;
esac

cd "$REPO_ROOT"

c_red()   { printf '\033[31m%s\033[0m' "$*"; }
c_green() { printf '\033[32m%s\033[0m' "$*"; }
c_blue()  { printf '\033[34m%s\033[0m' "$*"; }
c_dim()   { printf '\033[2m%s\033[0m' "$*"; }
step()    { printf '\n%s %s\n' "$(c_blue '==>')" "$*"; }
ok()      { printf '%s %s\n' "$(c_green '  ✔')" "$*"; }
warn()    { printf '%s %s\n' "$(c_red '  ⚠')" "$*"; }

# Portable bounded-time wait. Returns 0 if cmd exits 0 within $1 seconds, else 124.
# macOS doesn't ship `timeout` by default, so we shell out.
with_timeout() {
  local secs="$1"; shift
  ( "$@" ) &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$secs" ]; then
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

# ── 0. Preflight: Node version ────────────────────────────────────────────────
step "Checking Node.js version"
if ! command -v node >/dev/null 2>&1; then
  warn "node not found on PATH."
  echo "    Install Node 22 LTS first: https://nodejs.org/ or 'nvm install 22 && nvm use 22'"
  exit 1
fi
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+)\..*/\1/')"
if [ "$NODE_MAJOR" -lt 22 ] || [ "$NODE_MAJOR" -ge 23 ]; then
  warn "Node $(node --version) is outside the supported range >=22.0.0 <23.0.0."
  echo "    Run: $(c_dim 'nvm use 22')  or  $(c_dim 'fnm use 22')  to switch."
  echo "    (engine-strict=true in .npmrc will also block pnpm install on the wrong major.)"
  exit 1
fi
ok "Node $(node --version)"

# ── 1. Preflight: pnpm ────────────────────────────────────────────────────────
step "Checking pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found. Enable corepack:"
  echo "    $(c_dim 'corepack enable && corepack prepare pnpm@9.15.0 --activate')"
  exit 1
fi
ok "pnpm $(pnpm --version)"

# ── 2. Preflight: docker ──────────────────────────────────────────────────────
step "Checking Docker daemon"
if ! command -v docker >/dev/null 2>&1; then
  warn "docker CLI not found. Install Docker Desktop / OrbStack / Colima first."
  exit 1
fi
# Probe with 5s ceiling so we don't hang for 30s if Docker Desktop is mid-boot
# (socket exists but daemon isn't accepting yet).
if ! with_timeout 5 docker info >/dev/null 2>&1; then
  warn "Docker daemon is not responding within 5s."
  echo "    Either Docker Desktop isn't running, or it's still booting up."
  echo "    Start it (macOS: $(c_dim 'open -a Docker')), wait until the whale icon settles,"
  echo "    then re-run this script."
  exit 1
fi
ok "Docker daemon up"

# ── 3. Bootstrap .env (setup mode only, never overwrites) ────────────────────
if [ "$MODE" = "setup" ]; then
  step "Ensuring .env"
  if [ -f "$ENV_FILE" ]; then
    ok ".env already exists (kept as-is)"
  else
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok "Copied .env.example → .env"
  fi
fi

# Always source .env so subsequent commands see DATABASE_URL etc.
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
else
  warn ".env not found. Run '$(c_dim 'pnpm setup')' first (or 'bash scripts/dev-up.sh setup')."
  exit 1
fi

# ── 4. pnpm install (setup mode only) ────────────────────────────────────────
if [ "$MODE" = "setup" ]; then
  step "Installing workspace dependencies"
  pnpm install --frozen-lockfile
  ok "pnpm install done"
fi

# ── 5. Start postgres + redis ─────────────────────────────────────────────────
step "Starting docker dev services (postgres + redis)"
docker compose -f "$COMPOSE_FILE" up -d
ok "Compose up issued"

# Wait until both containers report healthy (or accept "running" if no healthcheck)
wait_healthy() {
  local container="$1"
  local label="$2"
  local timeout=45
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    local status
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)"
    case "$status" in
      healthy|running) ok "$label is $status"; return 0 ;;
      missing) sleep 1 ;;
      *) sleep 1 ;;
    esac
    elapsed=$((elapsed + 1))
  done
  warn "$label did not become healthy within ${timeout}s. Recent logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=30 "${container#ai-hot-news-}"
  return 1
}
wait_healthy "$PG_CONTAINER" "postgres"
wait_healthy "$REDIS_CONTAINER" "redis"

# ── 6. Prisma generate + migrate + seed (setup mode only) ────────────────────
if [ "$MODE" = "setup" ]; then
  step "Generating Prisma client"
  pnpm db:generate >/dev/null
  ok "prisma generate done"

  step "Applying database migrations"
  pnpm db:migrate:deploy
  ok "prisma migrate deploy done"

  step "Seeding source_configs (idempotent)"
  pnpm db:seed
  ok "prisma db seed done"

  step "Setup complete"
  echo
  echo "  $(c_green 'Next:') run $(c_dim 'pnpm start')  (or  $(c_dim 'pnpm dev')) to launch web/api/worker."
  echo "  $(c_dim 'Web:')     http://localhost:3000/news"
  echo "  $(c_dim 'API:')     http://localhost:3001/health"
  echo "  $(c_dim 'Studio:')  pnpm db:studio    # Prisma DB GUI"
  echo "  $(c_dim 'Reset:')   bash scripts/dev-db-reset.sh"
  echo
  exit 0
fi

# ── 7. start mode: hand off to turbo dev ──────────────────────────────────────
step "Launching turbo dev (Ctrl+C to stop)"
echo "  $(c_dim 'Web:')     http://localhost:3000/news"
echo "  $(c_dim 'API:')     http://localhost:3001/health"
echo "  $(c_dim 'Worker:')  no HTTP, watches /tmp/worker-alive heartbeat"
echo
exec pnpm dev
