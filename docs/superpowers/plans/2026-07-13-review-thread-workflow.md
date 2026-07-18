# Review Thread Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace diagnostic/cluttered review UI with a persistent, contextual observation-and-discussion workflow including author edits, replies, stable numbering, SME escalation and reliable same-browser identity.

**Architecture:** Establish authoritative server contracts for editing, status transitions, SME recipients and renewal outcomes, then add exact trusted-context extension bridges. Refactor the overlay around one ordered page-comment model so markers, list navigation and popovers share state. Preserve compatibility fields while removing categories and diagnostics from presentation.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, PostgreSQL/Alembic, TypeScript, Manifest V3, Happy DOM, Vite.

---

### Task 1: Fix trusted-context recovery and persistent renewal

**Files:** `extension/src/content.ts`, `extension/src/background.ts`, `extension/src/api.ts`, `extension/src/review-context.ts`, `extension/tests/content.test.ts`, `extension/tests/api.test.ts`, `extension/tests/review-context.test.ts`, `server/app/models.py`, `server/alembic/versions/20260713_11_device_generation.py`, `server/app/routers/access.py`, `server/app/services/access.py`, `server/tests/test_course_access.py`, `server/tests/test_device_generation_migration.py`

- [ ] Write failing tests reproducing identity/delete context loss after worker restart and require pre-mutation `RESOLVE_COURSE` id verification.
- [ ] Write failing tests for renewal `200/401/409/429/5xx/network` handling, compare-and-swap local rotation and concurrent server rotation.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement a shared content-side trusted-course refresh used by identity, delete, edit, reply, status and Ask SME.
- [ ] Add a non-null integer `generation` to device credentials through an idempotent Alembic migration with existing rows backfilled to zero; test upgrade/downgrade and model parity.
- [ ] Implement exact renewal outcomes with `SELECT FOR UPDATE` plus generation compare-and-swap increment, and local credential retention/removal rules.
- [ ] Run focused tests plus typecheck and commit `fix(auth): persist course identity across browser sessions`.

### Task 2: Add author editing and authoritative status capabilities

**Files:** `server/app/schemas.py`, `server/app/routers/comments.py`, `server/app/services/comments.py`, `server/tests/test_comment_threads.py`, `server/tests/test_course_comment_routes.py`, `extension/src/background-bridge.ts`, `extension/src/background.ts`, `extension/tests/background-bridge.test.ts`

- [ ] Write failing API/service tests for body-only PATCH, author-only permission, nondisclosing boundaries, validation, deletion races and last-write-wins locking.
- [ ] Write failing response tests for deterministic `(created_at,id)` ordering and authoritative `allowed_statuses`.
- [ ] Implement PATCH, row locks, ordering and capability response.
- [ ] Add cross-course-role escalation tests and refactor page capabilities plus reply/status authorization to use the actor's approved membership role for the comment's course, never global `User.role`.
- [ ] Write failing exact bridge tests for edit/reply/status messages with no client course/role.
- [ ] Implement trusted-context API bridges and run focused server/extension tests.
- [ ] Commit `feat(review): add author editing and thread mutations`.

### Task 3: Add Ask SME recipient replacement

**Files:** `server/app/routers/comments.py`, `server/app/services/comments.py`, `server/app/schemas.py`, `server/tests/test_comment_visibility.py`, `server/tests/test_course_comment_routes.py`, `extension/src/background-bridge.ts`, `extension/src/background.ts`, `extension/tests/background-bridge.test.ts`

- [ ] Write failing GET/PUT contract tests covering ordered available recipients, current selection, empty replacement, limits, course/role/approval validation, nondisclosure and concurrent replacement/deletion.
- [ ] Implement locked transactional recipient replacement and exact responses.
- [ ] Write failing trusted bridge tests, then implement GET/PUT background handlers derived from cached course context.
- [ ] Run focused suites and commit `feat(review): let course leads ask selected SMEs`.

### Task 4: Rebuild thread popover and marker toggling

**Files:** `extension/src/overlay/root.ts`, `extension/src/anchors/recover.ts`, `extension/src/anchors/pin.ts`, `extension/tests/overlay.test.ts`, `extension/tests/overlay-focus.test.ts`, `extension/tests/recovery.test.ts`

