# Single SCORM Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace competing Moodle/SCORM toolbars with one Moodle-owned toolbar that securely delegates selection, marker, rendering, and navigation work to one elected SCORM/Rise frame.

**Architecture:** The top document owns authentication, the toolbar, course lists, filters, dialogs, and save orchestration. Embedded documents run a UI-less interaction worker selected by the existing coordinator; typed, correlated messages and one-use pending-anchor capabilities connect the two without weakening origin checks. Comment lists are separated from per-document anchor rendering, and new SCORM comments optionally persist parent-activity and Rise-navigation metadata.

**Tech Stack:** TypeScript, Manifest V3 Chrome/Edge APIs, Happy DOM/Node test runner, Python 3.14, FastAPI, SQLAlchemy, Alembic, pytest.

---

## File structure

- Create `extension/src/scorm-protocol.ts`: exact command/event envelopes and validation.
- Create `extension/src/embedded-anchor-capabilities.ts`: short-lived, single-use capabilities bound to elected worker anchors.
- Create `extension/src/comment-renderer.ts`: document-local markers, highlights, contextual threads, and anchor navigation without a toolbar.
- Create `extension/src/scorm-worker.ts`: embedded selection cache, marker mode, renderer projection, and protocol handling.
- Create `extension/tests/background.test.ts`: Chrome background message-routing harness.
- Modify `extension/src/content.ts`: top-only toolbar; local-versus-delegated orchestration.
- Modify `extension/src/frame-coordinator.ts`: worker-instance-aware election and pruning.
- Modify `extension/src/frame-coordination-runtime.ts`: correlated command routing, timeouts, replay, and recovery.
- Modify `extension/src/background.ts`: trusted top/worker relay, projection routing, permissions, and pending-anchor save path.
- Modify `extension/src/background-bridge.ts`: exact embedded create/list/navigation schemas.
- Modify `extension/src/overlay/root.ts`: split course-list UI from document renderer and expose delegated composition hooks.
- Create `server/alembic/versions/20260715_11_embedded_navigation.py`: nullable navigation metadata.
- Modify `server/app/models.py`, `server/app/schemas.py`, `server/app/services/comments.py`, and `server/app/routers/comments.py`: persist and return optional embedded metadata.

### Task 1: Define the trusted SCORM protocol

**Files:**
- Create: `extension/src/scorm-protocol.ts`
- Create: `extension/tests/scorm-protocol.test.ts`

- [x] **Step 1: Write failing protocol-validation tests**

Cover exact keys and bounds for `SCORM_SELECTION_CHANGED`, `SCORM_START_SELECTION`, `SCORM_START_MARKER`, `SCORM_CANCEL_MARKER`, `SCORM_ANCHOR_CAPTURED`, `SCORM_PAGE_IDENTITY_CHANGED`, `SCORM_SET_COMMENTS`, `SCORM_COMMENTS_CHANGED`, `SCORM_APPLY_LOCATOR`, and `SCORM_TAKE_TO_CONTEXT`. Pre-election worker registration remains the separate exact `REGISTER_REVIEW_FRAME` control path in `review-context.ts`; it has a worker instance but no generation. Post-election commands/events require `protocol: 1`, UUID request/worker IDs, integer generation, course ID, exact page identity, and acknowledgements bound to the same `request_id`, worker instance, generation, course, and page plus `{ ok, ack_type, error_code? }`. Assert extra keys and malformed identifiers are rejected; stateful stale/duplicate checks belong to the runtime in Tasks 2 and 7.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/scorm-protocol.test.ts`

Expected: FAIL because `scorm-protocol.ts` does not exist.

- [x] **Step 3: Implement the minimal discriminated-union validators**

Export bounded types and functions such as:

```ts
export type ScormEnvelope<T extends string, P> = {
  protocol: 1; type: T; request_id: string; worker_instance_id: string;
  generation: number; course_id: string; page_url: string; payload: P;
};
export function validateScormMessage(value: unknown): ScormMessage;
```

Use exact-key checks; do not accept client-supplied tab/frame IDs. Include type-to-acknowledgement mapping and full binding comparison so a validly shaped but wrong acknowledgement type/course/page/instance/generation is rejected.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/scorm-protocol.test.ts && npm run typecheck`

Commit: `feat(review): define trusted SCORM worker protocol`

### Task 2: Make frame election worker-instance aware

