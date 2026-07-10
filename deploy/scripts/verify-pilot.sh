#!/usr/bin/env bash
set -euo pipefail
origin=${1:?usage: verify-pilot.sh https://host.tailnet.ts.net [backup.tar.gz]}
[[ $origin == https://* ]] || exit 2
curl -fsS "$origin/health" | grep -q '"status":"ok"'
code=$(curl -sS -o /dev/null -w '%{http_code}' "$origin/api/comments")
[[ $code == 401 || $code == 403 ]]
curl -fsSL "$origin/extension/authorize" >/dev/null
docker compose --env-file .env -f deploy/docker-compose.yml exec -T api alembic current
if [[ ${2:-} ]]; then
  tar -tzf "$2" >/dev/null
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  tar -xzf "$2" -C "$tmp"
  (cd "$tmp" && sha256sum -c SHA256SUMS)
  pg_restore --list "$tmp/database.dump" >/dev/null
fi
