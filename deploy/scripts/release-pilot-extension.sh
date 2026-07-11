#!/usr/bin/env bash
set -euo pipefail

: "${PRIVATE_KEY_PATH:?Set PRIVATE_KEY_PATH to an RSA private key outside the repository}"
: "${REVIEW_SERVICE_ORIGIN:?Set REVIEW_SERVICE_ORIGIN=https://host.tailnet.ts.net}"

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMMON_GIT_DIR=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
PROJECT_ROOT=$(dirname "$COMMON_GIT_DIR")
DELIVERY_ROOT=${DELIVERY_ROOT:-"$PROJECT_ROOT/pilot-builds"}
DELIVERY_DIR="$DELIVERY_ROOT/moodle-review-extension"
DELIVERY_ZIP="$DELIVERY_ROOT/moodle-review-extension-chrome-edge.zip"

case "$DELIVERY_ROOT" in
  /|"$ROOT"|"$ROOT"/extension|"$ROOT"/extension/dist) echo "unsafe DELIVERY_ROOT: $DELIVERY_ROOT" >&2; exit 1 ;;
esac

(cd "$ROOT/extension" && npm test && npm run typecheck)
(cd "$ROOT/server" && python3 -m pytest -q)

build_started=$(mktemp)
trap 'rm -f "$build_started"' EXIT
touch "$build_started"
PRIVATE_KEY_PATH="$PRIVATE_KEY_PATH" REVIEW_SERVICE_ORIGIN="$REVIEW_SERVICE_ORIGIN" \
  "$ROOT/deploy/scripts/build-pilot-extension.sh"

for artifact in manifest.json content.js background.js; do
  [[ "$ROOT/extension/dist/$artifact" -nt "$build_started" ]] || {
    echo "build did not freshly produce extension/dist/$artifact" >&2
    exit 1
  }
done

(cd "$ROOT" && python3 -m unittest tests/test_deployment_package.py)
(cd "$ROOT" && python3 - <<'PY'
import json
from pathlib import Path
from tests.test_deployment_package import assert_classic_self_contained_script, assert_production_manifest
dist = Path("extension/dist")
assert_production_manifest(json.loads((dist / "manifest.json").read_text()))
assert_classic_self_contained_script((dist / "content.js").read_text())
print("Fresh production manifest hosts and classic content.js verified")
PY
)

mkdir -p "$DELIVERY_ROOT"
stage=$(mktemp -d "$DELIVERY_ROOT/.moodle-review-extension.XXXXXX")
trap 'rm -f "$build_started"; rm -rf "$stage"' EXIT
cp "$ROOT/extension/dist/background.js" "$ROOT/extension/dist/content.js" "$ROOT/extension/dist/manifest.json" "$stage/"
for artifact in background.js content.js manifest.json; do
  cmp "$ROOT/extension/dist/$artifact" "$stage/$artifact"
done
rm -rf "$DELIVERY_DIR"
mv "$stage" "$DELIVERY_DIR"

zip_stage=$(mktemp "$DELIVERY_ROOT/.moodle-review-extension.XXXXXX.zip")
rm -f "$zip_stage"
(cd "$DELIVERY_ROOT" && zip -q -r "$zip_stage" moodle-review-extension)
mv "$zip_stage" "$DELIVERY_ZIP"

for artifact in background.js content.js manifest.json; do
  cmp "$ROOT/extension/dist/$artifact" "$DELIVERY_DIR/$artifact"
done
(cd "$DELIVERY_ROOT" && shasum -a 256 \
  moodle-review-extension/background.js \
  moodle-review-extension/content.js \
  moodle-review-extension/manifest.json \
  moodle-review-extension-chrome-edge.zip > SHA256SUMS)
(cd "$DELIVERY_ROOT" && shasum -a 256 -c SHA256SUMS)
echo "Released verified pilot extension to $DELIVERY_ROOT"