**Files:**
- Modify: `extension/src/frame-coordinator.ts`
- Modify: `extension/src/frame-coordination-runtime.ts`
- Modify: `extension/tests/frame-coordinator.test.ts`
- Modify: `extension/tests/background-frame-coordination.test.ts`
- Modify: `extension/src/review-context.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/tests/review-context.test.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [x] **Step 1: Write failing lifecycle tests**

Add cases for a new worker instance on the same frame ID, exact `REGISTER_REVIEW_FRAME` validation, authoritative navigation pruning departed frames, timeout/removal after failed or hanging deactivation, stale acknowledgement rejection, service-worker restart, and replay callback invocation after replacement activation. Use an injected clock/timer so timeout behavior is deterministic.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/frame-coordinator.test.ts tests/background-frame-coordination.test.ts tests/review-context.test.ts`

Expected: FAIL because records do not track `workerInstanceId`, stale same-frame registrations retain state, and handover can remain stuck.

- [x] **Step 3: Implement instance-aware state and bounded handover**

Store `{ frameId, workerInstanceId, generation }` as active ownership. Generate one stable UUID per content-script instance and send it on every pre-election `REGISTER_REVIEW_FRAME` registration/lease. A changed instance clears old capabilities/active state. Extend the exact review-context and background registration envelopes with `worker_instance_id` in this same task so no intermediate build breaks. Replace the full navigation set per registration and prune missing frames. On deactivation delivery failure or a bounded injected timeout, remove the stale frame and continue election. The coordinator emits worker-ready/replaced notifications; desired marker state, queued intent, and current projection remain top-controller state and are replayed from there, including after service-worker restart.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/frame-coordinator.test.ts tests/background-frame-coordination.test.ts tests/review-context.test.ts tests/content.test.ts && npm run typecheck`

Commit: `fix(review): recover SCORM worker election by instance`

### Task 3: Extract the document-local comment renderer

**Files:**
- Create: `extension/src/comment-renderer.ts`
- Create: `extension/tests/comment-renderer.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [x] **Step 1: Write failing renderer and projection tests**

Specify a renderer API:

```ts
export type CommentRenderer = {
  setComments(comments: PageComment[]): void;
  takeToContext(commentId: string): boolean;
  destroy(): void;
};
```

Assert it renders/restores only comments matching its exact `page_url`, opens marker threads beside anchors, supports edit/reply/delete/status callbacks, and mounts no `#moodle-course-review-overlay`. Assert the top overlay can set course-list comments without attempting anchor recovery in the Moodle DOM.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/comment-renderer.test.ts tests/overlay.test.ts`

Expected: FAIL because list and renderer behavior are coupled inside `ReviewOverlay.setPageComments`.

- [x] **Step 3: Move marker/highlight/thread behavior into the renderer**

Keep toolbar panels, filters, numbering, authentication, help, and composition in `overlay/root.ts`. Add separate `setCommentList` and local `setRendererComments` calls, while retaining `setPageComments` temporarily as a compatibility wrapper so `content.ts` continues to compile until Task 7. Preserve existing marker CSS classes and thread mutation callbacks so stored anchors remain compatible.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/comment-renderer.test.ts tests/overlay.test.ts && npm run typecheck`

Commit: `refactor(review): separate comment list from document renderer`

### Task 4: Build a toolbar-free SCORM interaction worker

**Files:**
- Create: `extension/src/scorm-worker.ts`
- Create: `extension/tests/scorm-worker.test.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [x] **Step 1: Write failing worker tests**

Assert embedded startup never calls `mountReviewOverlay` or creates the overlay host; caches a valid text selection on `selectionchange`; consumes it after a start-selection command; starts/cancels marker mode; changes the cursor; returns stable anchors and exact existing embedded `page_url`/title identity; clears selection and renderer state on hash/title changes; and applies a matching comment projection.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/scorm-worker.test.ts tests/content.test.ts`

Expected: FAIL because `startActiveEmbeddedReview` currently mounts the complete overlay.

- [x] **Step 3: Implement the worker and top-only mount rule**

Use `captureTextAnchor`, `capturePinAnchor`, `createLifecycleController`, and `CommentRenderer`. Embedded frames register and handle commands but never mount the toolbar. Remove SCORM route suppression and parent/child presentation election from the top overlay; the top toolbar remains visible once.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/scorm-worker.test.ts tests/content.test.ts && npm run typecheck`

Commit: `feat(review): run SCORM interactions without a second toolbar`

### Task 5: Add secure pending-anchor capabilities and delegated composition

**Files:**
- Create: `extension/src/embedded-anchor-capabilities.ts`
- Create: `extension/tests/embedded-anchor-capabilities.test.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/tests/background-bridge.test.ts`
- Create: `extension/tests/background.test.ts`
- Modify: `extension/src/review-context.ts`
- Modify: `extension/tests/review-context.test.ts`

- [x] **Step 1: Write failing security tests**

Assert only the elected worker can issue an anchor; unguessable capabilities bind tab, course, frame, worker instance, generation, page identity/title, canonical anchor digest, trusted parent Moodle activity, embedded locator, and expiry; direct top-frame creation of a cross-origin Rise page still fails; and `CREATE_EMBEDDED_COMMENT` accepts only this extension's frame-0 sender on a configured Moodle origin. Recheck current election/context on claim. Test tampering, replay, expiry, service-worker restart, concurrent claims, API failure/restoration/retry, and screenshot requests.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/embedded-anchor-capabilities.test.ts tests/background-bridge.test.ts tests/background.test.ts`

