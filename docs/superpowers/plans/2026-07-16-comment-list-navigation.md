# Comment List Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long course comment lists viewport-bounded, page-filterable, compact, and directly actionable.

**Architecture:** Keep the existing API and background mutation paths unchanged. Extend the shadow-root overlay list in `extension/src/overlay/root.ts` with a derived page selector, a separately scrollable results region, compact semantic rows, and capability-gated status/delete controls that call the existing overlay callbacks and then rely on the existing refresh flow.

**Tech Stack:** TypeScript, Happy DOM/node:test, Shadow DOM CSS, Vite, Chromium Manifest V3.

---

## File map

- Modify `extension/src/overlay/root.ts`: render and filter the course comment list, invoke row actions, and constrain the shell/list layout.
- Modify `extension/tests/overlay.test.ts`: specify long-list layout, page/status filtering, row navigation, permissions, mutations, confirmation, and failure handling.
- Modify `extension/package.json`, `extension/package-lock.json`, and `extension/tests/build-config.test.ts`: publish pilot `0.4.29` consistently.
- Modify `docs/pilot-test-script.md` and `tests/test_deployment_package.py`: identify and validate the new pilot version and manual checks.
- Generate `extension/dist/` and the stable `pilot-builds/moodle-review-extension` release through the existing release script; do not hand-edit generated files.

### Task 1: Viewport-bounded list and page selector

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] **Step 1: Write failing layout and selector tests**

Add focused tests that mount more than 30 comments across duplicate and distinct page titles and assert:

```ts
assert.match(tealOverlayOverrides, /max-height:calc\(100vh - 32px\)/);
assert.match(tealOverlayOverrides, /\.comment-results\{[^}]*overflow-y:auto/);
assert.equal(shadow.querySelectorAll("[data-comment-page-option]").length, 4);
assert.equal(shadow.querySelector<HTMLSelectElement>("[data-comment-page]")!.value, "");
```

Also assert that page option values use `page_url`, duplicate titles remain separate, the selector is hidden in Current page scope, and a selected page title is not repeated in each visible row.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd extension
node --test --test-name-pattern='comment list|page selector|viewport' tests/overlay.test.ts
```

Expected: FAIL because there is no bounded results region or page selector.

- [ ] **Step 3: Implement the minimal layout and filtering**

In `setCommentList`, render this structure:

```html
<div class="comment-filter-row">…scope/status controls…</div>
<label class="comment-page-filter">Page <select data-comment-page>…</select></label>
<div class="comment-results" role="list"></div>
<p data-comment-empty hidden>No comments match these filters.</p>
```

Move active scope, status, and selected-page values to overlay-level list state rather than recreating them inside each `setCommentList` call. Derive unique options by `page_url`, label them with the complete normalized `page_title` or `Untitled page`, retain a selected URL across refresh when it remains available, reset it to `""` only when it disappears, and combine page, scope, and status predicates in `applyFilter`. Add a viewport-relative `.shell` maximum height, column layout, `min-height:0` panel/results rules, `overflow-y:auto` on `.comment-results`, and 14px list text.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same command and expect all selected tests to pass.

- [ ] **Step 5: Commit the first slice**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: add scrollable page-filtered comment list"
```

### Task 2: Compact actionable comment rows

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] **Step 1: Write failing row-action tests**

Add tests proving each visible row contains a navigation button plus capability-gated controls and retains its original loaded-course number across status, scope, and page filtering:

```ts
assert.equal(row.querySelectorAll('[data-comment-row-action]').length, 2);
assert.equal(row.querySelector('[aria-label="Resolve comment 1"]') !== null, true);
assert.equal(row.querySelector('[aria-label="Delete comment 1"]') !== null, true);
assert.match(secondLoadedComment.textContent!, /^#2 /);
```

Verify resolve calls `changeStatus(id, "resolved")`, resolved rows call `changeStatus(id, "open")`, delete calls `deleteThread(id)` only after confirmation, and neither icon invokes `navigateToComment` or `renderer.takeToContext`. In successful mutation mocks, call `setCommentList` with the refreshed records to prove callback-driven row replacement. Verify unavailable capabilities omit the relevant icon.

- [ ] **Step 2: Run the row-action tests and verify RED**

```bash
cd extension
node --test --test-name-pattern='comment row|list action' tests/overlay.test.ts
```

Expected: FAIL because list entries are single buttons without inline actions.

- [ ] **Step 3: Implement semantic rows and mutations**

