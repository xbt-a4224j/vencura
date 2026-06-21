#!/usr/bin/env bash
#
# Stand up the whole VenCura app locally — infra (Postgres + anvil), a clean migrated DB,
# seeded demo data, the API, and the web app — in one command.
#
# IDEMPOTENT: every run first tears down any prior standup (stops the old API/web, frees
# their ports) and resets the database to a clean slate, then brings everything back fresh.
# Re-running it is always safe and always yields the same clean state.
#
# Usage:
#   scripts/standup.sh          # tear down any prior run, then stand everything up
#   scripts/standup.sh stop     # just tear down (stop API/web + containers)
#
# Local demo use only. Non-destructive: applies migrations + reseeds demo data (no DB drop).
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_DIR=".standup"   # pid + log files for the running API/web (gitignored)
API_PORT=3000
WEB_PORT=5173
mkdir -p "$RUN_DIR"

log()  { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }

# Stop a process we started (by pid file), then free the port in case the pid was stale
# or the real listener was a reparented child (e.g. vite under pnpm).
stop_service() {
  local name="$1" port="$2" pidfile="$RUN_DIR/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile")"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
  local pids; pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
}

tear_down() {
  log "Tearing down any prior standup…"
  stop_service api "$API_PORT"
  stop_service web "$WEB_PORT"
}

# `stop` subcommand: tear down app processes + containers and exit.
if [ "${1:-}" = "stop" ]; then
  tear_down
  log "Stopping containers…"
  docker compose down
  ok "Stopped."
  exit 0
fi

# ---- 1. clean up any prior standup ----
tear_down

# ---- 2. env ----
if [ ! -f .env ]; then
  cp .env.example .env
  log "Created .env from .env.example — fill RPC_URL / rotate secrets before any non-local use."
fi

# ---- 3. infra ----
log "Starting infra (Postgres + anvil)…"
docker compose up -d --wait
ok "Containers healthy."

# ---- 4. build (the API runs from dist; shared must build first) ----
log "Building shared + api…"
pnpm --filter @vencura/shared build >/dev/null
pnpm --filter @vencura/api build >/dev/null
ok "Built."

# ---- 5. database: ensure schema is applied, then (re)seed a clean demo slate ----
# Non-destructive + idempotent: `migrate deploy` is a no-op once applied, and the seed wipes
# & recreates the demo user's wallets, so re-running yields the same fresh demo state without
# dropping the database.
log "Applying migrations + seeding demo data (idempotent)…"
pnpm --filter @vencura/api db:migrate >/dev/null
pnpm --filter @vencura/api db:seed

# ---- 6. start API + web in the background ----
log "Starting API on :${API_PORT}…"
node packages/api/dist/main.js >"$RUN_DIR/api.log" 2>&1 &
echo $! >"$RUN_DIR/api.pid"

log "Starting web on :${WEB_PORT}…"
pnpm --filter @vencura/web dev >"$RUN_DIR/web.log" 2>&1 &
echo $! >"$RUN_DIR/web.pid"

# ---- 7. wait until both answer ----
log "Waiting for services to come up…"
until curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; do sleep 1; done
ok "API up"
until curl -sf "http://localhost:$WEB_PORT" >/dev/null 2>&1; do sleep 1; done
ok "web up"

# ---- 8. end-to-end smoke test against the live stack ----
log "Running end-to-end tests against the live stack…"
e2e_status=0
node scripts/e2e.mjs || e2e_status=$?

cat <<EOF

$(printf '\033[1;32m✓ VenCura is up.\033[0m')
   Web:    http://localhost:$WEB_PORT
   API:    http://localhost:$API_PORT   (Swagger UI at /docs)
   Login:  demo@vencura.local / demo-password   (3 funded wallets)
   E2E:    $([ "$e2e_status" -eq 0 ] && printf 'passed' || printf 'FAILED (see output above)')
   Logs:   $RUN_DIR/api.log · $RUN_DIR/web.log
   Stop:   scripts/standup.sh stop      (or re-run this script to restart fresh)
EOF

# Services stay up either way (so a failure can be inspected); exit reflects the e2e result.
exit "$e2e_status"