Expected: FAIL because no embedded capability exists and cross-origin create is rejected unconditionally.

- [x] **Step 3: Implement bounded in-memory/session capability storage**

Follow the existing screenshot-capability pattern but persist tokens in `chrome.storage.session`. Generate an unguessable token, hash the canonical anchor/page/title/parent/locator payload, store no comment body, expire after five minutes, and serialize claims so only one concurrent caller succeeds. Source the parent activity from the trusted stored Moodle review context and enforce its course origin here. A failed API call restores an unexpired claimed capability; successful creation consumes it permanently. Add `CREATE_EMBEDDED_COMMENT` as a separate exact bridge path and retain existing `CREATE_COMMENT` origin checks and screenshot flow unchanged.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/embedded-anchor-capabilities.test.ts tests/background-bridge.test.ts tests/background.test.ts && npm run typecheck`

Commit: `feat(review): secure delegated SCORM comment creation`

### Task 6: Persist optional embedded navigation metadata

**Files:**
- Create: `server/alembic/versions/20260715_11_embedded_navigation.py`
- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Modify: `server/app/services/comments.py`
- Modify: `server/app/routers/comments.py`
- Modify: `server/tests/test_comment_creation.py`
- Modify: `server/tests/test_course_comment_routes.py`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/tests/background-bridge.test.ts`
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/comment-renderer.test.ts`
- Modify: `extension/tests/overlay-focus.test.ts`
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/tests/scorm-worker.test.ts`
- Create: `deploy/scripts/test-postgres-migration.sh`

- [x] **Step 1: Write failing schema/service/route tests**

Add nullable `parent_activity_url` (absolute HTTPS Moodle URL, max 4096) and `embedded_locator` (bounded validated Rise hash/route, max 2048). Test create/list round-trip, invalid schemes/credentials/whitespace, ordinary comments with null metadata, legacy rows with both fields null, and a database constraint requiring both fields null or both non-null. Update the extension's exact `PageComment` contract and every affected fixture to require both nullable response keys, otherwise valid new server responses would be rejected.

- [x] **Step 2: Verify red**

Run: `cd server && python3 -m pytest -q tests/test_comment_creation.py tests/test_course_comment_routes.py`

Expected: FAIL because the request/model/JSON response omit the fields.

- [x] **Step 3: Add the nullable columns and validation**

Add both columns to `PageLocation` with a PostgreSQL check constraint enforcing both-or-neither. Require both-or-neither in Pydantic/service validation. Return both nullable keys in every page/course comment JSON response. Extend `validatePageCommentsResponse` and renderer/list fixtures in the same commit. The trusted parent-origin enforcement is already implemented at the extension bridge in Task 5.

- [x] **Step 4: Verify migration and tests, then commit**

Run: `cd server && python3 -m pytest -q tests/test_comment_creation.py tests/test_course_comment_routes.py`

Run: `cd extension && node --test tests/background-bridge.test.ts tests/comment-renderer.test.ts tests/overlay.test.ts tests/overlay-focus.test.ts tests/content.test.ts tests/scorm-worker.test.ts && npm run typecheck`

Create `deploy/scripts/test-postgres-migration.sh` to start a uniquely named `postgres:16-alpine` Docker container on a random host port, export an explicit temporary `DATABASE_URL`, wait for readiness, run clean `alembic upgrade head`, insert/check legacy null metadata and new paired metadata, reject partial metadata, downgrade to `20260713_10`, and re-upgrade. The script must use `trap` to remove the container and must reject any `DATABASE_URL` not constructed inside the script.

Run: `deploy/scripts/test-postgres-migration.sh`

Expected: disposable PostgreSQL verification passes and the container is removed even on failure; no `.env` or pilot database is read.

Commit: `feat(review): persist embedded comment navigation metadata`

