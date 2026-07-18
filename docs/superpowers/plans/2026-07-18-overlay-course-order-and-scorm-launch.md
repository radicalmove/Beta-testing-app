# Overlay Course Ordering and SCORM Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the approved overlay controls and deterministic course-order comment list, and make SCORM comment navigation reopen Moodle through a complete validated launch URL instead of a bare player URL.

**Architecture:** Keep presentation and ordering logic in small pure extension modules, with `overlay/root.ts` consuming an authoritative sorted projection. Add a narrowly validated SCORM launch resolver/cache at the trusted Moodle top frame, then reuse the existing background navigation state machine with the resolved player URL. Preserve current API and database schemas.

**Tech Stack:** TypeScript, Chrome Manifest V3 APIs, Happy DOM/node:test, Vite, Playwright.

---

## Task 1: Add deterministic course comment ordering

**Files:**
- Create: `extension/src/course-comment-order.ts`
- Create: `extension/tests/course-comment-order.test.ts`

1. Write failing tests for dotted numeric title extraction, unnumbered-course-page precedence, natural numeric page ordering, stable title/URL fallback, within-page server order, and canonical numbering assigned before filters.
2. Run `cd extension && node --test tests/course-comment-order.test.ts` and confirm the new tests fail.
3. Implement a pure `projectCourseComments` helper returning ordered page groups and canonical display indices without mutating input.
4. Re-run the focused test from `extension/` and commit: `feat: order course comments by course structure`.

