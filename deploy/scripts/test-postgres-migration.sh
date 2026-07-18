#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${DATABASE_URL:-}" ]]; then
  printf 'Refusing to use a pre-existing DATABASE_URL; this test constructs its own disposable database.\n' >&2
  exit 1
fi
command -v docker >/dev/null || { printf 'Docker is required.\n' >&2; exit 127; }

container="moodle-review-migration-${$}-${RANDOM}"
password="migration-${RANDOM}-${RANDOM}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run --detach --name "$container" --publish 127.0.0.1::5432 \
  -e POSTGRES_DB=review_migration -e POSTGRES_USER=review_migration -e POSTGRES_PASSWORD="$password" \
  postgres:16-alpine >/dev/null
port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
[[ "$port" =~ ^[0-9]+$ ]] || { printf 'Could not determine disposable PostgreSQL port.\n' >&2; exit 1; }
export DATABASE_URL="postgresql+psycopg://review_migration:${password}@127.0.0.1:${port}/review_migration"

for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U review_migration -d review_migration >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U review_migration -d review_migration >/dev/null

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root/server"
python3 -m alembic upgrade head

psql() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U review_migration -d review_migration "$@"; }
psql <<'SQL'
INSERT INTO courses (id, moodle_course_id, normalized_url, title, identity_title, is_confirmed, created_at)
VALUES ('00000000-0000-4000-8000-000000000001', '1', 'https://moodle.example/course/view.php?id=1', 'Course', 'course', true, now());
INSERT INTO page_locations (id, course_id, page_url, page_title, anchor_type, css_selector, relative_x, relative_y, created_at)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'https://moodle.example/page', 'Page', 'visual_pin', '#main', .2, .3, now());
INSERT INTO page_locations (id, course_id, page_url, page_title, anchor_type, css_selector, relative_x, relative_y, parent_activity_url, embedded_locator, created_at)
VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'https://rise.example/index.html', 'Lesson', 'visual_pin', '#main', .2, .3, 'https://moodle.example/mod/scorm/player.php?a=9', '#/lessons/one', now());
DO $$ BEGIN
  BEGIN
    INSERT INTO page_locations (id, course_id, page_url, page_title, anchor_type, css_selector, relative_x, relative_y, parent_activity_url, created_at)
    VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'https://rise.example/bad', 'Bad', 'visual_pin', '#main', .2, .3, 'https://moodle.example/mod/scorm/player.php?a=9', now());
    RAISE EXCEPTION 'partial embedded navigation metadata was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM page_locations WHERE parent_activity_url IS NULL AND embedded_locator IS NULL;
SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM page_locations WHERE parent_activity_url IS NOT NULL AND embedded_locator IS NOT NULL;
SQL

python3 -m alembic downgrade 20260713_10
psql -Atc "SELECT 1 / CASE WHEN count(*) = 0 THEN 1 ELSE 0 END FROM information_schema.columns WHERE table_name='page_locations' AND column_name IN ('parent_activity_url','embedded_locator')" >/dev/null
python3 -m alembic upgrade head
psql -Atc "SELECT 1 / CASE WHEN count(*) = 2 THEN 1 ELSE 0 END FROM information_schema.columns WHERE table_name='page_locations' AND column_name IN ('parent_activity_url','embedded_locator')" >/dev/null
psql -Atc "SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM pg_constraint WHERE conname='ck_page_locations_embedded_navigation_pair'" >/dev/null
printf 'Disposable PostgreSQL migration verification passed.\n'