### Task 7: Connect the single toolbar to delegated interactions and projections

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/src/frame-coordination-runtime.ts`
- Modify: `extension/src/optional-content-scripts.ts`
- Modify: `extension/src/build-config.ts`
- Modify: `extension/vite.config.ts`
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/scorm-worker.test.ts`
- Modify: `extension/tests/background-frame-coordination.test.ts`
- Modify: `extension/tests/build-config.test.ts`
- Create: `extension/tests/optional-permissions.test.ts`
- Create: `deploy/config/pilot-optional-frame-patterns.txt`
- Modify: `deploy/scripts/release-pilot-extension.sh`
- Modify: `tests/test_deployment_package.py`

- [x] **Step 1: Write failing orchestration tests**

Cover local Moodle interaction versus delegated SCORM interaction, cached-selection button labels, queued marker intent while loading, cancel propagation, cancellation before replacement, replay after worker replacement/service-worker restart, course-list versus worker projection partitioning, and mutation refresh through `SCORM_COMMENTS_CHANGED`. With an injected clock, prove that an unsupported or never-registering frame remains `loading` only for a bounded interval and then becomes `unavailable` with parent-page fallback. Prove that missing, denied, or revoked-but-requestable permission instead remains `permission-required` with **Allow SCORM review access**, never showing fallback while permission remains actionable. Add stateful request tracking tests for duplicate request IDs, nonzero-frame top commands, non-elected worker events, mismatched ack type/page/course/instance/generation, stale async acknowledgements, and command timeout. Add permission tests for a manifest-declared candidate, frame-0-only request, synchronous user-gesture `chrome.permissions.request` before any `await`, denial/retry, revocation cleanup/capability invalidation, and injection into already-loaded frames or an explicit reload-required state.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/content.test.ts tests/overlay.test.ts tests/scorm-worker.test.ts tests/background-frame-coordination.test.ts tests/optional-permissions.test.ts tests/build-config.test.ts tests/optional-content-scripts.test.ts`

Expected: FAIL because the top overlay cannot yet delegate or maintain desired interaction state.

- [x] **Step 3: Implement the top orchestrator**

Add an interaction target state (`local | loading | embedded | permission-required | unavailable`), one queued intent, and one current embedded projection owned by the top controller. Route ordinary Moodle pages locally and SCORM commands through bounded, correlated runtime requests. Use an injected clock/timer for a bounded loading deadline: transition to `unavailable` and expose parent-page fallback only when no supported/requestable frame can register by the deadline. A manifest-declared origin without permission remains `permission-required` before and after denial/revocation, and never falls through to `unavailable` while permission is requestable. Maintain a bounded replay/pending-request map in the runtime/background; reject duplicate/stale events and require exact acknowledgements. On worker-ready/replaced, replay desired marker mode and the current exact-page projection unless cancellation cleared the intent. Renderer mutations emit `SCORM_COMMENTS_CHANGED`; the top list and worker projection both refresh.

Implement **Allow SCORM review access** rather than assuming it exists. Offer only origins matching build-time optional patterns; accept requests only from frame 0; call `chrome.permissions.request` synchronously in the click handler; register/inject `content.js` after grant or show a precise reload-required state. On revocation, remove dynamic registrations, invalidate related workers/capabilities, and fall back safely. Determine the approved UC pilot cross-origin iframe origins from representative course iframe `src` values, record only those concrete Chrome match patterns in `deploy/config/pilot-optional-frame-patterns.txt`, make the release script pass that exact comma-separated value to the build, and never request undeclared origins. Deployment tests must fail if the release omits the configured patterns.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/content.test.ts tests/overlay.test.ts tests/scorm-worker.test.ts tests/background-frame-coordination.test.ts tests/optional-permissions.test.ts tests/build-config.test.ts tests/optional-content-scripts.test.ts && npm run typecheck`

Run: `python3 -m unittest tests/test_deployment_package.py`

Expected: all focused extension, permission, build, deployment, and type checks pass.

Commit: `feat(review): orchestrate one toolbar across Moodle and SCORM`

### Task 8: Implement embedded comment navigation

**Files:**
- Modify: `extension/src/background.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/tests/scorm-worker.test.ts`
- Modify: `extension/tests/overlay.test.ts`

- [x] **Step 1: Write failing navigation tests**

Test that embedded navigation preparation/consumption is accepted only from this extension's frame-0 controller on a configured Moodle origin. Test a recoverable navigation record bound to tab, course, comment ID, exact embedded page identity, validated parent activity, locator, and expiry. Cover current-worker scrolling/opening; parent navigation; worker replacement caused by navigation; locator application; waiting for the expected worker page identity and projection; final take-to-context acknowledgement; timeout/retry until expiry; exact comment/page matching; and legacy comments navigating only when the current worker already matches their exact identity. Otherwise require “open the original SCORM activity first” without guessing.