Replace each single list button with a `role="listitem"` row containing:

- a compact navigation button with stable course number and body excerpt;
- a resolve/reopen icon button when `can_change_status` and `options.changeStatus` are present;
- a rubbish-bin icon button when `can_delete` and `options.deleteThread` are present.

Give each action a full accessible label and title. Disable only the activated control while awaiting the existing mutation callback. On rejection, re-enable the control and render a concise row-level `role="status"` error; on success allow the callback's course-list refresh to replace the rows. Keep delete's existing full-thread confirmation wording.

- [ ] **Step 4: Run row-action and navigation tests and verify GREEN**

```bash
cd extension
node --test --test-name-pattern='comment row|list action|clicking a comment|course-list navigation' tests/overlay.test.ts
```

Expected: all selected tests pass and navigation still leaves the list open.

- [ ] **Step 5: Commit the second slice**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: add course-list resolve and delete actions"
```

### Task 3: Regression, accessibility, and responsive verification

**Files:**
- Modify: `extension/tests/overlay.test.ts` only if a regression gap is found
- Modify: `extension/src/overlay/root.ts` only for fixes required by the tests

- [ ] **Step 1: Add or tighten combined-filter and error-state tests**

Cover Whole course + selected page + Open/Resolved combinations, empty state, valid selector retention across `setCommentList` refresh, invalid selector reset after refresh, stable original course numbering across every filter, keyboard-focusable row actions, accessible names, mutation rejection, and Current page scope on a SCORM-style `page_url`. Replace the existing test assertion that renumbers visible links after filtering because it conflicts with stable course numbering.

- [ ] **Step 2: Verify each new test fails for the intended missing edge case before any production edit**

```bash
cd extension
node --test tests/overlay.test.ts
```

- [ ] **Step 3: Apply only the minimal fixes required for GREEN**

Do not alter server schemas, SCORM frame coordination, sign-in, or comment anchoring.

- [ ] **Step 4: Run the full extension verification**

```bash
cd extension
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, TypeScript exits 0, and Vite produces `dist/` without warnings or errors.

- [ ] **Step 5: Commit regression fixes**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "test: cover long course comment navigation"
```

### Task 4: Version, release, and pilot delivery

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `docs/pilot-test-script.md`
- Modify: `tests/test_deployment_package.py`
- Generate: `extension/dist/`
- Generate/publish: stable `pilot-builds/moodle-review-extension` and versioned Chrome/Edge ZIP

- [ ] **Step 1: Update version expectations first and verify RED**

Change tests and pilot documentation to expect `0.4.29`, then run. The patch bump is intentionally included because the project requires each user-testable extension change to expose a distinct version:

```bash
cd extension
node --test tests/build-config.test.ts
cd ..
python3 -m unittest tests/test_deployment_package.py
```

Expected: FAIL until package and lock versions are updated together.

- [ ] **Step 2: Bump the canonical package versions**

Use `npm version 0.4.29 --no-git-tag-version` in `extension/`, preserving the public manifest placeholder `0.0.0`.

- [ ] **Step 3: Run all source and packaging checks**

```bash
cd extension && npm test && npm run typecheck && npm run build
cd .. && python3 -m unittest tests/test_release_artifacts.py tests/test_deployment_package.py
```

Expected: zero failures.

- [ ] **Step 4: Commit the versioned source**

```bash
git add extension/package.json extension/package-lock.json extension/tests/build-config.test.ts docs/pilot-test-script.md tests/test_deployment_package.py
git commit -m "release: prepare pilot 0.4.29"
```

- [ ] **Step 5: Publish and validate the immutable release**

Run the existing `deploy/scripts/release-pilot-extension.sh` from a clean tree. Verify `manifest.json`, `RELEASE.json`, versioned/stable ZIP hashes, and that stable unpacked `pilot-builds/moodle-review-extension` matches `extension/dist` for `background.js`, `content.js`, and `manifest.json`.

- [ ] **Step 6: Manual browser smoke test**

Reload pilot `0.4.29` in Chrome. On a Moodle page and a SCORM page, open Whole course comments, verify the shell never exceeds the viewport, scroll the results while controls remain visible, filter by page/status, navigate to a comment, resolve/reopen, and delete a disposable comment after confirmation.

- [ ] **Step 7: Final verification and handoff**

Re-run full extension and deployment suites after release generation, confirm `git status --short` is clean, and provide the user with the exact stable folder and one-step Chrome reload instructions.
