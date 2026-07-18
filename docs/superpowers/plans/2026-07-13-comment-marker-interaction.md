# Comment Marker Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an accessible turquoise review overlay with one adaptive comment action, yellow text anchors, speech-bubble markers and contextual thread popovers, signed-in identity/switching, and authorized complete-thread deletion.

**Architecture:** Extend the server API first so identity, visibility-scoped capabilities, and destructive authorization remain authoritative. Split new extension behaviour into focused selection/placement and popover modules, leaving `overlay/root.ts` responsible for composition. Integrate through exact background-message envelopes and exercise each behaviour test-first before publishing the next signed pilot version.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Node test runner, TypeScript, Happy DOM, WebExtension Manifest V3, Vite, CSS Shadow DOM.

---

## File map

- Create `extension/src/comment-placement.ts`: eligible selection/target rules and reversible keyboard placement controller.
- Create `extension/src/thread-popover.ts`: marker-associated non-modal popover positioning, focus and dismissal.
- Create `extension/src/saved-reviewers.ts`: non-secret course-scoped reviewer labels independent of authentication credentials.
- Modify `extension/src/anchors/text.ts` and `extension/src/anchors/pin.ts`: yellow anchored ranges and turquoise speech-bubble marker rendering.
- Modify `extension/src/overlay/root.ts` and `styles.css`: adaptive action, identity, popover integration and new colour system.
- Modify `extension/src/content.ts`: selection observation, placement lifecycle, identity loading, deletion and local marker refresh.
- Modify `extension/src/api.ts`, `background-bridge.ts`, and `background.ts`: exact identity/delete envelopes and trusted requests.
- Modify `server/app/routers/auth.py`, `comments.py`, `schemas.py`, `services/comments.py`, `models.py`: course-scoped identity/capabilities and deletion.
- Modify `server/app/static/app.css`: application-wide primary turquoise.
- Add/modify matching test files listed per task.

### Task 1: Authoritative course identity and capabilities

**Files:**
- Modify: `server/app/routers/auth.py`
- Modify: `server/app/routers/comments.py`
- Modify: `server/app/services/comments.py`
- Test: `server/tests/test_auth_routes.py`
- Test: `server/tests/test_course_comment_routes.py`
- Test: `server/tests/test_comment_visibility.py`

- [ ] Write failing tests for `GET /api/me?course_id=<uuid>`: approved same-course membership returns exact public identity; missing/unapproved/cross-course membership is nondisclosing; display name may be null and role is server-derived.
- [ ] Run the focused tests and confirm failures are missing-route/response failures.
- [ ] Implement the authenticated course-membership lookup and exact identity response.
- [ ] Write failing tests asserting each visible page comment has exact boolean `capabilities` for beta author, other beta, SME, LD/DCD and admin, with no capability leakage across visibility/course boundaries.
- [ ] Encode the capability matrix in the tests before implementation: `can_reply` follows existing beta/SME visibility rules; `can_change_status` and `can_share_with_sme` are true only for approved same-course LD/DCD (and operational admin where currently supported); `can_delete` is true for the original author or approved same-course LD/DCD/admin; all four are false when the thread is not visible, and invisible threads are omitted rather than returned.
- [ ] Run the focused tests and confirm response-shape failures.
- [ ] Centralize capability calculation in `services/comments.py` and include it in list/detail JSON.
- [ ] Add cross-course escalation tests for reply, status and share, then refactor all three mutation paths to authorize from the authenticated approved membership for the comment's course rather than a user's global/other-course role.
- [ ] Run `python -m pytest server/tests/test_auth_routes.py server/tests/test_course_comment_routes.py server/tests/test_comment_visibility.py -q` and confirm green.
- [ ] Commit with `feat(server): expose course identity and comment capabilities`.

### Task 2: Secure complete-thread deletion

