#!/usr/bin/env bash
# One-command local bootstrap: env → infra. DB migrate + seed are appended in T-003.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ Created .env from .env.example. Fill in RPC_URL and rotate secrets before non-local use."
fi

echo "→ Starting local infra (Postgres + Redis + anvil)…"
docker compose up -d --wait

echo "✓ Infra is up and healthy."