- [x] **Step 2: Verify red**

Run: `cd extension && node --test tests/background.test.ts tests/scorm-worker.test.ts tests/overlay.test.ts`

Expected: FAIL because `PREPARE_COMMENT_NAVIGATION` only supports same-origin top-page URLs.

- [x] **Step 3: Add validated embedded navigation preparation/consumption**

Authorize the state-machine entry point separately from general optional-frame senders: require this extension ID, `sender.frameId === 0`, a configured Moodle sender origin, and the current tab/course binding. Implement `prepared -> parent-loading -> worker-loading -> locator-applying -> identity-waiting -> projection-waiting -> context-opening -> complete`. Navigate only to the validated Moodle parent activity; tolerate worker instance replacement; apply the locator; wait for the newly elected worker to announce the expected identity and receive its exact projection; then send `SCORM_TAKE_TO_CONTEXT`. Consume only after its final acknowledgement. On timeout retain/retry while unexpired.

- [x] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/background.test.ts tests/scorm-worker.test.ts tests/overlay.test.ts && npm run typecheck`

Commit: `feat(review): navigate course lists into SCORM context`

### Task 9: Full regression, pilot build, and manual Chrome check

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Create: `extension/e2e/nested-scorm-single-toolbar.spec.ts`
- Modify: `extension/e2e/stateful-comment-backend.ts`
- Modify: `docs/pilot-test-script.md`
- Modify: `tests/test_release_artifacts.py`
- Modify: `tests/test_deployment_package.py`

- [x] **Step 1: Add the nested SCORM integration fixture**

Add a nested Moodle -> SCORM wrapper -> Rise fixture test. It must exercise continuously single-toolbar ownership, selection preservation across toolbar focus, marker start/cancel, highlight/marker restoration, contextual thread opening, course-list navigation, late/replaced workers, internal Rise navigation, permission denial/retry/revocation, and stale-worker rejection.

Run: `cd extension && npm run test:e2e`

Expected: all browser fixtures, including nested SCORM, pass.

Commit: `test(review): cover nested single-toolbar SCORM flow`

- [x] **Step 2: Update pilot documentation and bump the patch version**

Update the existing pilot script with one installed path, extension version verification, Chrome/Edge reload, SCORM permission recovery, expected single-toolbar behavior, and how to clear historical Chrome extension warnings. Bump package, lockfile, and build-config expectation together.

- [x] **Step 3: Run complete verification**

Run: `cd extension && npm test && npm run typecheck`

Expected: all extension tests pass.

Run: `cd extension && npm run test:e2e`

Expected: all browser fixtures, including nested SCORM, pass.

Run: `cd server && python3 -m pytest -q`

Expected: all server tests pass.

Run: `python3 -m unittest tests/test_release_artifacts.py tests/test_deployment_package.py`

Expected: both root packaging suites pass.

Run: `git diff --check && git status --short`

Expected: only the intended version, pilot-script, and any necessary packaging-test changes remain after the separately committed E2E fixture.

- [x] **Step 4: Commit the release version**

Commit: `release(review): prepare single-toolbar SCORM pilot`

- [x] **Step 5: Build and publish the verified pilot**

Run:

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
OPTIONAL_FRAME_PATTERNS="$(paste -sd, deploy/config/pilot-optional-frame-patterns.txt)" \
deploy/scripts/release-pilot-extension.sh
```

Expected: the release script reruns extension unit/type checks, server tests, production build validation, and deployment packaging checks; production manifest contains the exact configured optional patterns; release version, commit, artifact digest, permissions, metadata, and checksums validate. The fresh E2E and release-artifact suite evidence comes from Step 3 rather than being attributed to this command.

- [x] **Step 6: Verify the installed compatibility path**

Run:

```bash
cmp '/Users/rcd58/OpenAI Projects/Beta Testing App/pilot-builds/moodle-review-extension/content.js' \
    '/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension/content.js'
```

Expected: exit 0; installed manifest shows the new version, required `webNavigation`/optional host permissions, and configured patterns; installed `RELEASE.json` matches the verified release metadata.

- [ ] **Step 7: Manual Chrome acceptance**

Reload the extension, close/reopen the SCORM tab, and verify: exactly one toolbar; marker mode places inside Rise; text highlight persists; comment marker opens its thread; whole-course list navigates back to the marker; Rise internal navigation does not duplicate or lose the toolbar; extension errors remain empty after clearing old entries.