**Files:**
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/20260713_10_comment_delete_cascades.py`
- Modify: `server/app/services/comments.py`
- Modify: `server/app/routers/comments.py`
- Modify: `server/app/services/attachments.py`
- Test: `server/tests/test_comment_threads.py`
- Test: `server/tests/test_attachments.py`
- Test: `server/tests/test_authorization.py`

- [ ] Write failing service/route tests for author, approved same-course LD/DCD and admin deletion, plus `403` for a visible unauthorized viewer and identical `404` for missing, deleted, invisible and cross-course threads.
- [ ] Add failing cascade tests covering replies, status events, shares, read state, attachment records and shared-vs-orphaned page locations.
- [ ] Add failing concurrency/idempotency tests for repeat deletion and operations attempted after deletion.
- [ ] Run focused tests and verify they fail because delete support is absent.
- [ ] Add an Alembic expand migration that replaces dependent comment foreign keys with explicit database cascades, preserves data, upgrades from the current production head, and has a downgrade that restores the prior constraints; add a migration test and run upgrade/downgrade/upgrade against a disposable database.
- [ ] Add/verify matching SQLAlchemy foreign-key cascade rules and implement a visibility-first `delete_comment_thread` service that locks the thread, authorizes against approved same-course membership, deletes dependent rows and returns attachment paths.
- [ ] Update reply, status, share and attachment-upload service paths to lock the same parent comment row before mutation; test each mutation either commits before deletion or observes the missing/deleted thread and returns `404`.
- [ ] Implement `DELETE /api/comments/{comment_id}` with exact `204/403/404` semantics; delete collected files after commit and log failures for orphan cleanup.
- [ ] Run `python -m pytest server/tests/test_comment_threads.py server/tests/test_attachments.py server/tests/test_authorization.py -q` and confirm green.
- [ ] Commit with `feat(server): add authorized thread deletion`.

### Task 3: Extension identity and delete bridges

**Files:**
- Modify: `extension/src/api.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/review-context.ts`
- Test: `extension/tests/api.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/review-context.test.ts`

- [ ] Write failing exact-envelope tests for `GET_CURRENT_VIEWER`, `DELETE_COMMENT_THREAD`, identity response validation and capability-bearing page comments; include malformed, wrong-course, wrong-origin and client-supplied-role rejection.
- [ ] Run `npm test -- tests/api.test.ts tests/background-bridge.test.ts` and confirm expected failures.
- [ ] Implement token-authenticated API calls and bridge handlers. Derive course id from `ReviewContextCache`, never message payload, and reject absent, stale or mismatched tab/course bindings before any API call.
- [ ] Add deletion handling for `204`, nondisclosing `404`, permission `403` and session expiry.
- [ ] Run focused tests, then `npm run typecheck`.
- [ ] Commit with `feat(extension): bridge viewer identity and thread deletion`.

### Task 4: Adaptive selection and marker-placement controller

**Files:**
- Create: `extension/src/comment-placement.ts`
- Create: `extension/tests/comment-placement.test.ts`
- Modify: `extension/src/content.ts`
- Test: `extension/tests/content.test.ts`

- [ ] Write failing tests for eligible/ineligible selections: whitespace, cross-root/document, editable/form/control/navigation/hidden/script/style/media content, multi-element visible text and selected link text.
- [ ] Run the new test file and confirm missing-module failure.
- [ ] Implement selection normalization and eligibility as pure functions.
- [ ] Write failing tests for point-target eligibility, pointer placement, failed target announcement, Escape/cancel, preview marker, and cleanup.
- [ ] Write failing keyboard tests proving temporary tabindex values are reversible, Tab order works, Enter/Space prevents Moodle activation, and teardown/navigation restores attributes.
- [ ] Implement a bounded placement controller with one normalized draft-anchor output and no persistent page mutation.
- [ ] Integrate selection observation and placement lifecycle into `content.ts`; ensure composer cancellation cleans temporary anchors.
- [ ] Run `npm test -- tests/comment-placement.test.ts tests/content.test.ts` and confirm green.
- [ ] Commit with `feat(extension): add adaptive comment placement`.

### Task 5: Speech-bubble markers and yellow highlights

**Files:**
- Modify: `extension/src/anchors/text.ts`
- Modify: `extension/src/anchors/pin.ts`
- Create: `extension/src/anchors/marker.ts`
- Test: `extension/tests/text-anchor.test.ts`
- Test: `extension/tests/pin-anchor.test.ts`
- Test: `extension/tests/recovery.test.ts`

- [ ] Write failing tests that stored text anchors render a persistent yellow highlight plus one adjacent keyboard-focusable speech-bubble marker with accessible author/context label.
- [ ] Write failing tests that point anchors use the same larger turquoise speech-bubble marker and retain selector/relative-coordinate recovery after resize.
- [ ] Run focused tests and confirm visual/markup assertions fail.
- [ ] Implement one shared marker factory/controller in `anchors/marker.ts` and use it from both anchor modules. Test one marker per restored anchor, stable DOM ids, activation callbacks, complete cleanup, and no duplicates after repeated refresh/recovery.
- [ ] Preserve unresolved-anchor fallback in the Comments list and cleanup/scheduling guarantees.
- [ ] Run the three focused test files and confirm green.
- [ ] Commit with `feat(extension): render contextual comment markers`.

### Task 6: Thread popover

**Files:**
- Create: `extension/src/thread-popover.ts`
- Create: `extension/tests/thread-popover.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/overlay/styles.css`
- Modify: `extension/src/api.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/background.ts`
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] Write failing tests for right/left/above/below positioning and 8px viewport clamping under scroll, resize and visual-viewport changes.
- [ ] Write failing accessibility/focus tests for `aria-expanded`, `aria-controls`, heading focus, Escape/outside dismissal, focus restoration, marker switching, and inside/overlay clicks.
- [ ] Write and run failing bridge/API/integration tests for popover reply, status and share mutations, including capability denial and wrong-course trusted-context rejection.
- [ ] Add exact bridge/API handlers for reply, status and share mutations if not already present, deriving trusted course context and validating response envelopes; make the previously failing integration tests pass.
- [ ] Implement the isolated popover controller and render original comment, replies, status/history, context, reply/share/status/delete controls solely from server capabilities.
- [ ] Keep the existing Comments list as a summary entry point and ensure only one popover exists.
- [ ] Run the new and existing overlay tests and confirm green.
- [ ] Commit with `feat(extension): open threads beside comment markers`.

### Task 7: Identity, switching and deletion UX

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/overlay/styles.css`
- Modify: `extension/src/content.ts`
- Modify: `extension/src/pending-access.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/review-context.ts`
- Create: `extension/src/saved-reviewers.ts`
- Test: `extension/tests/overlay.test.ts`
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/content.test.ts`
- Test: `extension/tests/pending-access.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/review-context.test.ts`
- Create: `extension/tests/saved-reviewers.test.ts`

- [ ] Write failing tests for display-name/email fallback, human-readable role, narrow wrapping and the **Sign out / switch user** action.
- [ ] Write failing tests proving switching clears session, device/pending/reconnect credentials, draft/context/popover state while retaining only the non-secret course-scoped reviewer list and focusing its first option.
- [ ] Write failing saved-reviewer-store tests for exact non-secret `{courseHandle, displayName, email, role}` records, course isolation, bounded retention, malformed-record cleanup and independence from device/pending credentials; implement the store and populate it only after authenticated/approved identity is confirmed.
- [ ] Write a failing exact-envelope test for `SIGN_OUT_SWITCH_USER`, including unauthorized sender and partial-cleanup failure cases.
- [ ] Implement identity loading and a background-owned fail-closed `SIGN_OUT_SWITCH_USER` protocol: write a durable non-secret cleanup journal, clear token/expiry then device and pending/reconnect credentials, clear trusted context/drafts/popovers, remove the journal, and return the independent reviewer list. On partial storage failure expose no usable token, retain the journal, and retry cleanup at worker startup and before authentication. The content script must not perform or claim partial cleanup.
- [ ] Write failing tests for capability-gated **Delete thread**, destructive confirmation copy, success cleanup/count refresh, `403` retry state, and stale `404` close/refresh announcement.
- [ ] Implement deletion UI and content/background coordination.
- [ ] Run `npm test -- tests/overlay.test.ts tests/overlay-focus.test.ts tests/content.test.ts tests/pending-access.test.ts tests/background-bridge.test.ts tests/review-context.test.ts tests/saved-reviewers.test.ts && npm run typecheck` and confirm green.
- [ ] Commit with `feat(extension): add identity switching and thread deletion UX`.

### Task 8: Turquoise visual system and responsive accessibility

**Files:**
- Modify: `extension/src/overlay/styles.css`
- Modify: `server/app/static/app.css`
- Test: `extension/tests/overlay.test.ts`
- Test: `server/tests/test_dashboard_accessibility.py`

- [ ] Write failing style/a11y tests for primary `#28c4c2`, darker accessible foreground/borders, yellow highlights, strong overlay boundary, visible focus, 320px layout and no obsolete teal/red primary declarations.
- [ ] Run focused tests and confirm expected colour/layout failures.
- [ ] Introduce shared CSS custom properties and update extension plus server application styles, retaining UCO red only as non-primary institutional accent/error semantics where appropriate.
- [ ] Run contrast assertions and responsive overlay tests.
- [ ] Commit with `style: adopt turquoise review visual system`.

