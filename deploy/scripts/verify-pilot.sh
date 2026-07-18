#!/usr/bin/env bash
set -euo pipefail

origin=${1:?usage: VERIFY_EMAIL=... VERIFY_PASSWORD=... verify-pilot.sh https://host.tailnet.ts.net [backup.tar.gz]}
archive=${2:-}
: "${VERIFY_EMAIL:?set VERIFY_EMAIL to an existing approved pilot account}"
: "${VERIFY_PASSWORD:?set VERIFY_PASSWORD for that account}"
[[ $origin == https://* ]] || { echo "pilot origin must use HTTPS" >&2; exit 2; }

COMPOSE=(docker compose --env-file .env -f deploy/docker-compose.yml)
tmp=$(mktemp -d)
disposable_db="pilot_restore_${RANDOM}_$$"
db_created=false

cleanup() {
  exit_code=$?
  trap - EXIT
  if [[ $db_created == true ]]; then
    "${COMPOSE[@]}" exec -T db sh -eu -c \
      'dropdb --if-exists -U "$POSTGRES_USER" -- "$1"' sh "$disposable_db" >/dev/null || true
  fi
  rm -rf "$tmp"
  exit "$exit_code"
}
trap cleanup EXIT

# Public health and unauthenticated API rejection remain separate assertions.
curl -fsS "$origin/health" | grep -q '"status":"ok"'
code=$(curl -sS -o /dev/null -w '%{http_code}' "$origin/api/comments")
[[ $code == 401 || $code == 403 ]]

# Send credentials on stdin. They are never command arguments or log output.
printf '{"email":"%s","password":"%s"}' \
  "$(printf %s "$VERIFY_EMAIL" | sed 's/["\\]/\\&/g')" \
  "$(printf %s "$VERIFY_PASSWORD" | sed 's/["\\]/\\&/g')" |
  curl -fsS --cookie-jar "$tmp/cookie-jar" -D "$tmp/login-headers" \
    -H 'Content-Type: application/json' --data-binary @- "$origin/auth/login" |
  grep -q '"status":"ok"'
grep -Eiq '^set-cookie: dashboard_session=.*;.*Secure' "$tmp/login-headers"
awk -F '\t' '$2 == "TRUE" && $6 == "dashboard_session" { found=1 } END { exit !found }' "$tmp/cookie-jar"
dashboard_code=$(curl -sS --cookie "$tmp/cookie-jar" -o /dev/null -w '%{http_code}' "$origin/dashboard")
if [[ $dashboard_code != 200 ]]; then
  dashboard_code=$(curl -sS --cookie "$tmp/cookie-jar" -o /dev/null -w '%{http_code}' "$origin/")
fi
[[ $dashboard_code == 200 ]]
curl -sS --cookie "$tmp/cookie-jar" -X POST -o /dev/null "$origin/auth/logout" || true

current_output=$("${COMPOSE[@]}" exec -T api alembic current)
heads_output=$("${COMPOSE[@]}" exec -T api alembic heads)
current_revision=$(awk 'NF { print $1; exit }' <<<"$current_output")
head_revision=$(awk 'NF { print $1; exit }' <<<"$heads_output")
current_count=$(awk 'NF { count++ } END { print count+0 }' <<<"$current_output")
head_count=$(awk 'NF { count++ } END { print count+0 }' <<<"$heads_output")
[[ $current_count == 1 && $head_count == 1 && -n $current_revision && -n $head_revision && $current_revision == "$head_revision" ]] || {
  echo "database migration is not at the Alembic head" >&2
  exit 1
}

if [[ -n $archive ]]; then
  [[ -r $archive ]] || { echo "backup archive is not readable" >&2; exit 1; }
  # path safety: reject absolute paths, parent traversal, and backslash variants before extraction.
  tar -tzf "$archive" >"$tmp/archive-files"
  if grep -Eq '(^/|(^|/)\.\.(/|$)|\\)' "$tmp/archive-files"; then
    echo "unsafe path in backup archive" >&2; exit 1
  fi
  tar -xzf "$archive" -C "$tmp"
  [[ -f $tmp/SHA256SUMS && -f $tmp/database.dump && -f $tmp/attachments.tar.gz ]]
  (cd "$tmp" && sha256sum -c SHA256SUMS)
  "${COMPOSE[@]}" exec -T db pg_restore --list <"$tmp/database.dump" >/dev/null

  "${COMPOSE[@]}" exec -T db sh -eu -c \
    'createdb -U "$POSTGRES_USER" -- "$1"' sh "$disposable_db"
  db_created=true
  "${COMPOSE[@]}" exec -T db sh -eu -c \
    'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$disposable_db" <"$tmp/database.dump"
  "${COMPOSE[@]}" exec -T db sh -eu -c \
    'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM users"' sh "$disposable_db" >/dev/null

  mkdir "$tmp/restored-attachments"
  tar -tzf "$tmp/attachments.tar.gz" >"$tmp/attachment-files"
  if grep -Eq '(^/|(^|/)\.\.(/|$)|\\)' "$tmp/attachment-files"; then
    echo "unsafe path in attachments archive" >&2; exit 1
  fi
  tar -xzf "$tmp/attachments.tar.gz" -C "$tmp/restored-attachments"
  [[ -d $tmp/restored-attachments/attachments ]]
  find "$tmp/restored-attachments/attachments" -type f -exec test -r {} \;
fi
