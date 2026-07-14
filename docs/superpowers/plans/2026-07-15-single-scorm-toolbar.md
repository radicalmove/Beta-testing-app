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

- [ ] **Step 1: Write failing protocol-validation tests**

Cover exact keys and bounds for `SCORM_WORKER_REGISTERED`, `SCORM_SELECTION_CHANGED`, `SCORM_START_MARKER`, `SCORM_CANCEL_MARKER`, `SCORM_ANCHOR_CAPTURED`, `SCORM_SET_COMMENTS`, and `SCORM_TAKE_TO_CONTEXT`. Require `protocol: 1`, UUID request/worker IDs, integer generation, course ID, exact page identity, and explicit acknowledgement envelopes. Assert extra keys and stale/malformed identifiers are rejected.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/scorm-protocol.test.ts`

Expected: FAIL because `scorm-protocol.ts` does not exist.

- [ ] **Step 3: Implement the minimal discriminated-union validators**

Export bounded types and functions such as:

```ts
export type ScormEnvelope<T extends string, P> = {
  protocol: 1; type: T; request_id: string; worker_instance_id: string;
  generation: number; course_id: string; page_url: string; payload: P;
};
export function validateScormMessage(value: unknown): ScormMessage;
```

Use exact-key checks; do not accept client-supplied tab/frame IDs.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/scorm-protocol.test.ts && npm run typecheck`

Commit: `feat(review): define trusted SCORM worker protocol`

### Task 2: Make frame election worker-instance aware

**Files:**
- Modify: `extension/src/frame-coordinator.ts`
- Modify: `extension/src/frame-coordination-runtime.ts`
- Modify: `extension/tests/frame-coordinator.test.ts`
- Modify: `extension/tests/frame-coordination-runtime.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add cases for a new worker instance on the same frame ID, authoritative navigation pruning departed frames, timeout/removal after failed deactivation, stale acknowledgement rejection, and replay callback invocation after replacement activation.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/frame-coordinator.test.ts tests/frame-coordination-runtime.test.ts`

Expected: FAIL because records do not track `workerInstanceId`, stale same-frame registrations retain state, and handover can remain stuck.

- [ ] **Step 3: Implement instance-aware state and bounded handover**

Store `{ frameId, workerInstanceId, generation }` as active ownership. A changed instance clears old capabilities/active state. Replace the full navigation set per registration and prune missing frames. On deactivation delivery failure or timeout, remove the stale frame and continue election. Add a runtime replay hook for desired marker state and comment projection.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/frame-coordinator.test.ts tests/frame-coordination-runtime.test.ts && npm run typecheck`

Commit: `fix(review): recover SCORM worker election by instance`

### Task 3: Extract the document-local comment renderer

**Files:**
- Create: `extension/src/comment-renderer.ts`
- Create: `extension/tests/comment-renderer.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing renderer and projection tests**

Specify a renderer API:

```ts
export type CommentRenderer = {
  setComments(comments: PageComment[]): void;
  takeToContext(commentId: string): boolean;
  destroy(): void;
};
```

Assert it renders/restores only comments matching its exact `page_url`, opens marker threads beside anchors, supports edit/reply/delete/status callbacks, and mounts no `#moodle-course-review-overlay`. Assert the top overlay can set course-list comments without attempting anchor recovery in the Moodle DOM.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/comment-renderer.test.ts tests/overlay.test.ts`

Expected: FAIL because list and renderer behavior are coupled inside `ReviewOverlay.setPageComments`.

- [ ] **Step 3: Move marker/highlight/thread behavior into the renderer**

Keep toolbar panels, filters, numbering, authentication, help, and composition in `overlay/root.ts`. Add separate `setCommentList` and local `setRendererComments` calls. Preserve existing marker CSS classes and thread mutation callbacks so stored anchors remain compatible.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/comment-renderer.test.ts tests/overlay.test.ts && npm run typecheck`

Commit: `refactor(review): separate comment list from document renderer`

### Task 4: Build a toolbar-free SCORM interaction worker

**Files:**
- Create: `extension/src/scorm-worker.ts`
- Create: `extension/tests/scorm-worker.test.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [ ] **Step 1: Write failing worker tests**

Assert embedded startup never calls `mountReviewOverlay` or creates the overlay host; caches a valid text selection on `selectionchange`; consumes it after a start-selection command; starts/cancels marker mode; changes the cursor; returns stable anchors and exact existing embedded `page_url`/title identity; clears selection and renderer state on hash/title changes; and applies a matching comment projection.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/scorm-worker.test.ts tests/content.test.ts`

Expected: FAIL because `startActiveEmbeddedReview` currently mounts the complete overlay.

- [ ] **Step 3: Implement the worker and top-only mount rule**

Use `captureTextAnchor`, `capturePinAnchor`, `createLifecycleController`, and `CommentRenderer`. Embedded frames register and handle commands but never mount the toolbar. Remove SCORM route suppression and parent/child presentation election from the top overlay; the top toolbar remains visible once.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/scorm-worker.test.ts tests/content.test.ts && npm run typecheck`

Commit: `feat(review): run SCORM interactions without a second toolbar`

### Task 5: Add secure pending-anchor capabilities and delegated composition

**Files:**
- Create: `extension/src/embedded-anchor-capabilities.ts`
- Create: `extension/tests/embedded-anchor-capabilities.test.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/tests/background-bridge.test.ts`
- Modify: `extension/tests/background.test.ts`

- [ ] **Step 1: Write failing security tests**

Assert only the elected worker can issue an anchor; capabilities bind tab, course, frame, worker instance, generation, page identity, anchor digest, and expiry; capabilities are single-use; tampering/replay/stale workers fail; direct top-frame creation of a cross-origin Rise page still fails; and valid top composition succeeds only with the issued capability.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/embedded-anchor-capabilities.test.ts tests/background-bridge.test.ts tests/background.test.ts`

