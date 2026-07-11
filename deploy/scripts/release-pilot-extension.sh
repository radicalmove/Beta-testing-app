#!/usr/bin/env bash
set -euo pipefail

: "${PRIVATE_KEY_PATH:?Set PRIVATE_KEY_PATH to an RSA private key outside the repository}"
: "${REVIEW_SERVICE_ORIGIN:?Set REVIEW_SERVICE_ORIGIN=https://host.tailnet.ts.net}"

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMMON_GIT_DIR=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
PROJECT_ROOT=$(dirname "$COMMON_GIT_DIR")
DELIVERY_ROOT=${DELIVERY_ROOT:-"$PROJECT_ROOT-pilot-builds"}
DELIVERY_ROOT=$(cd "$ROOT" && python3 -c 'import sys; from pathlib import Path; from deploy.scripts.release_artifacts import canonical_delivery; print(canonical_delivery(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])))' "$ROOT" "$COMMON_GIT_DIR" "$DELIVERY_ROOT")
DELIVERY_DIR="$DELIVERY_ROOT/moodle-review-extension"
DELIVERY_ZIP="$DELIVERY_ROOT/moodle-review-extension-chrome-edge.zip"

(cd "$ROOT" && python3 -c 'from pathlib import Path; from deploy.scripts.release_artifacts import git_identity; print(git_identity(Path(".")))') >/dev/null
[[ ${RELEASE_PREFLIGHT_ONLY:-0} == 1 ]] && exit 0
BUILD_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
RELEASE_VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/package.json")
VERSIONED_ZIP="$DELIVERY_ROOT/moodle-review-extension-v$RELEASE_VERSION-chrome-edge.zip"

(cd "$ROOT/extension" && npm test && npm run typecheck)
(cd "$ROOT/server" && python3 -m pytest -q)

rm -rf "$ROOT/extension/dist"
PRIVATE_KEY_PATH="$PRIVATE_KEY_PATH" REVIEW_SERVICE_ORIGIN="$REVIEW_SERVICE_ORIGIN" BUILD_COMMIT="$BUILD_COMMIT" \
  "$ROOT/deploy/scripts/build-pilot-extension.sh"

for artifact in manifest.json content.js background.js; do
  [[ -f "$ROOT/extension/dist/$artifact" ]] || {
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

(cd "$ROOT" && python3 -c 'from pathlib import Path; from deploy.scripts.release_artifacts import git_identity; print(git_identity(Path(".")))') >/dev/null
CURRENT_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
[[ "$CURRENT_COMMIT" == "$BUILD_COMMIT" ]] || {
  echo "refusing release because HEAD changed during verification" >&2
  exit 1
}
python3 "$ROOT/deploy/scripts/release_artifacts.py" --root "$ROOT" --dist "$ROOT/extension/dist" --delivery "$DELIVERY_ROOT" --version "$RELEASE_VERSION"
for artifact in background.js content.js manifest.json; do cmp "$ROOT/extension/dist/$artifact" "$DELIVERY_DIR/$artifact"; done
cmp "$VERSIONED_ZIP" "$DELIVERY_ZIP"
(cd "$DELIVERY_ROOT" && shasum -a 256 -c SHA256SUMS)
echo "Released verified pilot extension to $DELIVERY_ROOT"