- [ ] Write failing tests for yellow saved-text background, one turquoise marker, same-marker toggle close, other-marker switch, Escape/outside close and focus restoration.
- [ ] Write failing tests for `Comment x of y`, author/role, observation box, pencil, compact status, replies, reply editor, Ask SME and top-right accessible rubbish bin.
- [ ] Implement popover using one ordered visible-comment state and capability-driven controls.
- [ ] Add mutation callbacks that refresh comments while retaining the active thread where possible.
- [ ] Run focused overlay tests and commit `feat(extension): rebuild contextual thread popover`.

### Task 5: Simplify Comments list and remove diagnostics/categories

**Files:** `extension/src/overlay/root.ts`, `extension/src/content.ts`, `extension/tests/overlay.test.ts`, `extension/tests/content.test.ts`, `server/app/templates/dashboard/index.html`, `server/app/static/dashboard.js`, `server/tests/test_dashboard.py`, `server/tests/test_dashboard_accessibility.py`

- [ ] Write failing tests for ordered list rows, excerpts/status/author, anchored jump-and-open and unavailable-anchor open without diagnostic language.
- [ ] Write failing tests proving unresolved and embedded diagnostic panels are absent.
- [ ] Write failing extension/dashboard tests proving categories are absent from forms, thread emphasis and summary filters while new comments still send internal `general`.
- [ ] Implement the simplified list and presentation removal; retain internal compatibility data.
- [ ] Run focused suites and commit `feat(review): simplify feedback navigation`.

### Task 6: Show identity and switch user

**Files:** `extension/src/overlay/root.ts`, `extension/src/content.ts`, `extension/src/background.ts`, `extension/src/background-bridge.ts`, `extension/src/pending-access.ts`, `extension/src/saved-reviewers.ts`, `extension/src/reviewer-credentials.ts`, `extension/tests/overlay.test.ts`, `extension/tests/content.test.ts`, `extension/tests/pending-access.test.ts`, `extension/tests/background-bridge.test.ts`, `extension/tests/saved-reviewers.test.ts`, `extension/tests/reviewer-credentials.test.ts`

- [ ] Write failing tests for connected display-name/email fallback, human role, narrow layout and explicit switch-user action.
- [ ] Write failing switch/forget tests: switching clears active session/context but retains course/reviewer-keyed device credentials; choosing a saved reviewer renews through that credential; forgetting removes both credential and label; other courses/reviewers remain isolated.
- [ ] Write failing tests for an independent non-secret `{courseHandle, displayName, email, role}` saved-reviewer store with exact schema, course isolation, bounded retention and malformed cleanup; populate it only after approved identity is authenticated.
- [ ] Add exact `SIGN_OUT_SWITCH_USER`, `USE_SAVED_REVIEWER`, and `FORGET_SAVED_REVIEWER` messages in `background-bridge.ts`; test exact envelopes, unauthorized senders and trusted-course binding. Implement a trusted course/reviewer credential vault with bounded exact records, identity timing, fail-closed switch cleanup and chooser focus.
- [ ] Run focused tests/typecheck and commit `feat(extension): show and switch review identity`.

### Task 7: Verify, deploy and publish

**Files:** `extension/package.json`, `extension/package-lock.json`, `extension/tests/build-config.test.ts`, `tests/test_release_artifacts.py`, relevant E2E specs

- [ ] Run full extension tests, typecheck, build and browser E2E for highlight, marker, toggle, edit, reply, delete, list, Ask SME, identity persistence/switch and 320px layout.
- [ ] Run full server tests and migration checks.
- [ ] Bump to the next patch version and commit release changes.
- [ ] Build and checksum a signed Chrome/Edge release candidate, validate manifest hosts/version and smoke it against a local/staging-compatible server before changing production.
- [ ] Push, deploy backward-compatible server/migration changes to `/home/fldadmin/beta-testing-app`, run Alembic, restart `moodle-review.service`, verify migration head and Tailscale health; roll back application code while retaining expand schema if health fails.
- [ ] Atomically publish the already-verified artifact as `current`, then live-smoke CRJU150 in Chrome where browser control is available and provide exact reload/testing instructions.
