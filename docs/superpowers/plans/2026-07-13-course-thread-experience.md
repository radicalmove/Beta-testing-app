# Course Thread Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a stable, course-scoped contextual commenting experience with usable thread controls, anchored popovers, course-wide navigation, resolved filtering, and persistent browser identity.

**Architecture:** Keep the FastAPI server authoritative for membership, visibility, status transitions, pagination, and capabilities. Split the extension's growing overlay logic into focused thread, course-list, marker-mode, and session modules while retaining the existing shadow-root integration and background request bridge. Implement each slice test-first, then package and deploy a versioned Chrome/Edge pilot build.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest, TypeScript, Chrome Manifest V3, Vitest/Node test runner, Playwright.

---

### Task 1: Server course-thread query and capability contract

**Files:**
- Modify: `server/app/schemas.py`
- Modify: `server/app/services/comments.py`
- Modify: `server/app/routers/comments.py`
- Test: `server/tests/test_comment_threads.py`
- Test: `server/tests/test_comment_visibility.py`
- Test: `server/tests/test_course_comment_routes.py`

- [ ] Write failing tests for strict course filtering, Open/Resolved grouping, deterministic cursor pagination, visible rank/total, complete thread detail, and server-computed capabilities.
- [ ] Run the focused tests and confirm failures describe the missing contract.
- [ ] Add bounded `GET /api/courses/{course_id}/comments` query schemas and implementation, reusing the existing visibility predicate before pagination.
- [ ] Extend thread detail with status group, visible rank/total, canonical location data, ordered replies, and capabilities.
- [ ] Make author/Administrator/LD-DCD delete and Administrator/LD-DCD status permissions consistent; retain nondisclosing `404` for invisible/cross-course resources.
- [ ] Run focused server tests and commit the passing slice.

### Task 2: Anchor fallback and SME recipient concurrency

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Modify: `server/app/services/comments.py`
- Modify: `server/app/routers/comments.py`
- Create: `server/alembic/versions/20260713_11_thread_location_and_recipient_version.py`
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background-bridge.ts`
- Create: `extension/src/anchors/types.ts`
- Test: `server/tests/test_comment_creation.py`
- Test: `server/tests/test_comment_threads.py`
- Test: `extension/tests/content.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/pin-anchor.test.ts`
- Test: `extension/tests/text-anchor.test.ts`

- [ ] Define `document_position_ratio: number | null` on anchor create/list/detail envelopes. At capture time it equals `clamp((anchorViewportRect.top + scrollY) / max(1, documentElement.scrollHeight), 0, 1)` using the placed marker or highlighted range's document-space Y coordinate; server validation accepts only finite values in `[0,1]`. Write failing server and extension tests for capture/submission, persistence/response, and recovery independently of selectors, plus SME recipient versioned replacement.
- [ ] Run them and confirm failure.
- [ ] Persist `document_position_ratio` and recipient-set version with backward-compatible defaults; implement capture/submission in `content.ts`/bridge.
- [ ] Implement atomic recipient replacement, same-course approved-SME validation, empty selection, deduplication, limit 50, and `409` on stale version.
- [ ] Run migration upgrade tests and focused server tests; commit.

### Task 3: Durable device renewal and trusted extension storage

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Modify: `server/app/services/access.py`
- Modify: `server/app/routers/access.py`
- Create: `server/alembic/versions/20260713_12_device_recovery.py`
- Modify: `extension/src/api.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background-bridge.ts`
- Test: `server/tests/test_course_access.py`
- Test: `server/tests/test_auth_routes.py`
- Test: `extension/tests/api.test.ts`
- Test: `extension/tests/background-bridge.test.ts`

- [ ] Define the migration record explicitly: credential family UUID, monotonically increasing generation with a family/generation uniqueness constraint, credential hash, recovery-handle hash with a uniqueness constraint, membership ID, issued/expires/consumed/revoked timestamps, and no plaintext secret columns; test upgrade and downgrade.
- [ ] Write failing server tests for `POST /api/auth/device/recover` request `{credential_family_id,recovery_handle}`, success response `{access_token,expires_in,device_credential,credential_generation,recovery_handle,recovery_expires_at,credential_family_id}`, one successful concurrent recovery, `409 RECOVERY_SUPERSEDED`, the specified terminal `{error:{code,message,credential_family_id}}` envelopes, and transient retention semantics.
- [ ] Define the trusted local record as `{schema_version:1,credential_family_id:string,credential_generation:positive integer,device_credential:string,recovery_handle:string,recovery_expires_at:ISO-8601,email:string,course_handle:string}`. Write failing extension tests for field/type/bounds/expiry validation, malformed-record cleanup, trusted-only access, renewal coalescing, atomic compare-before-replace/remove of the entire matching record, recovery, and survival of transient errors/worker restart.
- [ ] Run focused tests and confirm failures.
- [ ] Implement hashed, expiring, single-use recovery handles and the recovery endpoint without storing plaintext credentials. Initial approval, invitation redemption/resumption where a device is issued, and every successful renewal return `credential_family_id`, positive `credential_generation`, `recovery_handle`, and `recovery_expires_at` alongside the device credential; cover each path with route/service tests.
- [ ] Restrict local storage to trusted contexts before credential access and route all content-script auth through validated messages.
- [ ] Implement persistent identity/token renewal state machine and explicit sign-out/switch clearing.
- [ ] Run focused tests, security regression tests, and migration checks; commit.

### Task 4: Thread popover component

**Files:**
- Create: `extension/src/overlay/thread-popover.ts`
- Create: `extension/src/overlay/popover-position.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/api.ts`
- Test: `extension/tests/thread-popover.test.ts`
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/overlay.test.ts`
- Test: `extension/tests/content.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/api.test.ts`