Expected: FAIL because no embedded capability exists and cross-origin create is rejected unconditionally.

- [ ] **Step 3: Implement bounded in-memory/session capability storage**

Follow the existing screenshot-capability pattern. Hash the normalized anchor and embedded metadata, store no comment body in the capability, expire after five minutes, and consume atomically. Add `CREATE_EMBEDDED_COMMENT` as a separate exact bridge path; retain existing `CREATE_COMMENT` origin checks unchanged.

- [ ] **Step 4: Verify green and commit**

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

- [ ] **Step 1: Write failing schema/service/route tests**

Add nullable `parent_activity_url` (absolute HTTPS Moodle URL, max 4096) and `embedded_locator` (bounded validated Rise hash/route, max 2048). Test create/list round-trip, invalid schemes/credentials/whitespace, ordinary comments with null metadata, and legacy rows with both fields null.

- [ ] **Step 2: Verify red**

Run: `cd server && python3 -m pytest -q tests/test_comment_creation.py tests/test_course_comment_routes.py`

Expected: FAIL because the request/model/JSON response omit the fields.

- [ ] **Step 3: Add the nullable columns and validation**

Add both columns to `PageLocation`. Require both-or-neither for new embedded metadata, and require the parent origin to match the bound Moodle course origin at the extension bridge before API submission. Return both nullable fields in page/course comment JSON.

- [ ] **Step 4: Verify migration and tests, then commit**

Run: `cd server && python3 -m pytest -q tests/test_comment_creation.py tests/test_course_comment_routes.py`

Run: `cd server && alembic upgrade head && alembic downgrade 20260713_10 && alembic upgrade head` against a disposable SQLite test database.

Commit: `feat(review): persist embedded comment navigation metadata`

### Task 7: Connect the single toolbar to delegated interactions and projections

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/scorm-worker.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Cover local Moodle interaction versus delegated SCORM interaction, cached-selection button labels, queued marker intent while loading, cancel propagation, replay after worker replacement, course-list versus worker projection partitioning, mutation refresh, and a bounded loading/permission/fallback state.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/content.test.ts tests/overlay.test.ts tests/scorm-worker.test.ts`

Expected: FAIL because the top overlay cannot yet delegate or maintain desired interaction state.

- [ ] **Step 3: Implement the top orchestrator**

Add an interaction target state (`local | loading | embedded | permission-required | unavailable`), one queued intent, and one current embedded projection. Route ordinary Moodle pages locally. Route SCORM commands through the background coordinator. Add **Allow SCORM review access** using the existing optional-permission flow and provide parent-page fallback only for unavailable frames.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/content.test.ts tests/overlay.test.ts tests/scorm-worker.test.ts && npm run typecheck`

Commit: `feat(review): orchestrate one toolbar across Moodle and SCORM`

### Task 8: Implement embedded comment navigation

**Files:**
- Modify: `extension/src/background.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/tests/scorm-worker.test.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing navigation tests**

Test current-worker scrolling/opening, top navigation to persisted `parent_activity_url`, replaying `embedded_locator` after worker election, exact comment/page matching, legacy comment best-effort behavior, and a clear “open the original SCORM activity first” state without guessing.

- [ ] **Step 2: Verify red**

Run: `cd extension && node --test tests/background.test.ts tests/scorm-worker.test.ts tests/overlay.test.ts`

Expected: FAIL because `PREPARE_COMMENT_NAVIGATION` only supports same-origin top-page URLs.

- [ ] **Step 3: Add validated embedded navigation preparation/consumption**

Store a short-lived tab/course-bound navigation record, navigate only to the validated Moodle parent activity, wait for an elected worker, apply the stored locator, then send `SCORM_TAKE_TO_CONTEXT`. Consume the record only after an acknowledgement.

- [ ] **Step 4: Verify green and commit**

Run: `cd extension && node --test tests/background.test.ts tests/scorm-worker.test.ts tests/overlay.test.ts && npm run typecheck`

Commit: `feat(review): navigate course lists into SCORM context`

### Task 9: Full regression, pilot build, and manual Chrome check

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `docs/pilot-runbook.md` if present, otherwise create it.

- [ ] **Step 1: Add/update the pilot runbook and bump the patch version**

Document one installed path, extension version verification, Chrome/Edge reload, SCORM permission recovery, expected single-toolbar behavior, and how to clear historical Chrome extension warnings.

- [ ] **Step 2: Run complete verification**

Run: `cd extension && npm test && npm run typecheck`

Expected: all extension tests pass.

Run: `cd server && python3 -m pytest -q`

Expected: all server tests pass.

Run: `git diff --check && git status --short`

Expected: only intended version/runbook changes before the final commit.

- [ ] **Step 3: Commit the release version**

Commit: `release(review): prepare single-toolbar SCORM pilot`

- [ ] **Step 4: Build and publish the verified pilot**

Run:

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
deploy/scripts/release-pilot-extension.sh
```

Expected: extension, server, and packaging suites pass; release metadata and checksums validate.

- [ ] **Step 5: Verify the installed compatibility path**

Run:

```bash
cmp '/Users/rcd58/OpenAI Projects/Beta Testing App/pilot-builds/moodle-review-extension/content.js' \
    '/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension/content.js'
```

Expected: exit 0 and installed manifest shows the new version.

- [ ] **Step 6: Manual Chrome acceptance**

Reload the extension, close/reopen the SCORM tab, and verify: exactly one toolbar; marker mode places inside Rise; text highlight persists; comment marker opens its thread; whole-course list navigates back to the marker; Rise internal navigation does not duplicate or lose the toolbar; extension errors remain empty after clearing old entries.