## Task 2: Restore approved overlay layout and interaction states

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/overlay-focus.test.ts`
- Modify: `extension/e2e/overlay.spec.ts` if the current visual assertions live there

1. Add failing DOM/style tests for: 3px shell boundary; centred single-line equal filter buttons; square 44px Help control; white inactive and dark-teal active toolbar controls; marker button pressed only while placement mode is active; Comments/Help pressed only while their panels are open; fixed panel heading/filter area; independent results scrolling reset to top.
2. Add failing list tests proving groups and visible canonical numbers come from `projectCourseComments`, including filtered gaps and recalculation after authoritative add/remove.
3. Integrate the projection helper into `setCommentList`, render headings in projected order, and use canonical indices for labels/actions.
4. Adjust the overlay style constants and state attributes to match the approved palette and control behaviour.
5. Run `cd extension && node --test tests/course-comment-order.test.ts tests/overlay.test.ts tests/overlay-focus.test.ts`, then commit: `fix: restore approved comment overlay controls`.

## Task 3: Parse and validate Moodle SCORM launch state

**Files:**
- Create: `extension/src/scorm-launch.ts`
- Create: `extension/tests/scorm-launch.test.ts`

1. Write failing tests for parsing exactly one same-origin POST `/mod/scorm/player.php` form, requiring positive matching `cm`, positive `scoid`, bounded `currentorg`, and an allowed bounded `mode`.
2. Add rejection tests for credentials, cross-origin actions, missing/duplicate forms, mismatched cmid, malformed fields, and bare player URLs.
3. Implement the pure parser that returns a canonical complete query URL while never exposing or accepting credentials.
4. Run the focused test from `extension/` and commit: `feat: resolve trusted Moodle SCORM launch URLs`.

## Task 4: Add bounded SCORM launch recovery cache

**Files:**
- Modify: `extension/src/scorm-launch.ts`
- Modify: `extension/tests/scorm-launch.test.ts`

1. Write failing tests for exact package-root identity, course/origin/cmid binding, 12-hour expiry, malformed-entry purge, exact-key replacement, and oldest-first eviction above 128 records.
2. Implement cache serialization/validation helpers for `chrome.storage.session`; accept only canonical HTTPS `pluginfile.php/.../mod_scorm/.../scormcontent/` roots.
3. Run the focused test from `extension/` and commit: `feat: cache bounded SCORM launch recovery`.

## Task 5: Capture complete launch URLs at the trusted Moodle frame

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/review-context.ts` if its stored contract needs a narrow extension
- Modify: `extension/src/course-context.ts` if a narrow exported helper is needed
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/tests/background-bridge.test.ts`
- Modify: `extension/tests/review-context.test.ts` if its contract changes

1. Add failing content tests for obtaining cmid from current trusted sources and fetching `/mod/scorm/view.php?id=<cmid>` with the signed-in same-origin session.
2. Add failing background/message-boundary tests proving only the authorised top frame may submit a parsed launch record and that sender frame, configured Moodle origin, course, and cmid must all match. Confirm malformed records and bare player URLs cannot replace `StoredReviewContext.parent_activity_url`.
3. Integrate the resolver into top-frame review-context registration, pass it through a strictly validated runtime message, and let the background—not the content script—own `chrome.storage.session` and the stored review context. Pair the exact package root only when it arrives from the elected worker/background state.
4. Add negative tests confirming failures do not register a bare player URL, access session storage from content, or widen origin access.
5. Run `cd extension && node --test tests/content.test.ts tests/background.test.ts tests/background-bridge.test.ts tests/review-context.test.ts tests/scorm-launch.test.ts`, then commit: `fix: bind SCORM review context to complete launch state`.

## Task 6: Recover legacy SCORM comments during navigation

**Files:**
- Modify: `extension/src/embedded-comment-navigation.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/tests/background-frame-coordination.test.ts`
- Modify: `extension/tests/scorm-launch.test.ts`

1. Add failing tests that navigation uses an already complete validated `parent_activity_url`, otherwise resolves the exact course/origin/package-root cache entry, and never navigates to bare `/mod/scorm/player.php`.
2. Add the exact unrecoverable legacy error assertion: `This SCORM comment cannot be opened because its Moodle activity location is missing.` and verify no navigation occurs.
3. Thread the background-owned cache lookup into the existing state machine without changing its retry, course-binding, worker-generation, or locator-projection safeguards.
4. Add a service-worker restart test: write a valid launch record through one cache/background instance, recreate the background/cache over the same session-storage fake, then prove navigation recovers the complete player query URL while preserving course, origin, worker-generation, locator, and projection checks.
5. Run focused background/navigation tests from `extension/` and commit: `fix: reopen SCORM comments through validated Moodle launch`.

## Task 7: Version, build, and regression verification

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: version assertions/docs located by `rg '0\.4\.32' extension docs`

1. Bump the extension patch version to `0.4.33` and update visible version references.
2. Run all mutating verification before packaging: `cd extension && npm test && npm run typecheck && npm run build && npm run test:e2e`.
3. Run the server suite from the repository root: `cd server && python3 -m pytest -q`.
4. Run the deployment/package suite from the repository root: `python3 -m unittest tests/test_deployment_package.py`.
5. Inspect the source diff and tested manifest/version, then commit the source changes: `chore: release extension 0.4.33`. Confirm `git status --short` is clean because the publisher derives its release identity from `HEAD`.
6. With `PRIVATE_KEY_PATH` and `REVIEW_SERVICE_ORIGIN` supplied from the existing deployment environment, run `deploy/scripts/release-pilot-extension.sh` from the repository root as the final external release step. Do not commit generated delivery artifacts afterward.
7. Verify `pilot-builds/moodle-review-extension/manifest.json` reports `0.4.33`; verify stable and versioned Chrome/Edge ZIP artifacts exist; inspect `RELEASE.json` for version and build commit equal to the tested `HEAD`; and verify the recorded SHA256 values against the generated artifacts.

## Task 8: Live smoke test handoff

1. Reload the unpacked `pilot-builds/moodle-review-extension` build in Chrome.
2. Confirm Moodle overlay controls, list ordering, scroll reset, marker/panel/help state, and filtered canonical numbering.
3. Open a SCORM comment from Whole course and verify Moodle launches with required state, the Rise location is applied, and the comment opens in context.
4. Confirm a deliberately unrecoverable legacy item shows the specific error in the overlay and does not leave the course page.
