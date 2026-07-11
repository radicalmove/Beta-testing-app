# Pilot Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the corrected pilot as `0.2.0` with one validated version visible in the extension, overlay, diagnostics, metadata, and artifacts.

**Architecture:** Read the canonical version from `extension/package.json` during Vite build, validate Chromium constraints, inject it into manifest/content code, and pass it into the atomic publisher. Keep a versioned ZIP plus the existing stable ZIP alias inside one coherent release set.

**Tech Stack:** TypeScript, Vite, MV3, Shadow DOM, Python release publisher, Node/Python tests.

---

### Task 1: Canonical build version and commit inputs

**Files:** `extension/package.json`, `extension/package-lock.json`, `extension/public/manifest.json`, `extension/src/build-config.ts`, `extension/vite.config.ts`, `extension/src/content.ts`, `extension/tests/build-config.test.ts`

- [ ] Add `test("validates canonical Chromium extension versions")` covering `0.2.0`, leading zeroes, missing/fourth components, signs, non-numeric values, and components `65535`/`65536`; add package/lock/template/generated-manifest equality tests.
- [ ] Run `cd extension && node --test --test-name-pattern='version' tests/build-config.test.ts`; expect FAIL because no canonical version loader exists.
- [ ] Set package/lock to `0.2.0` and template to fixed `0.0.0`. Add `loadExtensionVersion(packageJson, lockJson)` returning validated `version`; Vite reads both files, rejects mismatch/template drift, overwrites generated manifest, and defines `__EXTENSION_VERSION__`.
- [ ] Require `BUILD_COMMIT` as a full 40-hex clean-commit input in production, validate it, and define `__BUILD_COMMIT__`; development uses `0000000000000000000000000000000000000000`. Declare both globals in `content.ts`. The release shell obtains `git rev-parse HEAD` only after its clean-tree preflight and passes it to Vite.
- [ ] Re-run focused tests and typecheck; expect PASS.
- [ ] Commit `feat: add canonical pilot version`.

### Task 2: Visible version diagnostics

**Files:** `extension/src/overlay/root.ts`, `extension/src/content.ts`, `extension/tests/overlay.test.ts`, `extension/tests/content.test.ts`, `extension/e2e/version-layout.spec.ts`

- [ ] Add `overlay displays accessible pilot version diagnostics` asserting `Pilot v0.2.0`, accessible name `Pilot version 0.2.0`, panel diagnostic `Version 0.2.0 · build abc1234`, and a focusable diagnostic/details element. In `extension/e2e/version-layout.spec.ts`, call `page.setViewportSize({width:640,height:800})` then set `document.documentElement.style.zoom="2"`, yielding an effective 320 CSS px view at 200%; locate `[data-pilot-version]`, `[data-auth-status]`, and `[data-review-controls]`, assert their bounding boxes do not intersect, assert `getByLabel("Pilot version 0.2.0")` is visible, open the panel, press Tab from its preceding control until `[data-build-diagnostic]` is focused, and assert its full accessible text.
- [ ] Run `cd extension && node --test --test-name-pattern='version diagnostics' tests/overlay.test.ts tests/content.test.ts`; expect FAIL because markup lacks version. Run `cd extension && npx playwright test e2e/version-layout.spec.ts`; expect FAIL because `[data-pilot-version]` is absent.
- [ ] Pass injected version/commit into overlay creation; render compact header text and a panel diagnostic. Reuse the actual parsed CSS colour variables in contrast tests and require AA ratio for diagnostic text/background.
- [ ] Re-run focused/full extension tests and typecheck; expect PASS.
- [ ] Commit `feat: show pilot version in review overlay`.

### Task 3: Versioned atomic release

**Files:** `deploy/scripts/release_artifacts.py`, `deploy/scripts/release-pilot-extension.sh`, `tests/test_deployment_package.py`, `tests/test_release_artifacts.py`.

- [ ] Add executable failing tests in `tests/test_release_artifacts.py`: release directory is `releases/v0.2.0-<commit12>-<digest12>`; metadata equals `{version,commit,artifact_digest}`. Collision lookup scans every immutable `releases/*/RELEASE.json` while holding the publisher lock: malformed metadata or duplicate version entries with differing commit/digest fail closed; identical historical entries allow deterministic repeat; same version with different commit **or** digest raises before staging/pointer switch.
- [ ] Add failing checksum tests requiring paths `moodle-review-extension/background.js`, `content.js`, `manifest.json`, `RELEASE.json`, root `RELEASE.json`, `moodle-review-extension-v0.2.0-chrome-edge.zip`, and stable `moodle-review-extension-chrome-edge.zip`; both ZIP hashes must match.
- [ ] Add failure-injection/upgrade tests proving only `current` is switched atomically and compatibility links resolve as `moodle-review-extension -> current/moodle-review-extension`, both ZIP names -> their files under `current`, and metadata/checksums -> `current`, with no mixed version before/after every injected phase. Acquire an exclusive `flock`/`fcntl.flock` on `delivery/.publish.lock` before collision scan and hold it through immutable install and pointer switch. A multiprocessing test starts two different-content publishers for `0.2.0`; exactly one succeeds, the other reports collision, and `current` plus history remain coherent.
- [ ] Run `python3 -m unittest tests/test_release_artifacts.py tests/test_deployment_package.py`; expect FAIL on absent version interface/artifacts.
- [ ] Change `publish(dist, delivery, commit, version, ...)`; under the exclusive lock scan immutable metadata, stage one immutable version directory containing unpacked extension, both byte-identical ZIPs, root/unpacked metadata, and checksums; validate collision before staging/pointer changes; expose everything through the one atomic `current` switch.
- [ ] Run `cd extension && npm test && npm run typecheck && npm run test:e2e`; run `cd ../server && python3 -m pytest -q`; run root `python3 -m unittest tests/test_release_artifacts.py tests/test_deployment_package.py`; expect 127+, at least 5 E2E, 116+, and all release tests PASS.
- [ ] Commit all source/test changes as `build: publish versioned pilot releases`. Confirm `git status --porcelain` is empty.
- [ ] From the clean commit run `PRIVATE_KEY_PATH=/Users/rcd58/.config/moodle-review/pilot-extension.pem REVIEW_SERVICE_ORIGIN=https://fld-mini.tail4ccaba.ts.net deploy/scripts/release-pilot-extension.sh`. The script passes `BUILD_COMMIT=$(git rev-parse HEAD)` and canonical `0.2.0`; release is non-mutating to tracked files.
- [ ] Read-only verify manifest/content/header and both RELEASE.json files use `0.2.0`, displayed short build equals first seven characters of the full metadata commit, both ZIPs are byte-identical, all exact checksum paths pass, and all stable links traverse `current`.
- [ ] Push branch and report stable unpacked path plus `moodle-review-extension-v0.2.0-chrome-edge.zip` and stable alias.