### Task 9: End-to-end verification and pilot release

**Files:**
- Modify: `extension/e2e/*` or existing Playwright specs
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `tests/test_release_artifacts.py`
- Modify: release documentation if version references are present

- [ ] Add failing Chromium E2E coverage for highlighted-text creation, pointer and keyboard marker creation, opening a thread from each marker type, complete-thread deletion, identity display/switching, viewport edges and 320px layout.
- [ ] Run the E2E specs against the local test backend and fix only implementation defects revealed.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` in `extension/`.
- [ ] Run `python -m pytest -q` from the repository environment and confirm the full server/release suite passes.
- [ ] Bump all canonical extension version assertions to the next patch release and build the signed Chrome/Edge pilot using `deploy/scripts/release-pilot-extension.sh`.
- [ ] Verify release manifest, SHA256 checksums, immutable folder and `current` copy; remove only incidental Finder `.DS_Store` metadata if it blocks immutable verification.
- [ ] Deploy server changes to the Mac Mini, restart `moodle-review.service`, check health and perform live Chrome smoke tests for both creation paths, marker popover, identity and deletion.
- [ ] Before deployment run the documented backup and disposable restore verification. Deploy with `ssh -i /Users/rcd58/.ssh/codex_fldmini fldadmin@100.76.46.77 'cd /home/fldadmin/beta-testing-app && git fetch origin && git checkout feature/moodle-course-review && git pull --ff-only && cd server && .venv-prod/bin/alembic upgrade head && systemctl --user restart moodle-review.service && systemctl --user is-active moodle-review.service'`, then check the Tailscale health endpoint. Rollback is the previous commit plus the migration's tested downgrade only if no newly created data depends on it; otherwise retain the expanded schema and roll back application code.
- [ ] Load the unpacked `current/moodle-review-extension` in Chrome and Edge (or Edge's Chromium extension loader), confirm the identical signed manifest/version and host permissions, and run creation/popover/identity/deletion smoke tests in both before declaring the package Chrome/Edge compatible.
- [ ] Commit release metadata, push `feature/moodle-course-review`, and provide the exact reload/testing steps and visible pilot version.