- [ ] Write failing tests for marker toggle, one-popover invariant, anchored repositioning, collision order/clamping, offscreen close, focus restoration, and keyboard/ARIA behavior.
- [ ] Write failing tests for identity formatting, matching edit/delete icons, edit toggle/cancel/save, Reply toggle/cancel/save, inline failure retention, resolve/reopen, SME control, and delete confirmation, including exact request/response envelopes for PATCH body, POST reply, DELETE, PUT status, and versioned PUT SME recipients.
- [ ] Run focused extension tests and confirm failures.
- [ ] Extract a stateful thread-popover component with one active composer/editor and canonical refresh after mutations.
- [ ] Add anchored positioning driven by marker geometry on scroll/resize and remove fixed one-time placement.
- [ ] Wire capabilities and status actions through the background bridge.
- [ ] Run focused tests and commit.

### Task 5: Highlight rendering, marker mode, and overlay styling

**Files:**
- Modify: `extension/src/anchors/pin.ts`
- Modify: `extension/src/anchors/text.ts`
- Modify: `extension/src/anchors/recover.ts`
- Create: `extension/src/overlay/marker-mode.ts`
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/pin-anchor.test.ts`
- Test: `extension/tests/text-anchor.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] Write failing tests for text capture/recovery, restored yellow highlight geometry and cleanup, borderless turquoise comment controls, visible active marker state, speech-bubble cursor, Escape/button cancellation, and cleanup after completion.
- [ ] Run focused tests and confirm failures.
- [ ] Make stored markers consistent accessible buttons without white borders and make highlights visibly yellow.
- [ ] Implement marker mode as a small state machine that owns cursor and button state and never leaks listeners/classes.
- [ ] Apply the approved normal/active button styles and shared overlay tokens.
- [ ] Run focused tests and commit.

### Task 6: Course-wide Comments panel and cross-page hand-off

**Files:**
- Create: `extension/src/overlay/course-comments.ts`
- Create: `extension/src/navigation-handoff.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/course-comments.test.ts`
- Test: `extension/tests/navigation-handoff.test.ts`
- Test: `extension/tests/content.test.ts`
- Test: `extension/tests/background-bridge.test.ts`

- [ ] Write failing tests for course-only Open/Resolved lists, pagination, item context, current-page opening, and exact cross-page navigation.
- [ ] Write failing tests for tab/course/HTTPS-origin binding, five-minute expiry, one-time consumption, worker restart, duplicate-tab isolation, cleanup, and fallback document position. Bridge tests validate exact list/query/handoff envelopes and reject forged course IDs, untrusted senders/origins, noncanonical URLs, wrong tab bindings, and malformed cursors.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the course-comments client/view and status filters.
- [ ] Implement trusted session hand-off and destination validation before scroll/open.
- [ ] Connect current-page selection directly to marker/popover and cross-page selection to navigation; if anchor recovery fails, consume `document_position_ratio` by scrolling the anchor's estimated document-space Y (`ratio * scrollHeight`) into the viewport, clamped to the browser's valid scroll range, before opening the location-unavailable thread.
- [ ] Run focused tests and commit.

### Task 7: Identity display and help

**Files:**
- Create: `extension/src/overlay/identity.ts`
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay.test.ts`
- Test: `extension/tests/overlay-focus.test.ts`

- [ ] Write failing tests for deterministic avatar initials, human-readable role labels, display-name/email fallback, visible current identity, and switch/sign-out affordance.
- [ ] Write failing accessibility/content tests covering every current workflow in Help.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the compact Review360-inspired identity presentation and identity actions.
- [ ] Replace obsolete help copy with role-aware workflow guidance.
- [ ] Run focused tests and commit.

### Task 8: Integrated verification, versioning, release, and deployment

**Files:**
- Modify: `extension/public/manifest.json`
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `docs/pilot-test-script.md`
- Modify: `README.md` if operational instructions change
- Test: `extension/e2e/comment-flow.spec.ts`
- Test: `extension/e2e/version-layout.spec.ts`
- Test: `extension/tests/build-config.test.ts`
- Test: `tests/test_release_artifacts.py`

- [ ] Add/extend Playwright flows for highlight/thread toggle, marker placement, edit/reply, course-wide navigation, resolve/reopen, SME exposure, and persistent return to the same browser profile.
- [ ] Run the complete server suite, extension unit suite, Playwright suite, Alembic upgrade-to-head/downgrade/upgrade checks, extension build-config tests, and repository release-artifact tests.
- [ ] Fix failures using systematic debugging and rerun from the failing test through the full suites.
- [ ] Increment the extension to the next pilot version and update visible version diagnostics.
- [ ] Run the repository release script to build an immutable signed Chrome/Edge-compatible pilot artifact; verify manifest/package version agreement, checksums, immutable directory contents, and the `current` symlink target before deployment.
- [ ] Verify the Mac Mini backup job and take a fresh database backup with a restore/listing check before deployment.
- [ ] Deploy only the preverified server/artifact, apply migrations, assert the deployed Alembic head equals repository head, restart the service, verify health and Tailscale Serve, then atomically point `current` at the immutable release.
- [ ] Perform manual Chrome functional checks against CRJU150 where the existing authenticated browser session permits, then repeat install/load and core commenting checks in Microsoft Edge; document any step requiring the user's Moodle session.
- [ ] Commit release artifacts/instructions and report exact install/reload/testing steps.
