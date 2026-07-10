#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=${ROOT:-/home/fldadmin/beta-testing-app}
ENV_FILE=${ENV_FILE:-$ROOT/.env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/moodle-review}
RETENTION_DAYS=${RETENTION_DAYS:-30}
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml")
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "backup already running" >&2; exit 1; }
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d "$BACKUP_DIR/.${timestamp}.XXXXXX")
trap 'rm -rf "$stage"' EXIT

"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$stage/database.dump"
"${COMPOSE[@]}" run --rm --no-deps -T api sh -c 'cd /data && tar -czf - attachments' >"$stage/attachments.tar.gz"
printf 'created_utc=%s\nformat=postgres-custom+attachments-tar\n' "$timestamp" >"$stage/manifest.txt"
(cd "$stage" && sha256sum database.dump attachments.tar.gz manifest.txt >SHA256SUMS)
tar -C "$stage" -czf "$BACKUP_DIR/.moodle-review-$timestamp.tar.gz.tmp" .
mv "$BACKUP_DIR/.moodle-review-$timestamp.tar.gz.tmp" "$BACKUP_DIR/moodle-review-$timestamp.tar.gz"
gzip -t "$BACKUP_DIR/moodle-review-$timestamp.tar.gz"
find "$BACKUP_DIR" -type f -name 'moodle-review-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete
echo "$BACKUP_DIR/moodle-review-$timestamp.tar.gz"
